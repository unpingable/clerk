// SPDX-License-Identifier: Apache-2.0
/**
 * IPC handler registration — wires all channels to GovernorClient methods.
 * Each handler is a thin forwarding layer; no business logic here.
 *
 * When the daemon resolver fails, client/monitor are null. Handlers that
 * need the daemon throw a descriptive error so the renderer knows why.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { ipcMain, BrowserWindow } from 'electron';
import { Channels } from '../shared/channels.js';
import { GovernorClient } from './rpc-client.js';
import { ConnectionMonitor } from './connection.js';
import type { TemplateManager } from './template-manager.js';
import type { FileManager } from './file-manager.js';
import type { ToolLoop, AskGate } from './tool-loop.js';
import type { ActivityManager } from './activity-manager.js';
import type { SettingsManager } from './settings-manager.js';
import type { ConversationManager } from './conversation-manager.js';
import type { DaemonResolveResult } from './daemon-resolver.js';
import type { TemplateApplyRequest, AskRequest, AskGrantToken, AskDecision, BackendConfig, BackendConfigureResult, ConversationData } from '../shared/types.js';
import { validateBackendConfig, writeDaemonConf, probeBackend } from './backend-config.js';
import type { BackendConfigIO } from './backend-config.js';

function requireDaemon(client: GovernorClient | null): GovernorClient {
  if (!client) throw new Error('Governor daemon not available. Check daemon status for details.');
  return client;
}

/**
 * Strip RPC codes, method names, and transport internals from errors
 * before they reach the renderer. Users should see what failed and
 * what to do next — not plumbing.
 */
function sanitizeError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  // RPC timeout → calm retry prompt
  if (/timed?\s*out/i.test(raw)) {
    return "Clerk couldn't get a response in time. Try again.";
  }

  // RPC method-not-found or protocol mismatch
  if (/method.*not\s+found|unknown\s+method|-32601/i.test(raw)) {
    return "Clerk couldn't complete that request. The engine may need to be restarted or updated.";
  }

  // Generic RPC error code pattern (e.g. "RPC -32700: ...")
  if (/^RPC\s+-?\d+/i.test(raw) || /jsonrpc/i.test(raw)) {
    return "Clerk couldn't complete that request. Try again.";
  }

  // Connection refused / broken pipe / transport errors
  if (/ECONNREFUSED|EPIPE|ENOTCONN|broken\s+pipe|connection\s+(refused|reset)/i.test(raw)) {
    return "Clerk lost its connection to the engine. Try restarting.";
  }

  // If the message already looks clean (no RPC codes, no stack frames), pass it through
  return raw;
}

// ---------------------------------------------------------------------------
// AskGate factory
// ---------------------------------------------------------------------------

const ASK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface AskGateState {
  gate: AskGate;
  respondToAsk: (askId: string, decision: AskDecision) => void;
}

export function makeAskGate(getWin: () => BrowserWindow | undefined): AskGateState {
  const pendingAsks = new Map<string, {
    resolve: (result: { decision: 'allow_once' | 'deny'; grantToken?: AskGrantToken; reason?: string }) => void;
    timer: ReturnType<typeof setTimeout>;
    signal: AbortSignal;
    req: AskRequest;
  }>();

  const gate: AskGate = {
    async requestAsk(req: AskRequest, signal: AbortSignal) {
      // One pending ask at a time — auto-deny if another is pending
      if (pendingAsks.size > 0) {
        return { decision: 'deny' as const, reason: 'Another ask is already pending.' };
      }

      return new Promise<{ decision: 'allow_once' | 'deny'; grantToken?: AskGrantToken; reason?: string }>((resolve) => {
        // Auto-deny on timeout
        const timer = setTimeout(() => {
          pendingAsks.delete(req.askId);
          resolve({ decision: 'deny', reason: 'Ask timed out after 5 minutes.' });
        }, ASK_TIMEOUT_MS);

        // Auto-deny on abort (stop)
        const onAbort = () => {
          clearTimeout(timer);
          pendingAsks.delete(req.askId);
          resolve({ decision: 'deny', reason: 'STOPPED_BY_USER' });
        };

        if (signal.aborted) {
          clearTimeout(timer);
          resolve({ decision: 'deny', reason: 'STOPPED_BY_USER' });
          return;
        }

        signal.addEventListener('abort', onAbort, { once: true });

        pendingAsks.set(req.askId, { resolve, timer, signal, req });

        // Send ask request to renderer
        const win = getWin();
        if (win) {
          win.webContents.send(Channels.CHAT_ASK_REQUEST, req);
        } else {
          // No window — auto-deny
          clearTimeout(timer);
          pendingAsks.delete(req.askId);
          resolve({ decision: 'deny', reason: 'No window available.' });
        }
      });
    },
  };

  function respondToAsk(
    askId: string,
    decision: AskDecision,
  ): void {
    const pending = pendingAsks.get(askId);
    if (!pending) return;

    clearTimeout(pending.timer);
    pendingAsks.delete(askId);

    if (decision === 'allow_once') {
      const { req } = pending;
      const grantToken: AskGrantToken = {
        grantId: crypto.randomUUID(),
        streamId: req.streamId,
        correlationId: req.correlationId,
        toolId: req.toolId,
        path: req.path,
        toPath: req.toPath,
        expectedHash: req.expectedHash,
        usedAt: null,
      };
      pending.resolve({ decision: 'allow_once', grantToken });
    } else {
      pending.resolve({ decision: 'deny' });
    }
  }

  return { gate, respondToAsk };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerIpcHandlers(
  client: GovernorClient | null,
  monitor: ConnectionMonitor | null,
  daemonResult: DaemonResolveResult,
  templateManager: TemplateManager | null = null,
  fileManager: FileManager | null = null,
  toolLoop: ToolLoop | null = null,
  activityManager: ActivityManager | null = null,
  askGateState: AskGateState | null = null,
  settingsManager: SettingsManager | null = null,
  conversationManager: ConversationManager | null = null,
  governorDir: string | null = null,
  configIO: BackendConfigIO | null = null,
): void {
  // --- Daemon Resolver ---

  ipcMain.handle(Channels.DAEMON_STATUS, async () => {
    return daemonResult;
  });

  // --- Connection ---

  ipcMain.handle(Channels.HEALTH, async () => {
    return requireDaemon(client).health();
  });

  ipcMain.handle(Channels.CONNECT, async (_event, dirOrUrl: string) => {
    requireDaemon(client).setGovernorDir(dirOrUrl);
    monitor?.stop();
    monitor?.start();
  });

  // --- Governor State ---

  ipcMain.handle(Channels.NOW, async () => {
    return requireDaemon(client).now();
  });

  ipcMain.handle(Channels.STATUS, async () => {
    return requireDaemon(client).status();
  });

  // --- Chat ---

  ipcMain.handle(Channels.CHAT_SEND, async (_event, messages, options) => {
    return requireDaemon(client).chatSend(messages, options);
  });

  ipcMain.handle(Channels.CHAT_STREAM_START, async (_event, messages, options) => {
    const c = requireDaemon(client);
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) throw new Error('No window available for streaming');

    const streamId = crypto.randomUUID();

    if (toolLoop) {
      // Delegate to tool loop — handles multi-turn tool execution
      toolLoop.run(
        messages,
        options ?? {},
        {
          onDelta: (delta) => {
            win.webContents.send(Channels.CHAT_STREAM_DELTA, { streamId, delta });
          },
          onEnd: (result) => {
            win.webContents.send(Channels.CHAT_STREAM_END, { streamId, result });
          },
          onFileAction: (action) => {
            win.webContents.send(Channels.CHAT_FILE_ACTION, { streamId, action });
          },
        },
        streamId,
      ).catch((err) => {
        win.webContents.send(Channels.CHAT_STREAM_END, {
          streamId,
          result: { receipt: null, violations: [{ description: sanitizeError(err) }] },
        });
      });

      return { streamId };
    }

    // Fallback: direct client streaming (no tool loop)
    const directStreamId = await c.chatStreamStart(
      messages,
      options,
      (delta) => {
        win.webContents.send(Channels.CHAT_STREAM_DELTA, { streamId, delta });
      },
      (result) => {
        win.webContents.send(Channels.CHAT_STREAM_END, { streamId, result });
      },
    );

    return { streamId };
  });

  // --- Chat Stream Stop ---

  ipcMain.handle(Channels.CHAT_STREAM_STOP, async (_event, streamId: unknown) => {
    if (typeof streamId !== 'string') return;
    toolLoop?.stop(streamId);
  });

  // --- Ask ---

  ipcMain.handle(Channels.CHAT_ASK_RESPOND, async (_event, askId: unknown, decision: unknown) => {
    if (!askGateState) return;
    if (typeof askId !== 'string' || typeof decision !== 'string') return;
    askGateState.respondToAsk(askId, decision as AskDecision);
  });

  ipcMain.handle(Channels.CHAT_MODELS, async () => {
    return requireDaemon(client).chatModels();
  });

  // --- Receipts ---

  ipcMain.handle(Channels.RECEIPTS_LIST, async (_event, filter?: { gate?: string; verdict?: string; limit?: number }) => {
    return requireDaemon(client).listReceipts(filter);
  });

  ipcMain.handle(Channels.RECEIPTS_DETAIL, async (_event, receiptId: string) => {
    return requireDaemon(client).receiptDetail(receiptId);
  });

  // --- Commit / Waive ---

  ipcMain.handle(Channels.COMMIT_PENDING, async () => {
    return requireDaemon(client).commitPending();
  });

  ipcMain.handle(Channels.COMMIT_FIX, async (_event, correctedText?: string) => {
    return requireDaemon(client).commitFix(correctedText);
  });

  ipcMain.handle(Channels.COMMIT_REVISE, async () => {
    return requireDaemon(client).commitRevise();
  });

  ipcMain.handle(Channels.COMMIT_PROCEED, async (_event, reason: string) => {
    return requireDaemon(client).commitProceed(reason);
  });

  // --- Templates ---

  ipcMain.handle(Channels.TEMPLATES_LIST, async () => {
    if (!templateManager) throw new Error('Template manager not available.');
    return templateManager.listTemplates();
  });

  ipcMain.handle(Channels.TEMPLATES_CURRENT, async () => {
    if (!templateManager) throw new Error('Template manager not available.');
    return templateManager.getState();
  });

  ipcMain.handle(Channels.TEMPLATES_APPLY, async (_event, req: TemplateApplyRequest) => {
    if (!templateManager) throw new Error('Template manager not available.');
    return templateManager.applyTemplate(req);
  });

  // --- File Operations ---

  ipcMain.handle(Channels.FILES_READ, async (_event, relativePath: unknown) => {
    if (!fileManager) throw new Error('File manager not available.');
    if (typeof relativePath !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Path must be a string.' };
    }
    return fileManager.readFile(relativePath);
  });

  ipcMain.handle(Channels.FILES_WRITE, async (_event, relativePath: unknown, content: unknown) => {
    if (!fileManager) throw new Error('File manager not available.');
    if (typeof relativePath !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Path must be a string.' };
    }
    if (typeof content !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Content must be a string.' };
    }
    return fileManager.writeFile(relativePath, content);
  });

  ipcMain.handle(Channels.FILES_OVERWRITE, async (_event, relativePath: unknown, content: unknown, expectedHash: unknown) => {
    if (!fileManager) throw new Error('File manager not available.');
    if (typeof relativePath !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Path must be a string.' };
    }
    if (typeof content !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Content must be a string.' };
    }
    if (typeof expectedHash !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Expected hash must be a string.' };
    }
    return fileManager.overwriteFile(relativePath, content, expectedHash);
  });

  ipcMain.handle(Channels.FILES_LIST, async (_event, relativePath: unknown) => {
    if (!fileManager) throw new Error('File manager not available.');
    if (typeof relativePath !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Path must be a string.' };
    }
    return fileManager.listDir(relativePath);
  });

  ipcMain.handle(Channels.FILES_MKDIR, async (_event, relativePath: unknown) => {
    if (!fileManager) throw new Error('File manager not available.');
    if (typeof relativePath !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Path must be a string.' };
    }
    return fileManager.mkdir(relativePath);
  });

  ipcMain.handle(Channels.FILES_COPY, async (_event, srcRelative: unknown, destRelative: unknown) => {
    if (!fileManager) throw new Error('File manager not available.');
    if (typeof srcRelative !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Source path must be a string.' };
    }
    if (typeof destRelative !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Destination path must be a string.' };
    }
    return fileManager.copyFile(srcRelative, destRelative);
  });

  ipcMain.handle(Channels.FILES_MOVE, async (_event, srcRelative: unknown, destRelative: unknown) => {
    if (!fileManager) throw new Error('File manager not available.');
    if (typeof srcRelative !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Source path must be a string.' };
    }
    if (typeof destRelative !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Destination path must be a string.' };
    }
    return fileManager.moveFile(srcRelative, destRelative);
  });

  ipcMain.handle(Channels.FILES_DELETE, async (_event, relativePath: unknown) => {
    if (!fileManager) throw new Error('File manager not available.');
    if (typeof relativePath !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Path must be a string.' };
    }
    return fileManager.deleteFile(relativePath);
  });

  ipcMain.handle(Channels.FILES_PATCH, async (_event, relativePath: unknown, patch: unknown, expectedHash: unknown) => {
    if (!fileManager) throw new Error('File manager not available.');
    if (typeof relativePath !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Path must be a string.' };
    }
    if (typeof patch !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Patch must be a string.' };
    }
    if (typeof expectedHash !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Expected hash must be a string.' };
    }
    return fileManager.patchFile(relativePath, patch, expectedHash);
  });

  ipcMain.handle(Channels.FILES_FIND, async (_event, basePath: unknown, pattern: unknown) => {
    if (!fileManager) throw new Error('File manager not available.');
    if (typeof basePath !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Base path must be a string.' };
    }
    const pat = typeof pattern === 'string' ? pattern : undefined;
    return fileManager.fileFind(basePath, pat);
  });

  ipcMain.handle(Channels.FILES_GREP, async (_event, query: unknown, basePath: unknown) => {
    if (!fileManager) throw new Error('File manager not available.');
    if (typeof query !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Query must be a string.' };
    }
    const bp = typeof basePath === 'string' ? basePath : '.';
    return fileManager.fileGrep(query, bp);
  });

  // --- Backend Config ---

  ipcMain.handle(Channels.BACKEND_STATUS, async () => {
    if (!client || !governorDir || !configIO) {
      return { state: 'daemon_unhealthy' as const, models: [], message: 'Clerk engine is not ready.' };
    }
    return probeBackend(client, governorDir, configIO);
  });

  ipcMain.handle(Channels.BACKEND_CONFIGURE, async (_event, config: unknown): Promise<BackendConfigureResult> => {
    if (!client || !governorDir || !configIO) {
      return { ok: false, error: { code: 'DAEMON_NOT_READY', message: 'Clerk engine is not ready.' } };
    }

    const cfg = config as BackendConfig;

    // 1. Validate
    const validationErr = validateBackendConfig(cfg);
    if (validationErr) {
      return { ok: false, error: { code: 'INVALID_CONFIG', message: validationErr } };
    }

    // 2. Write daemon.conf
    try {
      writeDaemonConf(governorDir, cfg, configIO);
    } catch (err) {
      return { ok: false, error: { code: 'WRITE_FAILED', message: sanitizeError(err) } };
    }

    // 3. Restart daemon
    try {
      client.restart();
    } catch (err) {
      return { ok: false, error: { code: 'RESTART_FAILED', message: sanitizeError(err) } };
    }

    // 4. Poll health up to 5s
    let healthOk = false;
    for (let i = 0; i < 10; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const h = await client.health();
        if (h.status === 'ok') { healthOk = true; break; }
      } catch { /* keep polling */ }
    }

    if (!healthOk) {
      return { ok: false, error: { code: 'RESTART_FAILED', message: 'Daemon did not become healthy after restart.' } };
    }

    // 5. Probe backend
    const status = await probeBackend(client, governorDir, configIO);
    if (status.state !== 'ready') {
      const code = status.state === 'unreachable' ? 'BACKEND_UNREACHABLE'
        : cfg.type === 'anthropic' ? 'AUTH_FAILED'
        : 'NO_MODELS';
      const msg = cfg.type === 'anthropic' ? 'Check your API key.'
        : cfg.type === 'ollama' ? `Make sure Ollama is running at ${cfg.ollamaUrl || 'http://localhost:11434'}.`
        : `Couldn't find the required command in PATH.`;
      return { ok: false, error: { code, message: msg } };
    }

    // 6. Re-apply persisted template (best-effort)
    templateManager?.applyPersistedTemplate().catch(err =>
      console.error('[clerk] template re-apply after restart:', err)
    );

    return { ok: true, status };
  });

  // --- Settings ---

  ipcMain.handle(Channels.SETTINGS_GET_ALL, async () => {
    if (!settingsManager) return { friendlyMode: true };
    return settingsManager.getAll();
  });

  ipcMain.handle(Channels.SETTINGS_SET, async (_event, partial: unknown) => {
    if (!settingsManager) return { friendlyMode: true };
    if (typeof partial !== 'object' || partial === null) return settingsManager.getAll();
    return settingsManager.set(partial as Partial<{ friendlyMode: boolean }>);
  });

  // --- File Attachments (absolute read for drag-and-drop) ---

  const MAX_ATTACH_SIZE = 2 * 1024 * 1024; // 2 MB

  ipcMain.handle(Channels.FILES_READ_ABSOLUTE, async (_event, absolutePath: unknown) => {
    if (typeof absolutePath !== 'string' || !absolutePath) {
      return { ok: false, error: 'Invalid file path.' };
    }
    try {
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(absolutePath);
      } catch {
        return { ok: false, error: `File not found: couldn't read that file.` };
      }
      if (stat.isSymbolicLink()) {
        return { ok: false, error: "Links can't be attached directly." };
      }
      if (stat.isDirectory()) {
        return { ok: false, error: "Folders can't be attached." };
      }
      if (!stat.isFile()) {
        return { ok: false, error: "That item can't be attached." };
      }
      if (stat.size > MAX_ATTACH_SIZE) {
        return { ok: false, error: 'That file is too large (max 2 MB).' };
      }
      const buf = fs.readFileSync(absolutePath);
      // NUL byte check
      if (buf.includes(0)) {
        return { ok: false, error: 'That file appears to be binary.' };
      }
      // UTF-8 roundtrip check
      const text = buf.toString('utf-8');
      const roundtrip = Buffer.from(text, 'utf-8');
      if (!buf.equals(roundtrip)) {
        return { ok: false, error: 'That file appears to be binary.' };
      }
      const contentHash = crypto.createHash('sha256').update(buf).digest('hex');
      return { ok: true, content: text, contentHash, size: buf.length };
    } catch (err) {
      return { ok: false, error: sanitizeError(err) };
    }
  });

  // --- Conversations ---

  ipcMain.handle(Channels.CONV_LIST, async () => {
    if (!conversationManager) return { conversations: [], activeId: null };
    return conversationManager.list();
  });

  ipcMain.handle(Channels.CONV_LOAD, async (_event, id: unknown) => {
    if (!conversationManager) return { ok: false, error: 'Conversations not available.' };
    if (typeof id !== 'string') return { ok: false, error: 'ID must be a string.' };
    return conversationManager.load(id);
  });

  ipcMain.handle(Channels.CONV_SAVE, async (_event, data: unknown) => {
    if (!conversationManager) return { ok: false, error: 'Conversations not available.' };
    return conversationManager.save(data as ConversationData);
  });

  ipcMain.handle(Channels.CONV_DELETE, async (_event, id: unknown) => {
    if (!conversationManager) return false;
    if (typeof id !== 'string') return false;
    return conversationManager.delete(id);
  });

  ipcMain.handle(Channels.CONV_RENAME, async (_event, id: unknown, title: unknown) => {
    if (!conversationManager) return null;
    if (typeof id !== 'string' || typeof title !== 'string') return null;
    return conversationManager.rename(id, title);
  });

  ipcMain.handle(Channels.CONV_SET_ACTIVE, async (_event, id: unknown) => {
    if (!conversationManager) return;
    conversationManager.setActive(typeof id === 'string' ? id : null);
  });

  // --- Activity Feed ---

  ipcMain.handle(Channels.ACTIVITY_LIST, async (_event, limit?: number) => {
    if (!activityManager) return { events: [] };
    return { events: activityManager.getRecent(typeof limit === 'number' ? limit : 200) };
  });
}

// SPDX-License-Identifier: Apache-2.0
/**
 * IPC handler registration — wires all channels to GovernorClient methods.
 * Each handler is a thin forwarding layer; no business logic here.
 *
 * When the daemon resolver fails, client/monitor are null. Handlers that
 * need the daemon throw a descriptive error so the renderer knows why.
 */

import crypto from 'node:crypto';
import { ipcMain, BrowserWindow } from 'electron';
import { Channels } from '../shared/channels.js';
import { GovernorClient } from './rpc-client.js';
import { ConnectionMonitor } from './connection.js';
import type { TemplateManager } from './template-manager.js';
import type { FileManager } from './file-manager.js';
import type { ToolLoop, AskGate } from './tool-loop.js';
import type { ActivityManager } from './activity-manager.js';
import type { SettingsManager } from './settings-manager.js';
import type { DaemonResolveResult } from './daemon-resolver.js';
import type { TemplateApplyRequest, AskRequest, AskGrantToken, AskDecision } from '../shared/types.js';

function requireDaemon(client: GovernorClient | null): GovernorClient {
  if (!client) throw new Error('Governor daemon not available. Check daemon status for details.');
  return client;
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
          result: { receipt: null, violations: [{ description: String(err) }] },
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

  // --- Activity Feed ---

  ipcMain.handle(Channels.ACTIVITY_LIST, async (_event, limit?: number) => {
    if (!activityManager) return { events: [] };
    return { events: activityManager.getRecent(typeof limit === 'number' ? limit : 200) };
  });
}

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
import type { ToolLoop } from './tool-loop.js';
import type { DaemonResolveResult } from './daemon-resolver.js';
import type { TemplateApplyRequest } from '../shared/types.js';

function requireDaemon(client: GovernorClient | null): GovernorClient {
  if (!client) throw new Error('Governor daemon not available. Check daemon status for details.');
  return client;
}

export function registerIpcHandlers(
  client: GovernorClient | null,
  monitor: ConnectionMonitor | null,
  daemonResult: DaemonResolveResult,
  templateManager: TemplateManager | null = null,
  fileManager: FileManager | null = null,
  toolLoop: ToolLoop | null = null,
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

  ipcMain.handle(Channels.FILES_LIST, async (_event, relativePath: unknown) => {
    if (!fileManager) throw new Error('File manager not available.');
    if (typeof relativePath !== 'string') {
      return { ok: false, code: 'PATH_DENIED', message: 'Path must be a string.' };
    }
    return fileManager.listDir(relativePath);
  });
}

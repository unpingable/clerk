// SPDX-License-Identifier: Apache-2.0
/**
 * Electron main process — app lifecycle, BrowserWindow.
 *
 * Resolves the governor daemon binary before spawning. If the resolver fails,
 * the app still launches — the renderer gets a typed failure state and shows
 * a first-run screen instead of silently hanging.
 */

import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GovernorClient } from './rpc-client.js';
import { ConnectionMonitor } from './connection.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { resolveGovernorDaemon } from './daemon-resolver.js';
import { TemplateManager } from './template-manager.js';
import type { DaemonResolveResult } from './daemon-resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const governorDir = process.env['GOVERNOR_DIR'] || process.cwd();
const governorMode = process.env['GOVERNOR_MODE'] || 'general';
const isE2E = process.env['CLERK_E2E'] === '1';

if (isE2E) {
  console.error(`[clerk] E2E mode: governor_dir=${governorDir} mode=${governorMode}`);
}

// --- Resolve daemon binary ---

let resolveResult: DaemonResolveResult;
let client: GovernorClient | null = null;
let monitor: ConnectionMonitor | null = null;
let templateManager: TemplateManager | null = null;

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 500,
    minHeight: 400,
    title: 'Clerk',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: !isE2E,
    },
  });

  const rendererPath = path.join(__dirname, '..', 'renderer', 'index.html');
  win.loadFile(rendererPath);

  return win;
}

app.whenReady().then(() => {
  resolveResult = resolveGovernorDaemon();

  if (resolveResult.ok) {
    console.error(`[clerk] daemon resolved: ${resolveResult.path} (${resolveResult.version}) via ${resolveResult.source}`);
    client = new GovernorClient(resolveResult.path, governorDir, governorMode);
    monitor = new ConnectionMonitor(client);
    client.start();

    templateManager = new TemplateManager(client, governorDir);
    templateManager.loadPersistedSelection();
    registerIpcHandlers(client, monitor, resolveResult, templateManager);
    createWindow();
    monitor.start();

    // Apply persisted template async — non-blocking, logged
    templateManager.applyPersistedTemplate().then((result) => {
      if (result.ok) {
        console.error(`[clerk] template applied: ${result.templateId}`);
      } else if (!result.ok) {
        console.error(`[clerk] template apply failed: ${result.error.code} — ${result.error.message}`);
      }
    }).catch((err) => {
      console.error(`[clerk] template apply error:`, err);
    });
  } else {
    console.error(`[clerk] daemon not found: ${resolveResult.reason} — ${resolveResult.detail}`);
    console.error(`[clerk] tried: ${resolveResult.tried.join(', ')}`);
    // Still launch the window — renderer will show the first-run screen
    registerIpcHandlers(null, null, resolveResult);
    createWindow();
  }
});

app.on('window-all-closed', () => {
  monitor?.stop();
  client?.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

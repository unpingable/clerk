// SPDX-License-Identifier: Apache-2.0
/**
 * Electron main process — app lifecycle, BrowserWindow.
 *
 * Resolves the governor daemon binary before spawning. If the resolver fails,
 * the app still launches — the renderer gets a typed failure state and shows
 * a first-run screen instead of silently hanging.
 */

import { app, BrowserWindow, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { GovernorClient } from './rpc-client.js';
import { GovernorBackend } from './governor-backend.js';
import { ConnectionMonitor } from './connection.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { resolveGovernorDaemon } from './daemon-resolver.js';
import { TemplateManager } from './template-manager.js';
import { FileManager } from './file-manager.js';
import { ToolLoop } from './tool-loop.js';
import { ActivityLog } from './activity-log.js';
import { ActivityManager } from './activity-manager.js';
import { SettingsManager } from './settings-manager.js';
import { ConversationManager } from './conversation-manager.js';
import { makeAskGate } from './ipc-handlers.js';
import type { AskGateState } from './ipc-handlers.js';
import { getTemplateById, getDefaultTemplate } from '../shared/templates.js';
import type { FileManagerIO } from './file-manager.js';
import type { ActivityLogIO } from './activity-log.js';
import type { DaemonResolveResult } from './daemon-resolver.js';
import type { BackendConfigIO } from './backend-config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const governorDir = process.env['GOVERNOR_DIR'] || process.cwd();
const governorMode = process.env['GOVERNOR_MODE'] || 'general';
const isE2E = process.env['CLERK_E2E'] === '1';

if (isE2E) {
  console.error(`[clerk] E2E mode: governor_dir=${governorDir} mode=${governorMode}`);
  // Override userData for test isolation
  const customUserData = process.env['CLERK_USER_DATA'];
  if (customUserData) {
    app.setPath('userData', customUserData);
    console.error(`[clerk] E2E userData override: ${customUserData}`);
  }
}

// --- Resolve daemon binary ---

let resolveResult: DaemonResolveResult;
let backend: GovernorBackend | null = null;
let monitor: ConnectionMonitor | null = null;
let templateManager: TemplateManager | null = null;
let fileManager: FileManager | null = null;
let toolLoop: ToolLoop | null = null;
let activityManager: ActivityManager | null = null;
let askGateState: AskGateState | null = null;

const fsIO: FileManagerIO = {
  lstat: (p) => fs.promises.lstat(p),
  stat: (p) => fs.promises.stat(p),
  readFileRaw: (p) => fs.promises.readFile(p),
  readFile: (p, enc) => fs.promises.readFile(p, enc),
  open: async (p, flags) => {
    const fh = await fs.promises.open(p, flags);
    return {
      write: (data: string) => fh.writeFile(data),
      close: () => fh.close(),
    };
  },
  writeFile: (p, data) => fs.promises.writeFile(p, data, { encoding: 'utf-8' }),
  rename: (src, dst) => fs.promises.rename(src, dst),
  realpath: (p) => fs.promises.realpath(p),
  access: (p) => fs.promises.access(p),
  readdir: (p, opts) => fs.promises.readdir(p, opts),
  mkdir: (p) => fs.promises.mkdir(p),
  copyFile: (src, dest, flags?) => fs.promises.copyFile(src, dest, flags),
};

const activityLogIO: ActivityLogIO = {
  appendFile: (p, data) => fs.promises.appendFile(p, data, { encoding: 'utf-8' }),
  readFile: (p, enc) => fs.promises.readFile(p, enc),
  stat: (p) => fs.promises.stat(p),
  writeFile: (p, data) => fs.promises.writeFile(p, data, { encoding: 'utf-8' }),
  readBytes: async (p, start, length) => {
    const fh = await fs.promises.open(p, 'r');
    try {
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, start);
      return buf;
    } finally {
      await fh.close();
    }
  },
  rename: (src, dst) => fs.promises.rename(src, dst),
  existsSync: (p) => fs.existsSync(p),
  mkdirSync: (p, opts) => fs.mkdirSync(p, opts),
  writeFileSync: (p, data) => fs.writeFileSync(p, data, { encoding: 'utf-8' }),
};

const backendConfigIO: BackendConfigIO = {
  writeFileSync: (p, d) => fs.writeFileSync(p, d),
  renameSync: (s, d) => fs.renameSync(s, d),
  existsSync: (p) => fs.existsSync(p),
  unlinkSync: (p) => fs.unlinkSync(p),
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
};

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

  // Open external links (target="_blank" from markdown) in the OS browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:') || url.startsWith('http:') || url.startsWith('mailto:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  return win;
}

app.whenReady().then(() => {
  // Settings + conversations work without the daemon — create unconditionally
  const settingsManager = new SettingsManager(app.getPath('userData'));
  const conversationManager = new ConversationManager(app.getPath('userData'));

  resolveResult = resolveGovernorDaemon();

  if (resolveResult.ok) {
    console.error(`[clerk] daemon resolved: ${resolveResult.path} (${resolveResult.version}) via ${resolveResult.source}`);
    const client = new GovernorClient(resolveResult.path, governorDir, governorMode);
    backend = new GovernorBackend(client);
    monitor = new ConnectionMonitor(backend);
    backend.start();

    // Activity feed — create before TemplateManager/FileManager so they can record events
    const activityLog = new ActivityLog(governorDir, activityLogIO);
    activityManager = new ActivityManager(activityLog, () => templateManager!.getAppliedModeInfo());

    // GovernorBackend satisfies TemplateManagerClient and FileManagerClient
    templateManager = new TemplateManager(backend, governorDir, undefined, activityManager);
    templateManager.loadPersistedSelection();
    activityManager.init().catch((err) => {
      console.error('[clerk] activity log init error:', err);
    });

    fileManager = new FileManager(
      backend,
      governorDir,
      () => {
        const state = templateManager!.getState();
        const tmpl = getTemplateById(state.appliedTemplateId) ?? getDefaultTemplate();
        return { appliedTemplateId: state.appliedTemplateId, appliedProfile: tmpl.governorProfile };
      },
      fsIO,
      activityManager,
    );
    const win = createWindow();
    askGateState = makeAskGate(() => BrowserWindow.getAllWindows()[0]);
    // GovernorBackend satisfies ToolLoopClient
    toolLoop = new ToolLoop(backend, fileManager, askGateState.gate, activityManager);
    registerIpcHandlers(backend, monitor, resolveResult, templateManager, fileManager, toolLoop, activityManager, askGateState, settingsManager, conversationManager, governorDir, backendConfigIO);
    activityManager.attachBroadcast(win.webContents);
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
    registerIpcHandlers(null, null, resolveResult, null, null, null, null, null, settingsManager, conversationManager, null, null);
    createWindow();
  }
});

app.on('window-all-closed', () => {
  monitor?.stop();
  backend?.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

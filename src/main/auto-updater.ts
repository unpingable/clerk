// SPDX-License-Identifier: Apache-2.0
/**
 * Auto-updater — checks for updates via GitHub Releases.
 *
 * Uses electron-updater with these defaults:
 *   - Checks on startup (after 10s delay) and every 4 hours
 *   - Never auto-downloads — user must confirm
 *   - Emits state changes over IPC for the renderer to display
 *
 * In dev/E2E mode, the updater is a no-op.
 */

import { autoUpdater } from 'electron-updater';
import { app, type BrowserWindow } from 'electron';
import type { UpdateInfo } from 'electron-updater';
import type { UpdateStatus } from '../shared/types.js';
import { Channels } from '../shared/channels.js';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
const STARTUP_DELAY_MS = 10_000; // 10s after launch

let currentStatus: UpdateStatus = { state: 'idle' };
let broadcastWindow: BrowserWindow | null = null;
let checkTimer: ReturnType<typeof setInterval> | null = null;

function setStatus(status: UpdateStatus): void {
  currentStatus = status;
  try {
    broadcastWindow?.webContents?.send(Channels.UPDATE_STATUS, status);
  } catch {
    // Window may be destroyed
  }
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus;
}

export function initAutoUpdater(win: BrowserWindow): void {
  // Skip in dev/E2E — autoUpdater requires packaged app
  if (!isPackaged()) return;

  broadcastWindow = win;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    setStatus({ state: 'checking' });
  });

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    setStatus({
      state: 'available',
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined,
    });
  });

  autoUpdater.on('update-not-available', () => {
    setStatus({ state: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    setStatus({ state: 'downloading', percent: Math.round(progress.percent) });
  });

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    setStatus({ state: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    setStatus({ state: 'error', message: err?.message ?? 'Update check failed' });
  });

  // First check after startup delay
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, STARTUP_DELAY_MS);

  // Periodic checks
  checkTimer = setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, CHECK_INTERVAL_MS);
}

export function checkForUpdates(): void {
  if (!isPackaged()) return;
  autoUpdater.checkForUpdates().catch(() => {});
}

export function downloadUpdate(): void {
  if (!isPackaged()) return;
  autoUpdater.downloadUpdate().catch(() => {});
}

export function installUpdate(): void {
  if (!isPackaged()) return;
  autoUpdater.quitAndInstall(false, true);
}

export function stopAutoUpdater(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

function isPackaged(): boolean {
  return app.isPackaged;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * System tray — background presence with context menu.
 *
 * Features:
 *   - Tray icon with context menu (Show/Hide, New Chat, Quit)
 *   - Native notifications for completed responses and errors
 *   - Minimize-to-tray behavior (close button hides, doesn't quit)
 *
 * The tray uses a text-based icon fallback since we don't ship icon assets yet.
 */

import { Tray, Menu, nativeImage, Notification, BrowserWindow, app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let tray: Tray | null = null;
let minimizeToTray = true;

export function initSystemTray(win: BrowserWindow): void {
  // Skip in E2E — tray intercepts close and breaks test teardown
  if (process.env['CLERK_E2E'] === '1') return;

  // Create a simple 16x16 icon (1-pixel template image as fallback)
  const iconPath = getIconPath();
  const icon = iconPath
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : createFallbackIcon();

  tray = new Tray(icon);
  tray.setToolTip('Clerk');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Clerk',
      click: () => {
        win.show();
        win.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        minimizeToTray = false;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (win.isVisible()) {
      win.focus();
    } else {
      win.show();
      win.focus();
    }
  });

  // Close button hides to tray instead of quitting
  win.on('close', (e) => {
    if (minimizeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
}

export function destroySystemTray(): void {
  tray?.destroy();
  tray = null;
}

/**
 * Show a native OS notification.
 * Only fires when the window is not focused (no point notifying if they're looking at it).
 */
export function showNotification(title: string, body: string): void {
  if (process.env['CLERK_E2E'] === '1') return;
  const win = BrowserWindow.getAllWindows()[0];
  if (win?.isFocused()) return;
  if (!Notification.isSupported()) return;

  const notification = new Notification({ title, body, silent: true });
  notification.on('click', () => {
    win?.show();
    win?.focus();
  });
  notification.show();
}

function getIconPath(): string | null {
  // Check for icon in build resources
  const candidates = [
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(app.getAppPath(), 'build', 'tray-icon.png'),
  ];
  for (const p of candidates) {
    try {
      fs.accessSync(p);
      return p;
    } catch {
      // Not found, try next
    }
  }
  return null;
}

function createFallbackIcon(): Electron.NativeImage {
  // 16x16 simple "C" icon as a data URL
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA' +
    'dElEQVR42mNgGAWjIUAAAQxkK/7//z8DEDMgYwYgZkDHDOgKGBgYGP4DMSMQMwExI5p8' +
    'IxAbAjEDFgwywQjqEkYsLjEE0o1YXILTBYxQFzEiuYgRl5cYkVzEiC8MGLBEMiO+dMCI' +
    'HMkMxKYBI7ZIZiA2DRgBABnkLDU4WPz0AAAAAElFTkSuQmCC',
  );
}

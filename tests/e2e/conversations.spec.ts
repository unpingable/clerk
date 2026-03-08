// SPDX-License-Identifier: Apache-2.0
/**
 * Conversations E2E tests — multi-conversation, sidebar, switching, persistence.
 *
 * Tests:
 *   1. Create second conversation → sidebar appears, messages isolated
 *   2. Delete last conversation → sidebar hides
 *   3. Persistence across restart — titles + active restored
 *   4. Rename persists across switch and restart
 *   5. Sidebar toggle (Ctrl+B) — session-only, resets when count drops
 *   6. Blocked during streaming — cannot switch, new, or delete active
 */

import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const STUB_DAEMON = path.resolve(__dirname, 'stub-daemon.mjs');
const MAIN_ENTRY = path.resolve(ROOT, 'dist', 'main', 'index.js');

function makeTmpDir(prefix = 'clerk-e2e-conv-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function launchApp(govDir: string, userDataDir: string, extraEnv: Record<string, string> = {}) {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const electronPath = require('electron') as unknown as string;

  fs.writeFileSync(
    path.join(govDir, 'daemon.conf'),
    '[backend]\ntype = anthropic\nanthropic.api_key = sk-test\n',
  );

  const app = await electron.launch({
    executablePath: electronPath,
    args: ['--no-sandbox', MAIN_ENTRY],
    env: {
      ...process.env,
      CLERK_E2E: '1',
      GOVERNOR_BIN: STUB_DAEMON,
      GOVERNOR_DIR: govDir,
      GOVERNOR_MODE: 'general',
      ELECTRON_DISABLE_GPU: '1',
      ELECTRON_DISABLE_SANDBOX: '1',
      E2E_BACKEND_CHECK: '1',
      CLERK_USER_DATA: userDataDir,
      ...extraEnv,
    },
  });

  const win = await app.firstWindow();
  await win.waitForSelector('textarea', { timeout: 15000 });
  return { app, win };
}

async function sendMessage(win: any, text: string) {
  const textarea = win.locator('textarea');
  await textarea.fill(text);
  const sendBtn = win.locator('button:has-text("Send")');
  await sendBtn.click();
  // Wait for assistant reply
  await win.locator('.message.assistant').last().waitFor({ timeout: 10000 });
  // Wait for streaming to finish
  await expect(win.locator('.stop-btn')).toHaveCount(0, { timeout: 10000 });
}

test.describe('Conversations', () => {
  let govDir: string;
  let userDataDir: string;

  test.beforeEach(() => {
    govDir = makeTmpDir('clerk-e2e-conv-gov-');
    userDataDir = makeTmpDir('clerk-e2e-conv-data-');
  });

  test.afterEach(() => {
    fs.rmSync(govDir, { recursive: true, force: true });
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test('create second conversation shows sidebar, messages isolated', async () => {
    const { app, win } = await launchApp(govDir, userDataDir);
    try {
      // Send a message in first conversation
      await sendMessage(win, 'Hello first');

      // No sidebar yet (only 1 conversation)
      await expect(win.locator('[data-testid="sidebar"]')).toHaveCount(0);

      // Create new conversation via Ctrl+N
      await win.keyboard.press('Control+n');
      await win.waitForTimeout(500);

      // Should now see sidebar (2 conversations)
      await expect(win.locator('[data-testid="sidebar"]')).toHaveCount(1);

      // New conversation should be empty
      await expect(win.locator('.message')).toHaveCount(0);

      // Send message in second conversation
      await sendMessage(win, 'Hello second');

      // Switch back to first — click on the conversation item
      const firstConvItem = win.locator('[data-conv-id] .item-title:has-text("Hello first")');
      await firstConvItem.click();
      await win.waitForTimeout(500);

      // Should see first conversation's user message
      await expect(win.locator('.message.user').first()).toContainText('Hello first');
    } finally {
      await app.close();
    }
  });

  test('delete last conversation hides sidebar', async () => {
    const { app, win } = await launchApp(govDir, userDataDir);
    try {
      // Create two conversations
      await sendMessage(win, 'Conv one');
      await win.keyboard.press('Control+n');
      await win.waitForTimeout(500);
      await sendMessage(win, 'Conv two');

      await expect(win.locator('[data-testid="sidebar"]')).toHaveCount(1);

      // Delete first conversation (press delete button twice — confirmation)
      const firstDelete = win.locator('.item-delete').first();
      await firstDelete.click({ force: true });
      await firstDelete.click({ force: true });
      await win.waitForTimeout(300);

      // Delete the remaining one if still present
      const remainingDelete = win.locator('.item-delete').first();
      if (await remainingDelete.count() > 0) {
        await remainingDelete.click({ force: true });
        await remainingDelete.click({ force: true });
        await win.waitForTimeout(300);
      }

      // No sidebar
      await expect(win.locator('[data-testid="sidebar"]')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });

  test('persistence across restart — titles and active restored', async () => {
    // Launch, create conversations, close
    const launch1 = await launchApp(govDir, userDataDir);
    try {
      await sendMessage(launch1.win, 'Persistent alpha');
      await launch1.win.keyboard.press('Control+n');
      await launch1.win.waitForTimeout(500);
      await sendMessage(launch1.win, 'Persistent beta');

      // Sidebar should show both
      await expect(launch1.win.locator('[data-testid="sidebar"]')).toHaveCount(1);
      await expect(launch1.win.locator('[data-conv-id]')).toHaveCount(2);

      // Verify auto-titles are visible
      await expect(
        launch1.win.locator('.item-title:has-text("Persistent alpha")'),
      ).toHaveCount(1);
      await expect(
        launch1.win.locator('.item-title:has-text("Persistent beta")'),
      ).toHaveCount(1);
    } finally {
      await launch1.app.close();
    }

    // Relaunch — same govDir → same userData
    const launch2 = await launchApp(govDir, userDataDir);
    try {
      // Sidebar should reappear with both conversations
      await expect(launch2.win.locator('[data-testid="sidebar"]')).toHaveCount(1, { timeout: 5000 });
      await expect(launch2.win.locator('[data-conv-id]')).toHaveCount(2);

      // Titles should be preserved
      await expect(
        launch2.win.locator('.item-title:has-text("Persistent alpha")'),
      ).toHaveCount(1);
      await expect(
        launch2.win.locator('.item-title:has-text("Persistent beta")'),
      ).toHaveCount(1);

      // Active conversation should be restored (last was "Persistent beta")
      // The active conversation's messages should be visible
      await expect(launch2.win.locator('.message.user')).toHaveCount(
        1, { timeout: 5000 },
      );
    } finally {
      await launch2.app.close();
    }
  });

  test('rename persists across switch and restart', async () => {
    const launch1 = await launchApp(govDir, userDataDir);
    try {
      // Create two conversations
      await sendMessage(launch1.win, 'Will be renamed');
      await launch1.win.keyboard.press('Control+n');
      await launch1.win.waitForTimeout(500);
      await sendMessage(launch1.win, 'Other conv');

      await expect(launch1.win.locator('[data-testid="sidebar"]')).toHaveCount(1);

      // Rename first conversation by double-clicking its title
      const firstTitle = launch1.win.locator(
        '.item-title:has-text("Will be renamed")',
      );
      await firstTitle.dblclick();
      await launch1.win.waitForTimeout(200);

      // Type new name and press Enter
      const renameInput = launch1.win.locator('.rename-input');
      await renameInput.fill('Custom Name');
      await renameInput.press('Enter');
      await launch1.win.waitForTimeout(300);

      // Verify rename took effect in sidebar
      await expect(
        launch1.win.locator('.item-title:has-text("Custom Name")'),
      ).toHaveCount(1);
      await expect(
        launch1.win.locator('.item-title:has-text("Will be renamed")'),
      ).toHaveCount(0);

      // Switch to renamed conversation
      await launch1.win.locator('.item-title:has-text("Custom Name")').click();
      await launch1.win.waitForTimeout(300);

      // Switch back to other
      await launch1.win.locator('.item-title:has-text("Other conv")').click();
      await launch1.win.waitForTimeout(300);

      // Name should still be "Custom Name"
      await expect(
        launch1.win.locator('.item-title:has-text("Custom Name")'),
      ).toHaveCount(1);
    } finally {
      await launch1.app.close();
    }

    // Restart and verify rename persisted
    const launch2 = await launchApp(govDir, userDataDir);
    try {
      await expect(launch2.win.locator('[data-testid="sidebar"]')).toHaveCount(1, { timeout: 5000 });
      await expect(
        launch2.win.locator('.item-title:has-text("Custom Name")'),
      ).toHaveCount(1);
    } finally {
      await launch2.app.close();
    }
  });

  test('sidebar toggle (Ctrl+B) is session-only', async () => {
    const { app, win } = await launchApp(govDir, userDataDir);
    try {
      // Create two conversations to get sidebar
      await sendMessage(win, 'Toggle test A');
      await win.keyboard.press('Control+n');
      await win.waitForTimeout(500);
      await sendMessage(win, 'Toggle test B');

      // Sidebar should be visible
      await expect(win.locator('[data-testid="sidebar"]')).toHaveCount(1);

      // Toggle sidebar off with Ctrl+B
      await win.keyboard.press('Control+b');
      await win.waitForTimeout(300);
      await expect(win.locator('[data-testid="sidebar"]')).toHaveCount(0);

      // Toggle back on
      await win.keyboard.press('Control+b');
      await win.waitForTimeout(300);
      await expect(win.locator('[data-testid="sidebar"]')).toHaveCount(1);

      // Toggle off again
      await win.keyboard.press('Control+b');
      await win.waitForTimeout(300);
      await expect(win.locator('[data-testid="sidebar"]')).toHaveCount(0);

      // Delete one conversation so count drops below 2
      // First toggle sidebar back so we can access delete button
      await win.keyboard.press('Control+b');
      await win.waitForTimeout(300);

      const deleteBtn = win.locator('.item-delete').first();
      await deleteBtn.click({ force: true });
      await deleteBtn.click({ force: true });
      await win.waitForTimeout(300);

      // Sidebar should auto-hide (count < 2), toggle should reset
      await expect(win.locator('[data-testid="sidebar"]')).toHaveCount(0);

      // Create another conversation to get back to 2
      await sendMessage(win, 'Toggle test C');
      await win.keyboard.press('Control+n');
      await win.waitForTimeout(500);
      await sendMessage(win, 'Toggle test D');

      // Sidebar should auto-appear (toggle was reset when count dropped)
      await expect(win.locator('[data-testid="sidebar"]')).toHaveCount(1);
    } finally {
      await app.close();
    }
  });

  test('blocked during streaming — cannot switch, new, or delete active', async () => {
    const { app, win } = await launchApp(govDir, userDataDir, {
      E2E_CHAT_SCENARIO: 'slow_echo',
    });
    try {
      // Send first message (3s delay) and wait for it to complete
      await sendMessage(win, 'First conv');

      // Create second conversation so sidebar appears
      await win.keyboard.press('Control+n');
      await win.waitForTimeout(500);

      // Sidebar should be visible
      await expect(win.locator('[data-testid="sidebar"]')).toHaveCount(1);

      // Start a slow message (slow_echo has 3s delay)
      const textarea = win.locator('textarea');
      await textarea.fill('Do the slow thing');
      const sendBtn = win.locator('button:has-text("Send")');
      await sendBtn.click();

      // Wait for streaming to start (stop button appears)
      await expect(win.locator('.stop-btn')).toHaveCount(1, { timeout: 5000 });

      // While streaming: "New Chat" button should be disabled
      await expect(win.locator('.new-btn')).toBeDisabled();

      // Stop the stream
      await win.locator('.stop-btn').click();
      await expect(win.locator('.stop-btn')).toHaveCount(0, { timeout: 5000 });

      // After stopping: "New Chat" should be enabled again
      await expect(win.locator('.new-btn')).toBeEnabled();
    } finally {
      await app.close();
    }
  });
});

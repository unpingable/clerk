// SPDX-License-Identifier: Apache-2.0
/**
 * Conversations E2E tests — multi-conversation, sidebar, switching.
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

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clerk-e2e-conv-'));
}

async function launchApp(govDir: string) {
  fs.writeFileSync(path.join(govDir, 'daemon.conf'), '[backend]\ntype = anthropic\napi_key = sk-test\n');

  const app = await electron.launch({
    args: [MAIN_ENTRY],
    env: {
      ...process.env,
      CLERK_E2E: '1',
      GOVERNOR_BIN: STUB_DAEMON,
      GOVERNOR_DIR: govDir,
      E2E_BACKEND_CHECK: '1',
    },
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  return { app, win };
}

async function waitForReady(win: any) {
  await win.locator('textarea').waitFor({ timeout: 15000 });
}

async function sendMessage(win: any, text: string) {
  const textarea = win.locator('textarea');
  await textarea.fill(text);
  const sendBtn = win.locator('button:has-text("Send")');
  await sendBtn.click();
  // Wait for assistant reply to appear
  await win.locator('.message.assistant').last().waitFor({ timeout: 10000 });
  // Wait for streaming to finish (stop button goes away)
  await expect(win.locator('.stop-btn')).toHaveCount(0, { timeout: 10000 });
}

test.describe('Conversations', () => {
  let govDir: string;

  test.beforeEach(() => {
    govDir = makeTmpDir();
  });

  test.afterEach(() => {
    fs.rmSync(govDir, { recursive: true, force: true });
  });

  test('create second conversation shows sidebar, messages isolated', async () => {
    const { app, win } = await launchApp(govDir);
    try {
      await waitForReady(win);

      // Send a message in first conversation
      await sendMessage(win, 'Hello first');

      // No sidebar yet (only 1 conversation)
      await expect(win.locator('.sidebar')).toHaveCount(0);

      // Create new conversation via Cmd+N
      await win.keyboard.press('Control+n');
      await win.waitForTimeout(500);

      // Should now see sidebar (2 conversations)
      await expect(win.locator('.sidebar')).toHaveCount(1);

      // New conversation should be empty
      await expect(win.locator('.message')).toHaveCount(0);

      // Send message in second conversation
      await sendMessage(win, 'Hello second');

      // Switch back to first — click on the conversation with "Hello first" title
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
    const { app, win } = await launchApp(govDir);
    try {
      await waitForReady(win);

      // Create two conversations
      await sendMessage(win, 'Conv one');
      await win.keyboard.press('Control+n');
      await win.waitForTimeout(500);
      await sendMessage(win, 'Conv two');

      await expect(win.locator('.sidebar')).toHaveCount(1);

      // Delete first conversation (press delete button twice)
      const firstDelete = win.locator('.item-delete').first();
      await firstDelete.click({ force: true });
      await firstDelete.click({ force: true });
      await win.waitForTimeout(300);

      // Should still have sidebar if there's still one saved conv shown
      // Delete the remaining one
      const remainingDelete = win.locator('.item-delete').first();
      if (await remainingDelete.count() > 0) {
        await remainingDelete.click({ force: true });
        await remainingDelete.click({ force: true });
        await win.waitForTimeout(300);
      }

      // No sidebar
      await expect(win.locator('.sidebar')).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
});

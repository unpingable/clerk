// SPDX-License-Identifier: Apache-2.0
/**
 * Capture screenshots of Clerk for README / docs.
 *
 * Usage:
 *   npm run build && npx tsx scripts/capture-screenshots.ts
 *
 * Requires the stub daemon (tests/e2e/stub-daemon.mjs) — no real backend needed.
 * Saves PNGs to docs/.
 */

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const DOCS = path.resolve(ROOT, 'docs');
const MAIN_ENTRY = path.resolve(ROOT, 'dist', 'main', 'index.js');
const STUB_DAEMON = path.resolve(ROOT, 'tests', 'e2e', 'stub-daemon.mjs');

async function main() {
  const govDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clerk-screenshots-gov-'));
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clerk-screenshots-data-'));

  // Write daemon.conf so the app boots to chat view
  fs.writeFileSync(
    path.join(govDir, 'daemon.conf'),
    '[backend]\ntype = anthropic\nanthropic.api_key = sk-test\n',
  );

  const require = createRequire(import.meta.url);
  const electronPath = require('electron') as unknown as string;

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
    },
  });

  const win = await app.firstWindow();
  await win.waitForSelector('textarea', { timeout: 15000 });

  // Set a reasonable window size
  await win.evaluate(() => {
    window.resizeTo(1100, 700);
  });
  await win.waitForTimeout(500);

  // --- Screenshot 1: Fresh chat (empty state) ---
  await win.screenshot({ path: path.join(DOCS, 'screenshot-welcome.png') });
  console.log('Captured: screenshot-welcome.png');

  // --- Screenshot 2: Chat with a message exchange ---
  const textarea = win.locator('textarea');
  await textarea.fill('What files are in my project directory?');
  const sendBtn = win.locator('button:has-text("Send")');
  await sendBtn.click();
  await win.locator('.message.assistant').last().waitFor({ timeout: 10000 });
  await win.locator('.stop-btn').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(DOCS, 'screenshot-chat.png') });
  console.log('Captured: screenshot-chat.png');

  // --- Screenshot 3: Multi-conversation sidebar ---
  await win.keyboard.press('Control+n');
  await win.waitForTimeout(500);
  await textarea.fill('Help me write a thank-you note');
  await sendBtn.click();
  await win.locator('.message.assistant').last().waitFor({ timeout: 10000 });
  await win.locator('.stop-btn').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(DOCS, 'screenshot-conversations.png') });
  console.log('Captured: screenshot-conversations.png');

  // --- Screenshot 4: Command palette ---
  await win.keyboard.press('Control+p');
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(DOCS, 'screenshot-command-palette.png') });
  console.log('Captured: screenshot-command-palette.png');

  // Close palette
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);

  // --- Screenshot 5: Activity panel ---
  await win.keyboard.press('Control+Shift+a');
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(DOCS, 'screenshot-activity.png') });
  console.log('Captured: screenshot-activity.png');

  // Cleanup
  await app.close();
  fs.rmSync(govDir, { recursive: true, force: true });
  fs.rmSync(userDataDir, { recursive: true, force: true });

  console.log('\nAll screenshots saved to docs/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

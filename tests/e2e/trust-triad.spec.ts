// SPDX-License-Identifier: Apache-2.0
/**
 * Trust Triad E2E tests — overwrite asks, stop, and hash mismatch.
 *
 * These four specs lock down the timing-sensitive features:
 *   1. Ask allow (overwrite) — user approves → file overwritten, single upserted row
 *   2. Ask deny — user denies → file unchanged, status=ask_denied
 *   3. Stop mid-loop — user clicks stop → no overwrite, "Stopped by user" system event
 *   4. Hash mismatch — wrong hash → file unchanged, HASH_MISMATCH in activity feed
 *
 * Uses stub-daemon.mjs with E2E_CHAT_SCENARIO env var for deterministic multi-turn chat.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clerk-e2e-trust-'));
}

/** Open the details drawer by clicking the toggle button. */
async function openDetailsDrawer(page: Awaited<ReturnType<typeof launchApp>>['page']) {
  await page.locator('.details-toggle').click();
  await expect(page.locator('.workspace-details')).toBeVisible({ timeout: 3000 });
}

async function launchApp(governorDir: string, extraEnv: Record<string, string> = {}) {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const electronPath = require('electron') as unknown as string;

  const app = await electron.launch({
    executablePath: electronPath,
    args: ['--no-sandbox', MAIN_ENTRY],
    env: {
      ...process.env,
      CLERK_E2E: '1',
      GOVERNOR_BIN: STUB_DAEMON,
      GOVERNOR_DIR: governorDir,
      GOVERNOR_MODE: 'general',
      ELECTRON_DISABLE_GPU: '1',
      ELECTRON_DISABLE_SANDBOX: '1',
      ...extraEnv,
    },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('textarea', { timeout: 15000 });
  return { app, page };
}

test.describe('Trust Triad', () => {
  let governorDir: string;

  test.beforeEach(() => {
    governorDir = makeTmpDir();
  });

  test.afterEach(() => {
    fs.rmSync(governorDir, { recursive: true, force: true });
  });

  test('ask allow: overwrite approved → file updated, single upserted row', async () => {
    // Seed target file
    fs.writeFileSync(path.join(governorDir, 'target.txt'), 'original content', 'utf-8');

    const { app, page } = await launchApp(governorDir, {
      E2E_CHAT_SCENARIO: 'ask_overwrite',
    });

    try {
      // Open details drawer to see activity
      await openDetailsDrawer(page);

      // Switch to "Take the wheel" (research profile) — triggers ASK_REQUIRED for overwrite
      const picker = page.locator('.status-bar select.picker');
      await picker.waitFor({ timeout: 5000 });
      await picker.selectOption('take_the_wheel');

      // Wait for "Mode set to" in activity feed to confirm template applied
      const modeRow = page.locator('.workspace-details .row .summary', { hasText: 'Mode set to' });
      await expect(modeRow.first()).toBeVisible({ timeout: 10000 });

      // Send chat message to trigger overwrite flow
      await page.locator('textarea').fill('overwrite the target file');
      await page.locator('button.send-btn').click();

      // Wait for ask card to appear
      const askCard = page.locator('div.ask-card');
      await expect(askCard).toBeVisible({ timeout: 15000 });

      // Assert ask card shows the file path
      await expect(askCard).toContainText('target.txt');

      // Click Allow
      await page.locator('button.btn.allow').click();

      // Wait for streaming to end (stop button disappears, send button appears)
      await expect(page.locator('button.stop-btn')).toBeHidden({ timeout: 15000 });

      // File on disk should be updated
      const fileContent = fs.readFileSync(path.join(governorDir, 'target.txt'), 'utf-8');
      expect(fileContent).toBe('updated by e2e');

      // Exactly 1 row with data-kind="file_write_overwrite" (upsert, not 2)
      const overwriteRows = page.locator('[data-kind="file_write_overwrite"]');
      await expect(overwriteRows).toHaveCount(1);

      // That row should have status "ask_approved"
      await expect(overwriteRows.first()).toHaveAttribute('data-status', 'ask_approved');
    } finally {
      await app.close();
    }
  });

  test('ask deny: overwrite denied → file unchanged, status=ask_denied', async () => {
    // Seed target file
    fs.writeFileSync(path.join(governorDir, 'target.txt'), 'original content', 'utf-8');

    const { app, page } = await launchApp(governorDir, {
      E2E_CHAT_SCENARIO: 'ask_overwrite',
    });

    try {
      // Open details drawer to see activity
      await openDetailsDrawer(page);

      // Switch to "Take the wheel" (research profile)
      const picker = page.locator('.status-bar select.picker');
      await picker.waitFor({ timeout: 5000 });
      await picker.selectOption('take_the_wheel');

      // Wait for template to apply
      const modeRow = page.locator('.workspace-details .row .summary', { hasText: 'Mode set to' });
      await expect(modeRow.first()).toBeVisible({ timeout: 10000 });

      // Send chat message
      await page.locator('textarea').fill('overwrite the target file');
      await page.locator('button.send-btn').click();

      // Wait for ask card
      const askCard = page.locator('div.ask-card');
      await expect(askCard).toBeVisible({ timeout: 15000 });

      // Click Deny
      await page.locator('button.btn.deny').click();

      // Wait for streaming to end
      await expect(page.locator('button.send-btn')).toBeVisible({ timeout: 15000 });

      // File on disk should be unchanged
      const fileContent = fs.readFileSync(path.join(governorDir, 'target.txt'), 'utf-8');
      expect(fileContent).toBe('original content');

      // 1 row with data-kind="file_write_overwrite" and status "ask_denied"
      const overwriteRows = page.locator('[data-kind="file_write_overwrite"][data-status="ask_denied"]');
      await expect(overwriteRows).toHaveCount(1);
    } finally {
      await app.close();
    }
  });

  test('stop mid-loop: no overwrite, "Stopped by user" system event', async () => {
    const { app, page } = await launchApp(governorDir, {
      E2E_CHAT_SCENARIO: 'stop_loop',
    });

    try {
      // Open details drawer to see activity
      await openDetailsDrawer(page);

      // Default template (production) — no need to switch
      const picker = page.locator('.status-bar select.picker');
      await picker.waitFor({ timeout: 5000 });

      // Send chat message
      await page.locator('textarea').fill('organize my files');
      await page.locator('button.send-btn').click();

      // Wait for first activity row (file_list completes → proves turn 1 done)
      const fileListRow = page.locator('[data-kind="file_list"]');
      await expect(fileListRow.first()).toBeVisible({ timeout: 15000 });

      // Wait for stop button to appear and click it
      const stopBtn = page.locator('button.stop-btn');
      await expect(stopBtn).toBeVisible({ timeout: 5000 });
      await stopBtn.click();

      // Wait for streaming to end
      await expect(page.locator('button.send-btn')).toBeVisible({ timeout: 15000 });

      // No overwrite rows — the overwrite tool call should never have executed
      const overwriteRows = page.locator('[data-kind="file_write_overwrite"]');
      await expect(overwriteRows).toHaveCount(0);

      // System event "Stopped by user" should appear
      const systemRow = page.locator('[data-kind="system"]');
      await expect(systemRow.first()).toBeVisible({ timeout: 5000 });
      const summary = systemRow.first().locator('.summary');
      await expect(summary).toContainText('Stopped by user');
    } finally {
      await app.close();
    }
  });

  test('hash mismatch: file unchanged, HASH_MISMATCH in activity feed', async () => {
    // Seed target file with known content
    fs.writeFileSync(path.join(governorDir, 'target.txt'), 'real content', 'utf-8');

    const { app, page } = await launchApp(governorDir, {
      E2E_CHAT_SCENARIO: 'hash_mismatch',
    });

    try {
      // Open details drawer to see activity
      await openDetailsDrawer(page);

      // Default template (production)
      const picker = page.locator('.status-bar select.picker');
      await picker.waitFor({ timeout: 5000 });

      // Send chat message
      await page.locator('textarea').fill('update the target file');
      await page.locator('button.send-btn').click();

      // Wait for streaming to end
      await expect(page.locator('button.send-btn')).toBeVisible({ timeout: 15000 });

      // File on disk should be unchanged
      const fileContent = fs.readFileSync(path.join(governorDir, 'target.txt'), 'utf-8');
      expect(fileContent).toBe('real content');

      // 1 row with data-kind="file_write_overwrite"
      const overwriteRows = page.locator('[data-kind="file_write_overwrite"]');
      await expect(overwriteRows).toHaveCount(1);

      // Assert HASH_MISMATCH via data attribute
      await expect(overwriteRows.first()).toHaveAttribute('data-error-code', 'HASH_MISMATCH');
    } finally {
      await app.close();
    }
  });
});

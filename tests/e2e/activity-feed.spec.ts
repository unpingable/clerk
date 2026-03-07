// SPDX-License-Identifier: Apache-2.0
/**
 * Activity feed E2E smoke tests.
 *
 * Three scenarios that lock down the core promise:
 *   1. "Look around" (strict) → write_create blocked → feed shows blocked
 *   2. "Help me edit" (production) → write_create allowed → feed shows allowed + file exists
 *   3. Compile failure → selected != applied → feed shows "Mode change failed"
 *
 * Uses a stub daemon (tests/e2e/stub-daemon.mjs) that implements just enough
 * JSON-RPC to drive the app through template apply + chat tool loop.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clerk-e2e-'));
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

/** Open the details drawer by clicking the toggle button. */
async function openDetailsDrawer(page: Awaited<ReturnType<typeof launchApp>>['page']) {
  await page.locator('.details-toggle').click();
  await expect(page.locator('.workspace-details')).toBeVisible({ timeout: 3000 });
}

/** Count activity rows matching a summary text. */
async function countFeedEvents(page: Awaited<ReturnType<typeof launchApp>>['page'], summaryMatch: string | RegExp): Promise<number> {
  const summaries = page.locator('.workspace-details .row .summary');
  const count = await summaries.count();
  let matches = 0;
  for (let i = 0; i < count; i++) {
    const text = await summaries.nth(i).textContent();
    if (typeof summaryMatch === 'string' ? text?.includes(summaryMatch) : summaryMatch.test(text ?? '')) {
      matches++;
    }
  }
  return matches;
}

test.describe('Activity Feed', () => {
  let governorDir: string;

  test.beforeEach(() => {
    governorDir = makeTmpDir();
  });

  test.afterEach(() => {
    fs.rmSync(governorDir, { recursive: true, force: true });
  });

  test('details panel is closed by default', async () => {
    const { app, page } = await launchApp(governorDir);
    try {
      // workspace-details should NOT be in the DOM when closed
      await expect(page.locator('.workspace-details')).toHaveCount(0);
      // Details toggle button should show "Details ▸"
      await expect(page.locator('.details-toggle')).toContainText('Details');
    } finally {
      await app.close();
    }
  });

  test('strict profile: write blocked appears in feed', async () => {
    const { app, page } = await launchApp(governorDir);

    try {
      // Open the details drawer first
      await openDetailsDrawer(page);

      // Switch to "Look around" template (strict profile)
      const picker = page.locator('.status-bar select.picker');
      await picker.waitFor({ timeout: 5000 });
      await picker.selectOption('look_around');
      await expect(page.locator('.status.applying')).toBeHidden({ timeout: 5000 });

      // Send a chat message that triggers a file write tool call
      await page.locator('textarea').fill('create a test file');
      await page.locator('button.send-btn').click();

      // Wait for blocked event in activity panel
      const blockedRow = page.locator('.workspace-details .row .dot.blocked');
      await expect(blockedRow.first()).toBeVisible({ timeout: 15000 });

      // Verify summary text
      const summary = page.locator('.workspace-details .row .summary').first();
      await expect(summary).toContainText('Blocked', { timeout: 5000 });

      // No duplicate: exactly one blocked-write event
      const blockedWriteCount = await countFeedEvents(page, /Blocked from creating/);
      expect(blockedWriteCount).toBe(1);

      // "Blocked" / "Stopped" filter shows only blocked rows (label depends on friendly mode)
      await page.locator('.workspace-details .filter-btn', { hasText: /Blocked|Stopped/ }).click();
      const rows = page.locator('.workspace-details .row');
      const count = await rows.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        await expect(rows.nth(i).locator('.dot.blocked')).toBeVisible();
      }
    } finally {
      await app.close();
    }
  });

  test('production profile: write allowed appears in feed + file exists', async () => {
    const { app, page } = await launchApp(governorDir);

    try {
      // Open the details drawer first
      await openDetailsDrawer(page);

      // Default template is "help_me_edit" (production profile)
      const picker = page.locator('.status-bar select.picker');
      await picker.waitFor({ timeout: 5000 });
      await expect(picker).toHaveValue('help_me_edit');

      // Send a chat message that triggers a file write
      await page.locator('textarea').fill('create a test file');
      await page.locator('button.send-btn').click();

      // Wait for allowed event in activity panel
      const allowedRow = page.locator('.workspace-details .row .dot.allowed');
      await expect(allowedRow.first()).toBeVisible({ timeout: 15000 });

      // Verify summary text
      const summary = page.locator('.workspace-details .row .summary').first();
      await expect(summary).toContainText('Created', { timeout: 5000 });

      // No duplicate: exactly one created event
      const createdCount = await countFeedEvents(page, /Created/);
      expect(createdCount).toBe(1);

      // File actually exists on disk
      const createdFile = path.join(governorDir, 'e2e-test-output.txt');
      await page.waitForTimeout(500);
      expect(fs.existsSync(createdFile)).toBe(true);
      expect(fs.readFileSync(createdFile, 'utf-8')).toBe('hello from e2e');

      // Verify row shows template name in metadata
      const firstRow = page.locator('.workspace-details .row').first();
      await expect(firstRow).toContainText('Help me edit');
    } finally {
      await app.close();
    }
  });

  test('compile failure: selected != applied + mode-change failure in feed', async () => {
    // Stub fails on the 2nd intent.compile (1st is the startup apply)
    const { app, page } = await launchApp(governorDir, { E2E_COMPILE_FAIL_ON: '2' });

    try {
      // Open the details drawer first
      await openDetailsDrawer(page);

      const picker = page.locator('.status-bar select.picker');
      await picker.waitFor({ timeout: 5000 });

      // The default template (help_me_edit) applied on startup (compile #1 succeeds).
      // Now switch to "look_around" — compile #2 will fail.
      await picker.selectOption('look_around');

      // Wait for the error indicator to appear (the "!" status)
      const errorStatus = page.locator('.status.error');
      await expect(errorStatus).toBeVisible({ timeout: 5000 });

      // Picker should show the selected value (look_around) even though apply failed
      await expect(picker).toHaveValue('look_around');

      // Activity feed should show "Mode change failed"
      const failedEvent = page.locator('.workspace-details .row .summary', { hasText: 'Mode change failed' });
      await expect(failedEvent.first()).toBeVisible({ timeout: 5000 });

      // No duplicate: exactly one mode-change failure event
      const failCount = await countFeedEvents(page, /Mode change failed/);
      expect(failCount).toBe(1);

      // Expand the failed mode-change row to see details
      // Find the row containing the failure and click its main section
      const failRow = page.locator('.workspace-details .row', { hasText: 'Mode change failed' }).first();
      await failRow.locator('.row-main').click();
      const details = failRow.locator('.details');
      await expect(details).toBeVisible({ timeout: 3000 });
      // Details should mention the reason
      await expect(details).toContainText('Reason:');
    } finally {
      await app.close();
    }
  });
});

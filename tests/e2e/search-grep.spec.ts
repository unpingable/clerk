// SPDX-License-Identifier: Apache-2.0
/**
 * Search/grep E2E seatbelt tests.
 *
 * Two specs:
 *   1. grep returns matches → activity row shows up with correct kind
 *   2. grep can't see .clerk/, .git/, node_modules/ (canary planted, zero hits)
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { launchApp, makeTmpDirs, cleanupDirs } from './e2e-helpers';

/** Open the details drawer by clicking the toggle button. */
async function openDetailsDrawer(page: any) {
  await page.locator('.details-toggle').click();
  await expect(page.locator('.workspace-details')).toBeVisible({ timeout: 3000 });
}

test.describe('Search/Grep', () => {
  let governorDir: string;
  let userDataDir: string;

  test.beforeEach(() => {
    const dirs = makeTmpDirs('clerk-e2e-search-');
    governorDir = dirs.govDir;
    userDataDir = dirs.userDataDir;
  });

  test.afterEach(() => {
    cleanupDirs(governorDir, userDataDir);
  });

  test('grep returns matches and activity row appears', async () => {
    // Plant a file with the canary string
    fs.writeFileSync(path.join(governorDir, 'haystack.txt'), 'This has CANARY_STRING in it.\n', 'utf-8');
    fs.mkdirSync(path.join(governorDir, 'sub'));
    fs.writeFileSync(path.join(governorDir, 'sub', 'deep.txt'), 'Another CANARY_STRING here.\n', 'utf-8');

    const { app, page } = await launchApp(governorDir, userDataDir, {
      extraEnv: { E2E_CHAT_SCENARIO: 'grep_search' },
    });

    try {
      // Open details drawer to see activity events
      await openDetailsDrawer(page);

      // Wait for default template
      const picker = page.locator('.status-bar select.picker');
      await picker.waitFor({ timeout: 5000 });

      // Send chat message to trigger grep
      await page.locator('textarea').fill('search for CANARY_STRING');
      await page.locator('button.send-btn').click();

      // Wait for streaming to end
      await expect(page.locator('button.send-btn')).toBeVisible({ timeout: 15000 });

      // Activity row with data-kind="file_grep" should appear
      const grepRow = page.locator('[data-kind="file_grep"]');
      await expect(grepRow.first()).toBeVisible({ timeout: 10000 });

      // Status should be allowed
      await expect(grepRow.first()).toHaveAttribute('data-status', 'allowed');

      // Summary should mention "Searched for"
      const summary = grepRow.first().locator('.summary');
      await expect(summary).toContainText('Searched for');
    } finally {
      await app.close();
    }
  });

  test('grep cannot see .clerk/, .git/, node_modules/', async () => {
    // Plant HIDDEN_CANARY ONLY in excluded directories
    fs.mkdirSync(path.join(governorDir, '.clerk'), { recursive: true });
    fs.writeFileSync(path.join(governorDir, '.clerk', 'secret.txt'), 'HIDDEN_CANARY\n', 'utf-8');

    fs.mkdirSync(path.join(governorDir, '.git'), { recursive: true });
    fs.writeFileSync(path.join(governorDir, '.git', 'config'), 'HIDDEN_CANARY\n', 'utf-8');

    fs.mkdirSync(path.join(governorDir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(governorDir, 'node_modules', 'pkg.js'), 'HIDDEN_CANARY\n', 'utf-8');

    // Do NOT plant it in any visible file — grep should find zero matches

    const { app, page } = await launchApp(governorDir, userDataDir, {
      extraEnv: { E2E_CHAT_SCENARIO: 'grep_invisible' },
    });

    try {
      // Open details drawer to see activity events
      await openDetailsDrawer(page);

      const picker = page.locator('.status-bar select.picker');
      await picker.waitFor({ timeout: 5000 });

      // Send chat message to trigger grep
      await page.locator('textarea').fill('search for HIDDEN_CANARY');
      await page.locator('button.send-btn').click();

      // Wait for streaming to end
      await expect(page.locator('button.send-btn')).toBeVisible({ timeout: 15000 });

      // Activity row with data-kind="file_grep" should appear
      const grepRow = page.locator('[data-kind="file_grep"]');
      await expect(grepRow.first()).toBeVisible({ timeout: 10000 });

      // It should be "allowed" (the search ran, just found nothing)
      await expect(grepRow.first()).toHaveAttribute('data-status', 'allowed');

      // Summary should show 0 matches — the canary was only in excluded dirs
      const summary = grepRow.first().locator('.summary');
      await expect(summary).toContainText('0 match');
    } finally {
      await app.close();
    }
  });
});

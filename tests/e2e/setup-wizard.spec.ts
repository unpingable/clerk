// SPDX-License-Identifier: Apache-2.0
/**
 * Setup Wizard E2E tests.
 *
 * Uses the stub daemon which reads daemon.conf to decide whether to return
 * models. No daemon.conf → empty models → wizard appears.
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchApp, makeTmpDirs, cleanupDirs } from './e2e-helpers';

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

test.describe('Setup Wizard', () => {
  let governorDir: string;
  let userDataDir: string;

  test.beforeEach(() => {
    const dirs = makeTmpDirs('clerk-e2e-wizard-');
    governorDir = dirs.govDir;
    userDataDir = dirs.userDataDir;
  });

  test.afterEach(() => {
    cleanupDirs(governorDir, userDataDir);
  });

  test('wizard appears when no daemon.conf, configure anthropic succeeds', async () => {
    // No daemon.conf → stub returns empty models → wizard should appear
    const { app, page } = await launchApp(governorDir, userDataDir, {
      writeDaemonConf: false,
      waitForTextarea: false,
    });
    try {
      // Wizard should appear (look for the Connect button)
      const connectBtn = page.locator('[data-wizard-connect]');
      await expect(connectBtn).toBeVisible({ timeout: 15000 });

      // Should show heading (use .card h1 to avoid matching header "Clerk" h1)
      await expect(page.locator('.card h1')).toContainText('Choose an AI backend');

      // Anthropic should be selected by default
      const anthropicRadio = page.locator('[data-wizard-type="anthropic"]');
      await expect(anthropicRadio).toBeChecked();

      // Connect should be disabled (no API key)
      await expect(connectBtn).toBeDisabled();

      // Enter a valid API key
      await page.locator('#api-key').fill('sk-ant-e2e-test');

      // Connect should now be enabled
      await expect(connectBtn).toBeEnabled();

      // Click Connect
      await connectBtn.click();

      // Wizard should disappear and chat UI should appear
      await expect(page.locator('textarea')).toBeVisible({ timeout: 15000 });
      await expect(connectBtn).toBeHidden();
    } finally {
      await app.close();
    }
  });

  test('wizard shows error for bad API key', async () => {
    const { app, page } = await launchApp(governorDir, userDataDir, {
      writeDaemonConf: false,
      waitForTextarea: false,
    });
    try {
      const connectBtn = page.locator('[data-wizard-connect]');
      await expect(connectBtn).toBeVisible({ timeout: 15000 });

      // Enter a bad API key (stub returns empty models for non-sk-ant- keys)
      await page.locator('#api-key').fill('bad-key');
      await connectBtn.click();

      // Should show an error
      const errorEl = page.locator('[data-wizard-error]');
      await expect(errorEl).toBeVisible({ timeout: 15000 });
      await expect(errorEl).toContainText(/key/i);
    } finally {
      await app.close();
    }
  });

  test('"Change AI backend..." from command palette re-shows wizard', async () => {
    // Start with a valid config so chat UI loads (shared helper writes daemon.conf)
    const { app, page } = await launchApp(governorDir, userDataDir);
    try {
      // Wait for chat UI
      await expect(page.locator('textarea')).toBeVisible({ timeout: 15000 });

      // Open command palette
      await page.keyboard.press(`${mod}+p`);
      await expect(page.locator('.backdrop')).toBeVisible({ timeout: 3000 });

      // Search for "Change AI backend"
      await page.locator('.palette .search').fill('backend');
      await expect(page.locator('.item-label', { hasText: 'Change AI backend...' })).toBeVisible();

      // Execute it
      await page.keyboard.press('Enter');

      // Wizard should appear
      const connectBtn = page.locator('[data-wizard-connect]');
      await expect(connectBtn).toBeVisible({ timeout: 10000 });

      // Chat textarea should NOT be visible (wizard replaces it)
      await expect(page.locator('textarea')).toBeHidden();
    } finally {
      await app.close();
    }
  });
});

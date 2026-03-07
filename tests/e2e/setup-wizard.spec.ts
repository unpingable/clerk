// SPDX-License-Identifier: Apache-2.0
/**
 * Setup Wizard E2E tests.
 *
 * Uses the stub daemon which reads daemon.conf to decide whether to return
 * models. No daemon.conf → empty models → wizard appears.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clerk-e2e-wizard-'));
}

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

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
  return { app, page };
}

test.describe('Setup Wizard', () => {
  let governorDir: string;

  test.beforeEach(() => {
    governorDir = makeTmpDir();
  });

  test.afterEach(() => {
    fs.rmSync(governorDir, { recursive: true, force: true });
  });

  test('wizard appears when no daemon.conf, configure anthropic succeeds', async () => {
    // No daemon.conf → stub returns empty models → wizard should appear
    const { app, page } = await launchApp(governorDir, { E2E_BACKEND_CHECK: '1' });
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
    const { app, page } = await launchApp(governorDir, { E2E_BACKEND_CHECK: '1' });
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
    // Start with a valid config so chat UI loads
    fs.writeFileSync(
      path.join(governorDir, 'daemon.conf'),
      '[backend]\ntype = anthropic\nanthropic.api_key = sk-ant-valid\n'
    );

    const { app, page } = await launchApp(governorDir);
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

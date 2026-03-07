// SPDX-License-Identifier: Apache-2.0
/**
 * E2E tests for file_patch tool — unified diff patching.
 *
 *   1. Patch applies: seed file → chat reads → chat patches → file changed on disk
 *   2. Patch fails: seed file → chat patches with wrong context → file unchanged
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'clerk-e2e-patch-'));
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

test.describe('file_patch', () => {
  let governorDir: string;

  test.beforeEach(() => {
    governorDir = makeTmpDir();
  });

  test.afterEach(() => {
    fs.rmSync(governorDir, { recursive: true, force: true });
  });

  test('patch applies: file changed on disk with correct activity event', async () => {
    // Seed target file
    fs.writeFileSync(path.join(governorDir, 'target.txt'), 'original content', 'utf-8');

    const { app, page } = await launchApp(governorDir, {
      E2E_CHAT_SCENARIO: 'patch_apply',
    });

    try {
      // Open details drawer to see activity events
      await openDetailsDrawer(page);

      // Send a message to trigger the patch flow
      const textarea = page.locator('textarea');
      await textarea.fill('patch the file');
      await textarea.press('Enter');

      // Wait for the patch activity event to appear
      const patchEvent = page.locator('[data-kind="file_patch"]').first();
      await patchEvent.waitFor({ timeout: 15000 });

      // Verify status
      const status = await patchEvent.getAttribute('data-status');
      expect(status).toBe('allowed');

      // Verify file was actually changed on disk
      const content = fs.readFileSync(path.join(governorDir, 'target.txt'), 'utf-8');
      expect(content).toContain('patched by e2e');
      expect(content).not.toContain('original content');
    } finally {
      await app.close();
    }
  });

  test('patch fails: file unchanged with PATCH_FAILED error code', async () => {
    // Seed target file
    fs.writeFileSync(path.join(governorDir, 'target.txt'), 'original content', 'utf-8');

    const { app, page } = await launchApp(governorDir, {
      E2E_CHAT_SCENARIO: 'patch_fail',
    });

    try {
      // Open details drawer to see activity events
      await openDetailsDrawer(page);

      // Send a message to trigger the patch flow
      const textarea = page.locator('textarea');
      await textarea.fill('patch the file');
      await textarea.press('Enter');

      // Wait for the patch activity event with error
      const patchEvent = page.locator('[data-kind="file_patch"]').first();
      await patchEvent.waitFor({ timeout: 15000 });

      // Verify error code
      const errorCode = await patchEvent.getAttribute('data-error-code');
      expect(errorCode).toBe('PATCH_FAILED');

      // Verify file was NOT changed on disk
      const content = fs.readFileSync(path.join(governorDir, 'target.txt'), 'utf-8');
      expect(content).toBe('original content');
    } finally {
      await app.close();
    }
  });
});

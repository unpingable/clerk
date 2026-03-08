// SPDX-License-Identifier: Apache-2.0
/**
 * E2E tests for file_patch tool — unified diff patching.
 *
 *   1. Patch applies: seed file → chat reads → chat patches → file changed on disk
 *   2. Patch fails: seed file → chat patches with wrong context → file unchanged
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

test.describe('file_patch', () => {
  let governorDir: string;
  let userDataDir: string;

  test.beforeEach(() => {
    const dirs = makeTmpDirs('clerk-e2e-patch-');
    governorDir = dirs.govDir;
    userDataDir = dirs.userDataDir;
  });

  test.afterEach(() => {
    cleanupDirs(governorDir, userDataDir);
  });

  test('patch applies: file changed on disk with correct activity event', async () => {
    // Seed target file
    fs.writeFileSync(path.join(governorDir, 'target.txt'), 'original content', 'utf-8');

    const { app, page } = await launchApp(governorDir, userDataDir, {
      extraEnv: { E2E_CHAT_SCENARIO: 'patch_apply' },
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

    const { app, page } = await launchApp(governorDir, userDataDir, {
      extraEnv: { E2E_CHAT_SCENARIO: 'patch_fail' },
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

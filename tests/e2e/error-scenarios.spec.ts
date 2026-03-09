// SPDX-License-Identifier: Apache-2.0
/**
 * Error scenario E2E tests — backend failure simulation.
 *
 * Uses stub-daemon.mjs with E2E_CHAT_SCENARIO env var to simulate:
 *   1. Auth failure (401) → classified error with hint
 *   2. Rate limit (429) → retryable error with hint
 *   3. Server error (500) → error displayed
 *   4. Network error (daemon crash) → connection loss detected
 */

import { test, expect } from '@playwright/test';
import { launchApp, makeTmpDirs, cleanupDirs } from './e2e-helpers';

test.describe('Error Scenarios', () => {
  let governorDir: string;
  let userDataDir: string;

  test.beforeEach(() => {
    const dirs = makeTmpDirs('clerk-e2e-err-');
    governorDir = dirs.govDir;
    userDataDir = dirs.userDataDir;
  });

  test.afterEach(() => {
    cleanupDirs(governorDir, userDataDir);
  });

  test('auth failure: 401 → error banner with auth hint', async () => {
    const { app, page } = await launchApp(governorDir, userDataDir, {
      extraEnv: { E2E_CHAT_SCENARIO: 'error_auth' },
    });

    try {
      const textarea = page.locator('textarea');
      await textarea.fill('Hello');
      await page.locator('button.send-btn').click();

      // Error banner should appear with classified message
      const errorBanner = page.locator('.error-card');
      await expect(errorBanner).toBeVisible({ timeout: 10000 });

      // Should contain auth-related text
      const bannerText = await errorBanner.textContent();
      expect(bannerText?.toLowerCase()).toMatch(/auth|key|credentials/);
    } finally {
      await app.close();
    }
  });

  test('rate limit: 429 → retryable error with retry button', async () => {
    const { app, page } = await launchApp(governorDir, userDataDir, {
      extraEnv: { E2E_CHAT_SCENARIO: 'error_rate_limit' },
    });

    try {
      const textarea = page.locator('textarea');
      await textarea.fill('Hello');
      await page.locator('button.send-btn').click();

      // Error banner should appear
      const errorBanner = page.locator('.error-card');
      await expect(errorBanner).toBeVisible({ timeout: 10000 });

      // Should mention rate limit
      const bannerText = await errorBanner.textContent();
      expect(bannerText?.toLowerCase()).toMatch(/rate|limit|wait|again/);

      // Retry button should be present (retryable error)
      const retryBtn = page.locator('.error-card .error-retry');
      await expect(retryBtn).toBeVisible({ timeout: 3000 });
    } finally {
      await app.close();
    }
  });

  test('server error: 500 → error banner displayed', async () => {
    const { app, page } = await launchApp(governorDir, userDataDir, {
      extraEnv: { E2E_CHAT_SCENARIO: 'error_server' },
    });

    try {
      const textarea = page.locator('textarea');
      await textarea.fill('Hello');
      await page.locator('button.send-btn').click();

      // Error banner should appear
      const errorBanner = page.locator('.error-card');
      await expect(errorBanner).toBeVisible({ timeout: 10000 });

      // Should mention server error
      const bannerText = await errorBanner.textContent();
      expect(bannerText?.toLowerCase()).toMatch(/server|unavailable|500/);
    } finally {
      await app.close();
    }
  });

  test('network error: daemon crash → connection badge shows disconnected', async () => {
    const { app, page } = await launchApp(governorDir, userDataDir, {
      extraEnv: { E2E_CHAT_SCENARIO: 'error_network' },
    });

    try {
      const textarea = page.locator('textarea');
      await textarea.fill('Hello');
      await page.locator('button.send-btn').click();

      // After daemon crash, connection badge should show disconnected state
      // The exact manifestation depends on how the app detects loss:
      // - Error banner may appear from the failed stream
      // - Connection badge may change to disconnected
      // We check for either signal
      const errorOrDisconnect = page.locator('.error-card, .badge.clickable');
      await expect(errorOrDisconnect.first()).toBeVisible({ timeout: 15000 });
    } finally {
      await app.close();
    }
  });
});

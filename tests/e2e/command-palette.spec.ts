// SPDX-License-Identifier: Apache-2.0
/**
 * Command Palette E2E tests.
 *
 * Pure UI tests — no special daemon scenarios needed:
 *   1. Cmd/Ctrl+P opens palette, Escape closes
 *   2. Backdrop click closes palette
 *   3. Filter narrows results, empty state shows hint
 *   4. Arrow keys navigate, Enter executes
 *   5. Prefill command lands text in chat input with cursor at end
 *   6. Profile command triggers template change
 *   7. Activity filter command changes feed filter
 *   8. Stop command appears only while streaming
 *   9. Cmd/Ctrl+P does not fire when palette is already open (idempotent)
 */

import { test, expect } from '@playwright/test';
import { launchApp, makeTmpDirs, cleanupDirs } from './e2e-helpers';

const isMac = process.platform === 'darwin';
const mod = isMac ? 'Meta' : 'Control';

async function openPalette(page: Awaited<ReturnType<typeof launchApp>>['page']) {
  await page.keyboard.press(`${mod}+p`);
  await expect(page.locator('.backdrop')).toBeVisible({ timeout: 3000 });
}

test.describe('Command Palette', () => {
  let governorDir: string;
  let userDataDir: string;

  test.beforeEach(() => {
    const dirs = makeTmpDirs('clerk-e2e-palette-');
    governorDir = dirs.govDir;
    userDataDir = dirs.userDataDir;
  });

  test.afterEach(() => {
    cleanupDirs(governorDir, userDataDir);
  });

  test('Cmd/Ctrl+P opens palette, Escape closes', async () => {
    const { app, page } = await launchApp(governorDir, userDataDir);
    try {
      // Palette should not be visible initially
      await expect(page.locator('.backdrop')).toBeHidden();

      // Open palette
      await openPalette(page);

      // Search input should be focused
      const searchInput = page.locator('.palette .search');
      await expect(searchInput).toBeFocused();

      // Group headers should be visible
      await expect(page.locator('.group-header').first()).toBeVisible();

      // Footer hint should be visible
      await expect(page.locator('.footer')).toContainText('navigate');

      // Escape closes
      await page.keyboard.press('Escape');
      await expect(page.locator('.backdrop')).toBeHidden({ timeout: 2000 });
    } finally {
      await app.close();
    }
  });

  test('backdrop click closes palette', async () => {
    const { app, page } = await launchApp(governorDir, userDataDir);
    try {
      await openPalette(page);

      // Click the backdrop (outside the palette)
      await page.locator('.backdrop').click({ position: { x: 10, y: 10 } });
      await expect(page.locator('.backdrop')).toBeHidden({ timeout: 2000 });
    } finally {
      await app.close();
    }
  });

  test('filter narrows results, empty state shows hint', async () => {
    const { app, page } = await launchApp(governorDir, userDataDir);
    try {
      await openPalette(page);

      // Initially should have items from multiple groups
      const items = page.locator('.item');
      const initialCount = await items.count();
      expect(initialCount).toBeGreaterThan(5);

      // Type "edit" — should narrow to Edit file... and maybe others
      await page.locator('.palette .search').fill('edit');
      const filteredCount = await items.count();
      expect(filteredCount).toBeLessThan(initialCount);
      expect(filteredCount).toBeGreaterThan(0);

      // Verify "Edit file..." is among results
      await expect(page.locator('.item-label', { hasText: 'Edit file...' })).toBeVisible();

      // Type something that matches nothing
      await page.locator('.palette .search').fill('zzzznotreal');
      const emptyHint = page.locator('.palette .empty');
      await expect(emptyHint).toBeVisible();
      await expect(emptyHint).toContainText('No matching commands');
    } finally {
      await app.close();
    }
  });

  test('arrow keys navigate, selected item has highlight', async () => {
    const { app, page } = await launchApp(governorDir, userDataDir);
    try {
      await openPalette(page);

      // First item should be selected by default
      const firstItem = page.locator('[data-palette-index="0"]');
      await expect(firstItem).toHaveClass(/selected/);

      // Arrow down moves selection
      await page.keyboard.press('ArrowDown');
      const secondItem = page.locator('[data-palette-index="1"]');
      await expect(secondItem).toHaveClass(/selected/);
      await expect(firstItem).not.toHaveClass(/selected/);

      // Arrow up moves back
      await page.keyboard.press('ArrowUp');
      await expect(firstItem).toHaveClass(/selected/);
    } finally {
      await app.close();
    }
  });

  test('prefill command lands text in chat input with cursor at end', async () => {
    const { app, page } = await launchApp(governorDir, userDataDir);
    try {
      await openPalette(page);

      // Filter to "Edit file..."
      await page.locator('.palette .search').fill('edit file');
      await expect(page.locator('.item-label', { hasText: 'Edit file...' })).toBeVisible();

      // Press Enter to execute
      await page.keyboard.press('Enter');

      // Palette should close
      await expect(page.locator('.backdrop')).toBeHidden({ timeout: 2000 });

      // Chat textarea should contain the prefill text
      const textarea = page.locator('textarea');
      await expect(textarea).toHaveValue('Edit the file ');

      // Textarea should be focused
      await expect(textarea).toBeFocused();

      // Verify cursor is at end — type a character and check it appends
      await page.keyboard.type('test.txt');
      await expect(textarea).toHaveValue('Edit the file test.txt');
    } finally {
      await app.close();
    }
  });

  test('profile command triggers template change', async () => {
    const { app, page } = await launchApp(governorDir, userDataDir);
    try {
      // Wait for template picker to confirm default
      const picker = page.locator('.status-bar select.picker');
      await picker.waitFor({ timeout: 5000 });
      await expect(picker).toHaveValue('help_me_edit');

      // Open palette and select "Look around" profile
      await openPalette(page);
      await page.locator('.palette .search').fill('look around');
      await expect(page.locator('.item-label', { hasText: 'Use profile: Look around' })).toBeVisible();
      await page.keyboard.press('Enter');

      // Palette should close
      await expect(page.locator('.backdrop')).toBeHidden({ timeout: 2000 });

      // Template picker should reflect the change
      await expect(picker).toHaveValue('look_around', { timeout: 5000 });

      // Open details drawer to verify activity
      await page.locator('.details-toggle').click();
      await expect(page.locator('.workspace-details')).toBeVisible({ timeout: 3000 });

      // Activity feed should show mode change
      const modeRow = page.locator('.workspace-details .row .summary', { hasText: 'Mode set to' });
      await expect(modeRow.first()).toBeVisible({ timeout: 10000 });
    } finally {
      await app.close();
    }
  });

  test('activity filter command changes feed filter', async () => {
    const { app, page } = await launchApp(governorDir, userDataDir);
    try {
      // Open palette and select "Show blocked"
      await openPalette(page);
      await page.locator('.palette .search').fill('blocked');
      await expect(page.locator('.item-label', { hasText: /Show blocked|Show stopped/ })).toBeVisible();
      await page.keyboard.press('Enter');

      // Palette should close
      await expect(page.locator('.backdrop')).toBeHidden({ timeout: 2000 });

      // Activity filter command should auto-open the details drawer
      await expect(page.locator('.workspace-details')).toBeVisible({ timeout: 3000 });

      // The "Stopped" (friendlyMode=true default) or "Blocked" filter button should now be active
      const blockedFilter = page.locator('.workspace-details .filter-btn.active', { hasText: /Stopped|Blocked/ });
      await expect(blockedFilter).toBeVisible({ timeout: 3000 });
    } finally {
      await app.close();
    }
  });

  test('stop command appears only while streaming', async () => {
    const { app, page } = await launchApp(governorDir, userDataDir, {
      extraEnv: { E2E_CHAT_SCENARIO: 'stop_loop' },
    });
    try {
      // Open palette — stop should NOT be present
      await openPalette(page);
      await page.locator('.palette .search').fill('stop');
      await expect(page.locator('.item-label', { hasText: 'Stop current run' })).toBeHidden();
      await page.keyboard.press('Escape');

      // Start streaming
      await page.locator('textarea').fill('organize my files');
      await page.locator('button.send-btn').click();

      // Wait for streaming to start (stop button appears in chat)
      await expect(page.locator('button.stop-btn')).toBeVisible({ timeout: 10000 });

      // Open palette while streaming — "Stop current run" should appear
      await openPalette(page);
      await page.locator('.palette .search').fill('stop');
      await expect(page.locator('.item-label', { hasText: 'Stop current run' })).toBeVisible({ timeout: 3000 });

      // Execute stop via palette
      await page.keyboard.press('Enter');

      // Palette should close and streaming should end
      await expect(page.locator('.backdrop')).toBeHidden({ timeout: 2000 });
      await expect(page.locator('button.send-btn')).toBeVisible({ timeout: 15000 });
    } finally {
      await app.close();
    }
  });

  test('mouse hover updates selection', async () => {
    const { app, page } = await launchApp(governorDir, userDataDir);
    try {
      await openPalette(page);

      // Hover over the third item
      const thirdItem = page.locator('[data-palette-index="2"]');
      await thirdItem.hover();
      await expect(thirdItem).toHaveClass(/selected/);

      // First item should no longer be selected
      await expect(page.locator('[data-palette-index="0"]')).not.toHaveClass(/selected/);
    } finally {
      await app.close();
    }
  });

  test('Cmd/Ctrl+K still focuses input when palette is closed', async () => {
    const { app, page } = await launchApp(governorDir, userDataDir);
    try {
      // Click somewhere to blur the textarea
      await page.locator('.header').click();

      // Cmd/Ctrl+K should focus the textarea
      await page.keyboard.press(`${mod}+k`);
      await expect(page.locator('textarea')).toBeFocused({ timeout: 2000 });
    } finally {
      await app.close();
    }
  });
});

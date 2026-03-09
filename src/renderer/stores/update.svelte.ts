// SPDX-License-Identifier: Apache-2.0
/**
 * Update state store — tracks auto-update status from main process.
 * Svelte 5 runes mode. Must be .svelte.ts.
 */

import { api } from '$lib/api';
import type { UpdateStatus } from '$shared/types';

export const update = $state<UpdateStatus>({ state: 'idle' });

export function initUpdateListener(): void {
  api.onUpdateStatus((status: UpdateStatus) => {
    Object.assign(update, status);
  });
}

export function cleanupUpdateListener(): void {
  api.offUpdateStatus();
}

export function checkForUpdates(): void {
  api.updateCheck();
}

export function downloadUpdate(): void {
  api.updateDownload();
}

export function installUpdate(): void {
  api.updateInstall();
}

export function dismissUpdate(): void {
  Object.assign(update, { state: 'idle' } as UpdateStatus);
}

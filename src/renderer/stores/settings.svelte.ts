// SPDX-License-Identifier: Apache-2.0
/**
 * Settings store — reactive user preferences.
 * Must be .svelte.ts for runes.
 */

import { api } from '$lib/api';
import type { ClerkSettings } from '$shared/types';

export const settings = $state<ClerkSettings & { loaded: boolean }>({
  friendlyMode: true,
  loaded: false,
});

export async function loadSettings(): Promise<void> {
  try {
    const s = await api.settingsGetAll();
    settings.friendlyMode = s.friendlyMode;
  } catch {
    // Keep optimistic defaults
  }
  settings.loaded = true;
}

export async function setFriendlyMode(value: boolean): Promise<void> {
  settings.friendlyMode = value;
  try {
    await api.settingsSet({ friendlyMode: value });
  } catch {
    // Best effort — store already updated reactively
  }
}

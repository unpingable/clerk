// SPDX-License-Identifier: Apache-2.0
/**
 * Settings store — reactive user preferences.
 * Must be .svelte.ts for runes.
 */

import { api } from '$lib/api';
import type { ClerkSettings, ClerkTheme } from '$shared/types';

export const settings = $state<ClerkSettings & { loaded: boolean }>({
  friendlyMode: true,
  theme: 'dark',
  loaded: false,
});

export async function loadSettings(): Promise<void> {
  try {
    const s = await api.settingsGetAll();
    settings.friendlyMode = s.friendlyMode;
    settings.theme = s.theme;
    applyTheme(s.theme);
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

export async function setTheme(value: ClerkTheme): Promise<void> {
  settings.theme = value;
  applyTheme(value);
  try {
    await api.settingsSet({ theme: value });
  } catch {
    // Best effort — store already updated reactively
  }
}

function applyTheme(theme: ClerkTheme): void {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Backend capabilities store — tracks what the current backend supports.
 * UI components read this to show/hide/disable Governor-specific features.
 * Svelte 5 runes mode. Must be .svelte.ts.
 */

import { api } from '$lib/api';
import type { BackendCapabilities } from '$shared/types';

const ALL_FALSE: BackendCapabilities = {
  chat: false,
  textGating: false,
  actionGating: false,
  templateCompilation: false,
  receipts: false,
  violations: false,
  governorState: false,
};

let capabilities = $state<BackendCapabilities>({ ...ALL_FALSE });
let loaded = $state(false);

export function getCapabilities(): BackendCapabilities {
  return capabilities;
}

export function isLoaded(): boolean {
  return loaded;
}

export async function loadCapabilities(): Promise<void> {
  try {
    capabilities = await api.backendCapabilities();
    loaded = true;
  } catch {
    capabilities = { ...ALL_FALSE };
    loaded = true;
  }
}

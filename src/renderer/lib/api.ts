// SPDX-License-Identifier: Apache-2.0
/** Typed wrapper over window.clerk preload bridge. */

import type { ClerkAPI } from '$shared/types';

declare global {
  interface Window {
    clerk: ClerkAPI;
  }
}

export const api: ClerkAPI = typeof window !== 'undefined' && window.clerk
  ? window.clerk
  : new Proxy({} as ClerkAPI, {
      get: (_, prop) => () => {
        throw new Error(`clerk.${String(prop)}() called but preload bridge not available`);
      },
    });

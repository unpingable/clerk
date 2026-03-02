// SPDX-License-Identifier: Apache-2.0
/** Daemon connection state store. */

import { api } from '$lib/api';
import type { HealthResponse } from '$shared/types';

export type ConnectionState = 'connected' | 'degraded' | 'disconnected';

let connectionState = $state<ConnectionState>('disconnected');
let health = $state<HealthResponse | null>(null);
let pollHandle: ReturnType<typeof setInterval> | null = null;

export function getConnectionState(): ConnectionState {
  return connectionState;
}

export function getHealth(): HealthResponse | null {
  return health;
}

export function setConnectionState(state: ConnectionState): void {
  connectionState = state;
}

export async function checkHealth(): Promise<void> {
  try {
    health = await api.health();
    connectionState = health.status === 'ok' ? 'connected' : 'degraded';
  } catch {
    connectionState = 'disconnected';
    health = null;
  }
}

export function startPolling(ms: number = 3000): void {
  if (pollHandle) return;
  checkHealth();
  pollHandle = setInterval(checkHealth, ms);
}

export function stopPolling(): void {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

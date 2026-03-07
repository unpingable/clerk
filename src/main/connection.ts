// SPDX-License-Identifier: Apache-2.0
/**
 * Health polling with reconnect logic.
 * Periodically pings the backend and emits connection state changes.
 */

import { BrowserWindow } from 'electron';
import { Channels } from '../shared/channels.js';
import type { ClerkBackend } from './backend.js';

export type ConnectionState = 'connected' | 'degraded' | 'disconnected';

export class ConnectionMonitor {
  private backend: ClerkBackend;
  private interval: ReturnType<typeof setInterval> | null = null;
  private state: ConnectionState = 'disconnected';
  private pollMs: number;

  constructor(backend: ClerkBackend, pollMs: number = 3000) {
    this.backend = backend;
    this.pollMs = pollMs;
  }

  getState(): ConnectionState {
    return this.state;
  }

  start(): void {
    if (this.interval) return;
    this.poll();
    this.interval = setInterval(() => this.poll(), this.pollMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async poll(): Promise<void> {
    let newState: ConnectionState;
    try {
      const health = await this.backend.health();
      newState = health.status === 'ok' ? 'connected' : 'degraded';
    } catch {
      newState = 'disconnected';
    }

    if (newState !== this.state) {
      this.state = newState;
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send(Channels.CONNECTION_STATE, this.state);
      }
    }
  }
}

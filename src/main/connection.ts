// SPDX-License-Identifier: Apache-2.0
/**
 * Health polling with reconnect logic.
 * Periodically pings the Governor daemon and emits connection state changes.
 */

import { BrowserWindow } from 'electron';
import { Channels } from '../shared/channels.js';
import { GovernorClient } from './rpc-client.js';

export type ConnectionState = 'connected' | 'degraded' | 'disconnected';

export class ConnectionMonitor {
  private client: GovernorClient;
  private interval: ReturnType<typeof setInterval> | null = null;
  private state: ConnectionState = 'disconnected';
  private pollMs: number;

  constructor(client: GovernorClient, pollMs: number = 3000) {
    this.client = client;
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
      const health = await this.client.health();
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

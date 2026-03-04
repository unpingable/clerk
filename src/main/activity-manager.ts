// SPDX-License-Identifier: Apache-2.0
/**
 * ActivityManager — single source of truth for the activity feed.
 * Wraps ActivityLog with an in-memory ring buffer and live broadcast.
 */

import crypto from 'node:crypto';
import { Channels } from '../shared/channels.js';
import type { ActivityEvent, AppliedModeInfo, ActivityKind, ActivityDecisionSource, FileActionStatus } from '../shared/activity-types.js';
import type { ActivityLog } from './activity-log.js';

const MAX_IN_MEMORY = 500;

/** Broadcast interface — injectable for testing (avoids coupling to Electron WebContents). */
export interface ActivityBroadcast {
  send(channel: string, data: unknown): void;
}

/** Partial event — callers provide these, manager fills id/ts/mode. */
export interface ActivityRecordInput {
  kind: ActivityKind;
  streamId?: string;
  correlationId?: string;
  toolId?: string;
  path?: string;
  allowed: boolean;
  status?: FileActionStatus;
  decisionSource: ActivityDecisionSource;
  reason?: string;
  errorCode?: string;
  summary: string;
  details?: Record<string, unknown>;
}

/** Interface used by FileManager/TemplateManager to record events. */
export interface ActivityRecorder {
  record(input: ActivityRecordInput): void;
}

export class ActivityManager implements ActivityRecorder {
  private readonly log: ActivityLog;
  private readonly modeProvider: () => AppliedModeInfo;
  private events: ActivityEvent[] = [];
  private broadcast: ActivityBroadcast | null = null;

  constructor(log: ActivityLog, modeProvider: () => AppliedModeInfo) {
    this.log = log;
    this.modeProvider = modeProvider;
  }

  attachBroadcast(bc: ActivityBroadcast): void {
    this.broadcast = bc;
  }

  async init(): Promise<void> {
    const persisted = await this.log.readRecent(MAX_IN_MEMORY);
    this.events = persisted.slice(-MAX_IN_MEMORY);
  }

  getRecent(limit = 200): ActivityEvent[] {
    return this.events.slice(Math.max(0, this.events.length - limit));
  }

  record(input: ActivityRecordInput): void {
    // Upsert-by-correlationId: if correlationId matches an existing event, replace it
    if (input.correlationId) {
      const existingIdx = this.events.findIndex(e => e.correlationId === input.correlationId);
      if (existingIdx !== -1) {
        const existing = this.events[existingIdx];
        const updated: ActivityEvent = {
          ...existing,
          ...input,
          id: existing.id,  // preserve original id
          ts: new Date().toISOString(),
          mode: this.modeProvider(),
          schemaVersion: 1,
        };
        this.events[existingIdx] = updated;

        // Append update to log (last-write-wins on reload by correlationId)
        void this.log.append(updated);

        if (this.broadcast) {
          try {
            this.broadcast.send(Channels.ACTIVITY_EVENT, updated);
          } catch {
            // WebContents may be destroyed
          }
        }
        return;
      }
    }

    const event: ActivityEvent = {
      id: input.correlationId ?? crypto.randomUUID(),
      ts: new Date().toISOString(),
      mode: this.modeProvider(),
      schemaVersion: 1,
      ...input,
    };

    this.events.push(event);
    if (this.events.length > MAX_IN_MEMORY) {
      this.events = this.events.slice(-MAX_IN_MEMORY);
    }

    // Best-effort persistence (don't block caller)
    void this.log.append(event);

    // Live broadcast to renderer
    if (this.broadcast) {
      try {
        this.broadcast.send(Channels.ACTIVITY_EVENT, event);
      } catch {
        // WebContents may be destroyed
      }
    }
  }
}

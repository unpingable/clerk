// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import { ActivityManager } from '../../src/main/activity-manager';
import type { ActivityBroadcast, ActivityRecordInput } from '../../src/main/activity-manager';
import type { ActivityLog } from '../../src/main/activity-log';
import type { AppliedModeInfo, ActivityEvent } from '../../src/shared/activity-types';

function makeMockLog(overrides: Partial<ActivityLog> = {}): ActivityLog {
  return {
    append: vi.fn().mockResolvedValue(undefined),
    readRecent: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as ActivityLog;
}

function makeModeProvider(): () => AppliedModeInfo {
  return () => ({
    templateId: 'help_me_edit',
    templateName: 'Help me edit',
    templateVersion: '1.0.0',
    governorProfile: 'production',
  });
}

function makeInput(overrides: Partial<ActivityRecordInput> = {}): ActivityRecordInput {
  return {
    kind: 'file_read',
    path: 'README.md',
    allowed: true,
    decisionSource: 'daemon',
    summary: 'Read README.md',
    ...overrides,
  };
}

describe('ActivityManager', () => {
  it('record fills in id, ts, and mode', () => {
    const log = makeMockLog();
    const mgr = new ActivityManager(log, makeModeProvider());

    mgr.record(makeInput());

    const recent = mgr.getRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBeDefined();
    expect(recent[0].ts).toBeDefined();
    expect(recent[0].mode.templateId).toBe('help_me_edit');
    expect(recent[0].schemaVersion).toBe(1);
  });

  it('record persists to log', () => {
    const log = makeMockLog();
    const mgr = new ActivityManager(log, makeModeProvider());

    mgr.record(makeInput());

    expect(log.append).toHaveBeenCalledTimes(1);
    const persisted = (log.append as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(persisted.summary).toBe('Read README.md');
  });

  it('record broadcasts via attached broadcast', () => {
    const log = makeMockLog();
    const bc: ActivityBroadcast = { send: vi.fn() };
    const mgr = new ActivityManager(log, makeModeProvider());
    mgr.attachBroadcast(bc);

    mgr.record(makeInput());

    expect(bc.send).toHaveBeenCalledWith('activity:event', expect.objectContaining({ summary: 'Read README.md' }));
  });

  it('record works without broadcast attached', () => {
    const log = makeMockLog();
    const mgr = new ActivityManager(log, makeModeProvider());

    // Should not throw
    mgr.record(makeInput());
    expect(mgr.getRecent()).toHaveLength(1);
  });

  it('ring buffer caps at 500', () => {
    const log = makeMockLog();
    const mgr = new ActivityManager(log, makeModeProvider());

    for (let i = 0; i < 510; i++) {
      mgr.record(makeInput({ summary: `event-${i}` }));
    }

    const recent = mgr.getRecent(600);
    expect(recent).toHaveLength(500);
    expect(recent[0].summary).toBe('event-10');
    expect(recent[499].summary).toBe('event-509');
  });

  it('getRecent respects limit', () => {
    const log = makeMockLog();
    const mgr = new ActivityManager(log, makeModeProvider());

    for (let i = 0; i < 10; i++) {
      mgr.record(makeInput({ summary: `event-${i}` }));
    }

    const recent = mgr.getRecent(3);
    expect(recent).toHaveLength(3);
    expect(recent[0].summary).toBe('event-7');
  });

  it('init loads persisted events', async () => {
    const persisted: ActivityEvent[] = [
      {
        id: 'old-1', ts: '2026-03-04T00:00:00Z', kind: 'file_read',
        mode: { templateId: 'x', templateName: 'X', templateVersion: '1', governorProfile: 'strict' },
        allowed: true, decisionSource: 'daemon', summary: 'old event', schemaVersion: 1,
      },
    ];
    const log = makeMockLog({ readRecent: vi.fn().mockResolvedValue(persisted) });
    const mgr = new ActivityManager(log, makeModeProvider());

    await mgr.init();

    const recent = mgr.getRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0].id).toBe('old-1');
  });

  it('mode provider is called for each record', () => {
    const log = makeMockLog();
    const provider = vi.fn().mockReturnValue({
      templateId: 'custom', templateName: 'Custom', templateVersion: '2.0.0', governorProfile: 'research',
    });
    const mgr = new ActivityManager(log, provider);

    mgr.record(makeInput());

    expect(provider).toHaveBeenCalledTimes(1);
    expect(mgr.getRecent()[0].mode.templateId).toBe('custom');
  });

  it('preserves correlationId and streamId from input', () => {
    const log = makeMockLog();
    const mgr = new ActivityManager(log, makeModeProvider());

    mgr.record(makeInput({ correlationId: 'stream-1:call-2', streamId: 'stream-1' }));

    const event = mgr.getRecent()[0];
    expect(event.correlationId).toBe('stream-1:call-2');
    expect(event.streamId).toBe('stream-1');
  });

  it('upserts by correlationId — replaces in buffer', () => {
    const log = makeMockLog();
    const mgr = new ActivityManager(log, makeModeProvider());

    mgr.record(makeInput({ correlationId: 'stream-1:call-1', summary: 'initial', allowed: false }));
    expect(mgr.getRecent()).toHaveLength(1);
    expect(mgr.getRecent()[0].summary).toBe('initial');

    // Upsert with same correlationId
    mgr.record(makeInput({ correlationId: 'stream-1:call-1', summary: 'updated', allowed: true }));
    expect(mgr.getRecent()).toHaveLength(1);
    expect(mgr.getRecent()[0].summary).toBe('updated');
    expect(mgr.getRecent()[0].allowed).toBe(true);
  });

  it('upsert preserves original event id', () => {
    const log = makeMockLog();
    const mgr = new ActivityManager(log, makeModeProvider());

    mgr.record(makeInput({ correlationId: 'corr-1', summary: 'first' }));
    const originalId = mgr.getRecent()[0].id;

    mgr.record(makeInput({ correlationId: 'corr-1', summary: 'second' }));
    expect(mgr.getRecent()[0].id).toBe(originalId);
  });

  it('upsert appends to log (last-write-wins on reload)', () => {
    const log = makeMockLog();
    const mgr = new ActivityManager(log, makeModeProvider());

    mgr.record(makeInput({ correlationId: 'corr-1', summary: 'first' }));
    mgr.record(makeInput({ correlationId: 'corr-1', summary: 'second' }));

    // Log should have two appends (initial + update)
    expect(log.append).toHaveBeenCalledTimes(2);
  });

  it('uses correlationId as event id for new events with correlationId', () => {
    const log = makeMockLog();
    const mgr = new ActivityManager(log, makeModeProvider());

    mgr.record(makeInput({ correlationId: 'stream-1:call-5' }));
    expect(mgr.getRecent()[0].id).toBe('stream-1:call-5');
  });
});

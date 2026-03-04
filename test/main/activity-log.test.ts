// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import { ActivityLog } from '../../src/main/activity-log';
import type { ActivityLogIO } from '../../src/main/activity-log';
import type { ActivityEvent } from '../../src/shared/activity-types';

function makeEvent(overrides: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: 'evt-1',
    ts: '2026-03-04T00:00:00Z',
    kind: 'file_read',
    mode: { templateId: 'help_me_edit', templateName: 'Help me edit', templateVersion: '1.0.0', governorProfile: 'production' },
    allowed: true,
    decisionSource: 'daemon',
    summary: 'Read README.md',
    schemaVersion: 1,
    ...overrides,
  };
}

function makeMockIO(overrides: Partial<ActivityLogIO> = {}): ActivityLogIO {
  return {
    appendFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
    stat: vi.fn().mockResolvedValue({ size: 100 }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    readBytes: vi.fn().mockResolvedValue(Buffer.from('')),
    rename: vi.fn().mockResolvedValue(undefined),
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    ...overrides,
  };
}

describe('ActivityLog', () => {
  it('ensureDir creates .clerk directory', () => {
    const io = makeMockIO();
    new ActivityLog('/project', io);
    expect(io.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('.clerk'), { recursive: true });
  });

  it('ensureDir writes .gitignore with *', () => {
    const io = makeMockIO();
    new ActivityLog('/project', io);
    expect(io.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('.gitignore'), '*\n');
  });

  it('ensureDir skips .gitignore if exists', () => {
    const io = makeMockIO({ existsSync: vi.fn().mockReturnValue(true) });
    new ActivityLog('/project', io);
    expect(io.writeFileSync).not.toHaveBeenCalled();
  });

  it('append writes JSONL line', async () => {
    const io = makeMockIO();
    const log = new ActivityLog('/project', io);
    const event = makeEvent();

    await log.append(event);

    expect(io.appendFile).toHaveBeenCalledTimes(1);
    const written = (io.appendFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
    expect(written).toContain('"id":"evt-1"');
    expect(written.endsWith('\n')).toBe(true);
    expect(JSON.parse(written.trim())).toEqual(event);
  });

  it('append serializes writes (no interleaving)', async () => {
    const order: number[] = [];
    const io = makeMockIO({
      appendFile: vi.fn().mockImplementation(async () => {
        order.push(order.length);
        await new Promise(r => setTimeout(r, 10));
      }),
    });
    const log = new ActivityLog('/project', io);

    const p1 = log.append(makeEvent({ id: '1' }));
    const p2 = log.append(makeEvent({ id: '2' }));
    await Promise.all([p1, p2]);

    expect(io.appendFile).toHaveBeenCalledTimes(2);
    expect(order).toEqual([0, 1]);
  });

  it('readRecent returns empty for missing file', async () => {
    const io = makeMockIO({
      readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
    });
    const log = new ActivityLog('/project', io);

    const events = await log.readRecent();
    expect(events).toEqual([]);
  });

  it('readRecent parses valid JSONL lines', async () => {
    const ev1 = makeEvent({ id: '1' });
    const ev2 = makeEvent({ id: '2' });
    const io = makeMockIO({
      readFile: vi.fn().mockResolvedValue(JSON.stringify(ev1) + '\n' + JSON.stringify(ev2) + '\n'),
    });
    const log = new ActivityLog('/project', io);

    const events = await log.readRecent();
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe('1');
    expect(events[1].id).toBe('2');
  });

  it('readRecent respects maxLines', async () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify(makeEvent({ id: `${i}` }))
    ).join('\n');
    const io = makeMockIO({ readFile: vi.fn().mockResolvedValue(lines) });
    const log = new ActivityLog('/project', io);

    const events = await log.readRecent(3);
    expect(events).toHaveLength(3);
    expect(events[0].id).toBe('7');
  });

  it('readRecent skips malformed lines', async () => {
    const good = JSON.stringify(makeEvent({ id: 'good' }));
    const io = makeMockIO({
      readFile: vi.fn().mockResolvedValue(`{bad json}\n${good}\n`),
    });
    const log = new ActivityLog('/project', io);

    const events = await log.readRecent();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe('good');
  });

  it('rotates when over maxBytes', async () => {
    const io = makeMockIO({
      stat: vi.fn().mockResolvedValue({ size: 3_000_000 }), // over 2MB
      readBytes: vi.fn().mockResolvedValue(Buffer.from('partial\n{"id":"kept","ts":"t"}\n')),
    });
    const log = new ActivityLog('/project', io, { maxBytes: 2_000_000, keepBytes: 1_500_000 });

    await log.append(makeEvent());

    // Should have written the tail (minus leading partial line) + renamed
    expect(io.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('.tmp'),
      '{"id":"kept","ts":"t"}\n',
    );
    expect(io.rename).toHaveBeenCalled();
  });

  it('readRecent dedupes by id (last-write-wins)', async () => {
    const ev1 = makeEvent({ id: 'corr-1', summary: 'initial', allowed: false });
    const ev2 = makeEvent({ id: 'corr-1', summary: 'updated', allowed: true });
    const io = makeMockIO({
      readFile: vi.fn().mockResolvedValue(JSON.stringify(ev1) + '\n' + JSON.stringify(ev2) + '\n'),
    });
    const log = new ActivityLog('/project', io);

    const events = await log.readRecent();
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('updated');
    expect(events[0].allowed).toBe(true);
  });

  it('readRecent dedup preserves order of first occurrence', async () => {
    const ev1 = makeEvent({ id: 'a', summary: 'first' });
    const ev2 = makeEvent({ id: 'b', summary: 'second' });
    const ev3 = makeEvent({ id: 'a', summary: 'first-updated' });
    const io = makeMockIO({
      readFile: vi.fn().mockResolvedValue(
        [ev1, ev2, ev3].map(e => JSON.stringify(e)).join('\n') + '\n'
      ),
    });
    const log = new ActivityLog('/project', io);

    const events = await log.readRecent();
    expect(events).toHaveLength(2);
    expect(events[0].id).toBe('a');
    expect(events[0].summary).toBe('first-updated');
    expect(events[1].id).toBe('b');
  });

  it('does not rotate when under maxBytes', async () => {
    const io = makeMockIO({
      stat: vi.fn().mockResolvedValue({ size: 100 }),
    });
    const log = new ActivityLog('/project', io);

    await log.append(makeEvent());

    expect(io.readBytes).not.toHaveBeenCalled();
    expect(io.rename).not.toHaveBeenCalled();
  });
});

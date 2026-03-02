// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';

// Only need to mock electron (no fs/child_process mocking — we use DI)
vi.mock('electron', () => ({
  app: { isPackaged: false },
}));

import { resolveGovernorDaemon, type SystemIO } from '../../src/main/daemon-resolver';

/** Create a fake SystemIO for testing. */
function fakeIO(overrides: Partial<SystemIO> = {}): SystemIO {
  return {
    existsSync: () => false,
    accessSync: () => {},
    spawnSync: () => ({ status: 1, stdout: '', stderr: '', error: null }),
    execFileSync: () => { throw new Error('not found'); },
    isPackaged: false,
    resourcesPath: '',
    platform: 'linux',
    env: {},
    ...overrides,
  };
}

describe('daemon-resolver', () => {
  it('resolves from GOVERNOR_BIN env when set and valid', () => {
    const io = fakeIO({
      env: { GOVERNOR_BIN: '/usr/local/bin/governor' },
      existsSync: () => true,
      spawnSync: () => ({ status: 0, stdout: 'governor 2.5.0\n', stderr: '', error: null }),
    });

    const result = resolveGovernorDaemon(io);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe('/usr/local/bin/governor');
      expect(result.source).toBe('env');
      expect(result.version).toBe('governor 2.5.0');
    }
  });

  it('fails when GOVERNOR_BIN points to missing file', () => {
    const io = fakeIO({
      env: { GOVERNOR_BIN: '/nonexistent/governor' },
      existsSync: () => false,
    });

    const result = resolveGovernorDaemon(io);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('NOT_EXECUTABLE');
      expect(result.detail).toContain('GOVERNOR_BIN');
      expect(result.detail).toContain('file not found');
    }
  });

  it('reports BAD_BINARY when env binary fails probe', () => {
    const io = fakeIO({
      env: { GOVERNOR_BIN: '/usr/bin/governor' },
      existsSync: () => true,
      // Both --version and --help fail
      spawnSync: () => ({ status: 1, stdout: '', stderr: 'segfault', error: null }),
    });

    const result = resolveGovernorDaemon(io);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('BAD_BINARY');
    }
  });

  it('falls back to PATH when no env var set', () => {
    const io = fakeIO({
      execFileSync: () => '/home/user/.local/bin/governor\n',
      spawnSync: () => ({ status: 0, stdout: 'governor 2.5.0\n', stderr: '', error: null }),
    });

    const result = resolveGovernorDaemon(io);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('path');
      expect(result.path).toBe('/home/user/.local/bin/governor');
    }
  });

  it('returns NOT_FOUND when nothing works', () => {
    const io = fakeIO(); // defaults: nothing exists, which throws

    const result = resolveGovernorDaemon(io);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('NOT_FOUND');
      expect(result.tried.length).toBeGreaterThan(0);
      expect(result.tried).toContain('path: governor not found on PATH');
    }
  });

  it('falls back to --help probe when --version fails', () => {
    let callCount = 0;
    const io = fakeIO({
      execFileSync: () => '/usr/bin/governor\n',
      spawnSync: (_cmd: string, args: string[]) => {
        callCount++;
        if (args[0] === '--version') {
          return { status: 2, stdout: '', stderr: 'No such option', error: null };
        }
        // --help succeeds
        return { status: 0, stdout: 'Usage: governor [OPTIONS]', stderr: '', error: null };
      },
    });

    const result = resolveGovernorDaemon(io);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.version).toContain('pre-2.5.0');
      expect(result.source).toBe('path');
    }
  });

  it('checks bundled binary when app is packaged', () => {
    const io = fakeIO({
      isPackaged: true,
      resourcesPath: '/app/resources',
      existsSync: (p: string) => p === '/app/resources/governor/governor',
      spawnSync: () => ({ status: 0, stdout: 'governor 2.5.0', stderr: '', error: null }),
    });

    const result = resolveGovernorDaemon(io);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.source).toBe('bundled');
      expect(result.path).toBe('/app/resources/governor/governor');
    }
  });

  it('skips bundled check when app is not packaged', () => {
    const existsSyncSpy = vi.fn(() => false);
    const io = fakeIO({
      isPackaged: false,
      resourcesPath: '/app/resources',
      existsSync: existsSyncSpy,
    });

    resolveGovernorDaemon(io);

    // Should NOT check bundled paths
    const calledPaths = existsSyncSpy.mock.calls.map(c => c[0]);
    expect(calledPaths.some((p: string) => p.includes('resources'))).toBe(false);
  });

  it('handles Windows platform (no +x check, uses .exe)', () => {
    const io = fakeIO({
      platform: 'win32',
      isPackaged: true,
      resourcesPath: 'C:\\app\\resources',
      existsSync: (p: string) => p.includes('governor.exe'),
      spawnSync: () => ({ status: 0, stdout: 'governor 2.5.0', stderr: '', error: null }),
    });

    const result = resolveGovernorDaemon(io);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toContain('governor.exe');
      expect(result.source).toBe('bundled');
    }
  });

  it('result shape on failure is correct', () => {
    const result = resolveGovernorDaemon(fakeIO());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.reason).toBe('string');
      expect(typeof result.detail).toBe('string');
      expect(Array.isArray(result.tried)).toBe(true);
      expect(['NOT_FOUND', 'NOT_EXECUTABLE', 'BAD_BINARY', 'SPAWN_FAILED']).toContain(result.reason);
    }
  });
});

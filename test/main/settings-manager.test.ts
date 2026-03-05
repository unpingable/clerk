// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import { SettingsManager, type SettingsManagerIO } from '../../src/main/settings-manager';

function makeIO(files: Record<string, string> = {}): SettingsManagerIO & { files: Record<string, string> } {
  const store: Record<string, string> = { ...files };
  return {
    files: store,
    readFileSync: (p: string) => {
      if (!(p in store)) throw new Error(`ENOENT: ${p}`);
      return store[p];
    },
    writeFileSync: (p: string, d: string) => { store[p] = d; },
    renameSync: (s: string, d: string) => {
      if (!(s in store)) throw new Error(`ENOENT: ${s}`);
      store[d] = store[s];
      delete store[s];
    },
    existsSync: (p: string) => p in store,
    mkdirSync: () => {},
    unlinkSync: (p: string) => { delete store[p]; },
  };
}

describe('SettingsManager', () => {
  it('returns defaults when no file exists', () => {
    const io = makeIO();
    const mgr = new SettingsManager('/tmp/settings', io);
    expect(mgr.getAll()).toEqual({ friendlyMode: true });
  });

  it('round-trips getAll/set', () => {
    const io = makeIO();
    const mgr = new SettingsManager('/tmp/settings', io);
    const result = mgr.set({ friendlyMode: false });
    expect(result).toEqual({ friendlyMode: false });
    expect(mgr.getAll()).toEqual({ friendlyMode: false });
  });

  it('partial merge preserves other keys', () => {
    const io = makeIO();
    const mgr = new SettingsManager('/tmp/settings', io);
    mgr.set({ friendlyMode: false });
    // Set with empty partial — nothing changes
    const result = mgr.set({});
    expect(result).toEqual({ friendlyMode: false });
  });

  it('persists to disk and loads on next construction', () => {
    const io = makeIO();
    const mgr1 = new SettingsManager('/tmp/settings', io);
    mgr1.set({ friendlyMode: false });

    // New manager reads persisted file
    const mgr2 = new SettingsManager('/tmp/settings', io);
    expect(mgr2.getAll()).toEqual({ friendlyMode: false });
  });

  it('atomic write: writes to tmp, then renames', () => {
    const io = makeIO();
    const writeSpy = vi.spyOn(io, 'writeFileSync');
    const renameSpy = vi.spyOn(io, 'renameSync');

    const mgr = new SettingsManager('/tmp/settings', io);
    mgr.set({ friendlyMode: false });

    expect(writeSpy).toHaveBeenCalledWith(
      '/tmp/settings/clerk-settings.json.tmp',
      expect.any(String),
    );
    expect(renameSpy).toHaveBeenCalledWith(
      '/tmp/settings/clerk-settings.json.tmp',
      '/tmp/settings/clerk-settings.json',
    );
  });

  it('corrupt file is renamed to .corrupt-{ts} and defaults are loaded', () => {
    const io = makeIO({
      '/tmp/settings/clerk-settings.json': 'not valid json{{{',
    });
    const renameSpy = vi.spyOn(io, 'renameSync');

    const mgr = new SettingsManager('/tmp/settings', io);
    expect(mgr.getAll()).toEqual({ friendlyMode: true });

    // Should have renamed the corrupt file
    expect(renameSpy).toHaveBeenCalledWith(
      '/tmp/settings/clerk-settings.json',
      expect.stringContaining('.corrupt-'),
    );
  });

  it('corrupt file with wrong schema version triggers quarantine', () => {
    const io = makeIO({
      '/tmp/settings/clerk-settings.json': JSON.stringify({ schemaVersion: 99, settings: {} }),
    });

    const mgr = new SettingsManager('/tmp/settings', io);
    expect(mgr.getAll()).toEqual({ friendlyMode: true });
    // Corrupt file renamed away
    expect(io.existsSync('/tmp/settings/clerk-settings.json')).toBe(false);
  });

  it('works standalone without daemon', () => {
    const io = makeIO();
    // No client, no daemon — just settings
    const mgr = new SettingsManager('/tmp/settings', io);
    expect(mgr.getAll()).toEqual({ friendlyMode: true });
    mgr.set({ friendlyMode: false });
    expect(mgr.getAll()).toEqual({ friendlyMode: false });
  });

  it('ignores unknown keys in partial', () => {
    const io = makeIO();
    const mgr = new SettingsManager('/tmp/settings', io);
    const result = mgr.set({ friendlyMode: false, bogus: 42 } as any);
    expect(result).toEqual({ friendlyMode: false });
    expect((result as any).bogus).toBeUndefined();
  });
});

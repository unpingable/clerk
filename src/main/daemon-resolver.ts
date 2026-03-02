// SPDX-License-Identifier: Apache-2.0
/**
 * Daemon resolver — find a working governor binary before we try to spawn it.
 *
 * Search order:
 *   1. GOVERNOR_BIN env var (power user override)
 *   2. Bundled binary in resources/ (packaged app only)
 *   3. PATH lookup (dev / pre-installed)
 *
 * Each candidate is verified by running `governor --version` (>= 2.5.0) or
 * `governor --help` (older). Returns a structured result so the renderer can
 * show a first-run screen instead of silently failing.
 */

import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type DaemonResolveOk = {
  ok: true;
  path: string;
  version: string;
  source: 'env' | 'bundled' | 'path';
};

export type DaemonResolveErr = {
  ok: false;
  reason: 'NOT_FOUND' | 'NOT_EXECUTABLE' | 'BAD_BINARY' | 'SPAWN_FAILED';
  detail: string;
  tried: string[];
};

export type DaemonResolveResult = DaemonResolveOk | DaemonResolveErr;

// ---------------------------------------------------------------------------
// System IO — injectable for testing
// ---------------------------------------------------------------------------

export interface SystemIO {
  existsSync(p: string): boolean;
  accessSync(p: string, mode: number): void;
  spawnSync(cmd: string, args: string[], opts: object): { status: number | null; stdout: string; stderr: string; error: Error | null };
  execFileSync(cmd: string, args: string[], opts: object): string;
  isPackaged: boolean;
  resourcesPath: string;
  platform: string;
  env: Record<string, string | undefined>;
}

/** Real system IO — used in production. */
function realIO(): SystemIO {
  return {
    existsSync: (p) => fs.existsSync(p),
    accessSync: (p, mode) => fs.accessSync(p, mode),
    spawnSync: (cmd, args, opts) => spawnSync(cmd, args, opts as Parameters<typeof spawnSync>[2]) as { status: number | null; stdout: string; stderr: string; error: Error | null },
    execFileSync: (cmd, args, opts) => execFileSync(cmd, args, opts as Parameters<typeof execFileSync>[2]) as string,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath ?? '',
    platform: process.platform,
    env: process.env as Record<string, string | undefined>,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function existsAndExecutable(p: string, io: SystemIO): { ok: boolean; detail: string } {
  if (!io.existsSync(p)) return { ok: false, detail: 'file not found' };

  if (io.platform === 'win32') return { ok: true, detail: 'windows-no-xbit' };

  try {
    io.accessSync(p, fs.constants.X_OK);
    return { ok: true, detail: 'executable' };
  } catch {
    return { ok: false, detail: 'not executable (missing +x)' };
  }
}

function probe(binPath: string, io: SystemIO): { ok: boolean; version: string; detail: string } {
  try {
    // Try --version first (>= 2.5.0)
    const vr = io.spawnSync(binPath, ['--version'], { encoding: 'utf-8', timeout: 5000 });

    if (!vr.error && vr.status === 0 && vr.stdout?.trim()) {
      return { ok: true, version: vr.stdout.trim(), detail: 'version probe succeeded' };
    }

    // Fall back to --help (pre-2.5.0)
    const hr = io.spawnSync(binPath, ['--help'], { encoding: 'utf-8', timeout: 5000 });

    if (hr.error) {
      return { ok: false, version: '', detail: `spawn error: ${String(hr.error)}` };
    }
    if (hr.status !== 0) {
      return { ok: false, version: '', detail: `exit ${hr.status}: ${(hr.stderr || hr.stdout || '').slice(0, 200)}` };
    }

    return { ok: true, version: 'unknown (pre-2.5.0)', detail: 'help probe succeeded' };
  } catch (e) {
    return { ok: false, version: '', detail: `exception: ${String(e)}` };
  }
}

function bundledCandidates(io: SystemIO): string[] {
  const exe = io.platform === 'win32' ? 'governor.exe' : 'governor';
  if (!io.resourcesPath) return [];

  return [
    path.join(io.resourcesPath, 'governor', exe),
    path.join(io.resourcesPath, exe),
  ];
}

function whichGovernor(io: SystemIO): string | null {
  try {
    const cmd = io.platform === 'win32' ? 'where' : 'which';
    return io.execFileSync(cmd, ['governor'], { encoding: 'utf-8' }).trim().split('\n')[0] ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function resolveGovernorDaemon(io?: SystemIO): DaemonResolveResult {
  const sys = io ?? realIO();
  const tried: string[] = [];

  // 1) GOVERNOR_BIN env override
  const envBin = sys.env['GOVERNOR_BIN'];
  if (envBin) {
    tried.push(`env: ${envBin}`);
    const chk = existsAndExecutable(envBin, sys);
    if (!chk.ok) {
      return { ok: false, reason: 'NOT_EXECUTABLE', detail: `GOVERNOR_BIN: ${chk.detail}`, tried };
    }
    const p = probe(envBin, sys);
    if (!p.ok) {
      return { ok: false, reason: 'BAD_BINARY', detail: `GOVERNOR_BIN: ${p.detail}`, tried };
    }
    return { ok: true, path: envBin, version: p.version, source: 'env' };
  }

  // 2) Bundled binary (packaged app only)
  if (sys.isPackaged) {
    for (const candidate of bundledCandidates(sys)) {
      tried.push(`bundled: ${candidate}`);
      const chk = existsAndExecutable(candidate, sys);
      if (!chk.ok) continue;
      const p = probe(candidate, sys);
      if (!p.ok) continue;
      return { ok: true, path: candidate, version: p.version, source: 'bundled' };
    }
  }

  // 3) PATH lookup
  const pathBin = whichGovernor(sys);
  if (pathBin) {
    tried.push(`path: ${pathBin}`);
    const p = probe(pathBin, sys);
    if (p.ok) {
      return { ok: true, path: pathBin, version: p.version, source: 'path' };
    }
    tried.push(`path probe failed: ${p.detail}`);
  } else {
    tried.push('path: governor not found on PATH');
  }

  // 4) Nothing worked
  return {
    ok: false,
    reason: 'NOT_FOUND',
    detail: 'Could not locate a working governor binary via GOVERNOR_BIN, bundled resources, or PATH.',
    tried,
  };
}

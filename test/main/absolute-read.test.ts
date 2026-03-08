// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Mock Electron + fs before importing the handler module.
// vi.mock factories are hoisted — no local variable references allowed.
// ---------------------------------------------------------------------------

const handlers = new Map<string, Function>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: Function) => { handlers.set(channel, fn); },
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

vi.mock('node:fs', () => {
  return {
    default: {
      lstatSync: vi.fn(),
      readFileSync: vi.fn(),
    },
    lstatSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

// Import after mocks are set up
import fs from 'node:fs';
import { registerIpcHandlers } from '../../src/main/ipc-handlers';

const mockLstat = fs.lstatSync as ReturnType<typeof vi.fn>;
const mockReadFile = fs.readFileSync as ReturnType<typeof vi.fn>;

function getHandler(): Function {
  return handlers.get('files:read:absolute')!;
}

describe('FILES_READ_ABSOLUTE handler', () => {
  beforeEach(() => {
    handlers.clear();
    vi.clearAllMocks();
    registerIpcHandlers(null, null, { ok: false, reason: 'NOT_FOUND', detail: '', tried: [] });
  });

  it('reads valid UTF-8 file → ok + content + hash + size', async () => {
    const content = 'Hello, world!\n';
    const buf = Buffer.from(content, 'utf-8');
    mockLstat.mockReturnValue({
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true,
      size: buf.length,
    });
    mockReadFile.mockReturnValue(buf);

    const result = await getHandler()({}, '/tmp/test.txt');
    expect(result.ok).toBe(true);
    expect(result.content).toBe(content);
    expect(result.size).toBe(buf.length);
    expect(result.contentHash).toBe(
      crypto.createHash('sha256').update(buf).digest('hex'),
    );
  });

  it('rejects binary file (NUL byte)', async () => {
    const buf = Buffer.from([0x48, 0x65, 0x00, 0x6c]);
    mockLstat.mockReturnValue({
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true,
      size: buf.length,
    });
    mockReadFile.mockReturnValue(buf);

    const result = await getHandler()({}, '/tmp/binary.bin');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/binary/i);
  });

  it('rejects file over 2 MB', async () => {
    mockLstat.mockReturnValue({
      isSymbolicLink: () => false,
      isDirectory: () => false,
      isFile: () => true,
      size: 3 * 1024 * 1024,
    });

    const result = await getHandler()({}, '/tmp/huge.dat');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/too large/i);
  });

  it('rejects symlink', async () => {
    mockLstat.mockReturnValue({
      isSymbolicLink: () => true,
      isDirectory: () => false,
      isFile: () => false,
      size: 100,
    });

    const result = await getHandler()({}, '/tmp/link');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/links/i);
  });

  it('rejects directory', async () => {
    mockLstat.mockReturnValue({
      isSymbolicLink: () => false,
      isDirectory: () => true,
      isFile: () => false,
      size: 0,
    });

    const result = await getHandler()({}, '/tmp/mydir');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/folders/i);
  });

  it('rejects nonexistent path', async () => {
    mockLstat.mockImplementation(() => { throw new Error('ENOENT'); });

    const result = await getHandler()({}, '/tmp/nope.txt');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found|couldn't read/i);
  });

  it('rejects invalid path argument', async () => {
    const result = await getHandler()({}, 42);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/invalid/i);
  });
});

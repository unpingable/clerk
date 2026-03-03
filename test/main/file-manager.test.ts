// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { FileManager } from '../../src/main/file-manager';
import type { FileManagerClient, FileManagerIO, FileManagerTemplateState } from '../../src/main/file-manager';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const PROJECT_ROOT = '/home/user/project';

function makeMockClient(overrides: Partial<FileManagerClient> = {}): FileManagerClient {
  return {
    isRunning: true,
    scopeCheck: vi.fn().mockResolvedValue({ allowed: true, reason: 'allowed by policy' }),
    ...overrides,
  };
}

function makeMockIO(overrides: Partial<FileManagerIO> = {}): FileManagerIO {
  return {
    lstat: vi.fn().mockResolvedValue({
      isSymbolicLink: () => false,
      isDirectory: () => false,
      size: 100,
    }),
    stat: vi.fn().mockResolvedValue({ size: 100 }),
    readFile: vi.fn().mockResolvedValue('file content'),
    open: vi.fn().mockResolvedValue({
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    realpath: vi.fn().mockImplementation(async (p: string) => p),
    access: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([
      { name: 'file.txt', isFile: () => true, isDirectory: () => false },
      { name: 'subdir', isFile: () => false, isDirectory: () => true },
    ]),
    ...overrides,
  };
}

function makeTemplateState(): () => FileManagerTemplateState {
  return () => ({
    appliedTemplateId: 'help_me_edit',
    appliedProfile: 'production',
  });
}

function makeManager(
  clientOverrides: Partial<FileManagerClient> = {},
  ioOverrides: Partial<FileManagerIO> = {},
): { manager: FileManager; client: FileManagerClient; io: FileManagerIO } {
  const client = makeMockClient(clientOverrides);
  const io = makeMockIO(ioOverrides);
  const manager = new FileManager(client, PROJECT_ROOT, makeTemplateState(), io);
  return { manager, client, io };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FileManager', () => {
  describe('readFile', () => {
    it('reads a file when scope allows', async () => {
      const { manager } = makeManager();
      const result = await manager.readFile('src/index.ts');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.content).toBe('file content');
        expect(result.resolvedPath).toBe(path.resolve(PROJECT_ROOT, 'src/index.ts'));
        expect(result.decision.allowed).toBe(true);
        expect(result.decision.appliedTemplateId).toBe('help_me_edit');
        expect(result.decision.appliedProfile).toBe('production');
      }
    });

    it('returns BLOCKED when scope denies', async () => {
      const { manager } = makeManager({
        scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'read denied by policy' }),
      });
      const result = await manager.readFile('secret.key');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('BLOCKED');
        expect(result.message).toBe('read denied by policy');
        expect(result.decision).toBeDefined();
        expect(result.decision!.allowed).toBe(false);
      }
    });

    it('returns NOT_FOUND for missing files', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
        stat: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
        readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
      });
      const result = await manager.readFile('missing.txt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('NOT_FOUND');
      }
    });

    it('returns CONTENT_TOO_LARGE for files over 5MB', async () => {
      const { manager } = makeManager({}, {
        stat: vi.fn().mockResolvedValue({ size: 6 * 1024 * 1024 }),
      });
      const result = await manager.readFile('huge.bin');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CONTENT_TOO_LARGE');
      }
    });

    it('returns PATH_DENIED for paths outside project root', async () => {
      const { manager, client } = makeManager();
      const result = await manager.readFile('../../etc/passwd');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('PATH_DENIED');
      }
      // scope.check must never be called for out-of-bounds paths
      expect(client.scopeCheck).not.toHaveBeenCalled();
    });

    it('returns PATH_DENIED for absolute paths', async () => {
      const { manager, client } = makeManager();
      const result = await manager.readFile('/etc/passwd');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('PATH_DENIED');
      }
      expect(client.scopeCheck).not.toHaveBeenCalled();
    });

    it('returns BINARY_FILE for files with null bytes', async () => {
      const { manager } = makeManager({}, {
        readFile: vi.fn().mockResolvedValue('hello\0world'),
      });
      const result = await manager.readFile('binary.dat');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('BINARY_FILE');
      }
    });

    it('returns PATH_DENIED for symlinks', async () => {
      const { manager, client } = makeManager({}, {
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => true,
          isDirectory: () => false,
          size: 100,
        }),
      });
      const result = await manager.readFile('link.txt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('PATH_DENIED');
        expect(result.message).toContain('Symlink');
      }
      expect(client.scopeCheck).not.toHaveBeenCalled();
    });

    it('returns PATH_TOO_LONG for excessively long paths', async () => {
      const { manager } = makeManager();
      const longPath = 'a'.repeat(1025);
      const result = await manager.readFile(longPath);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('PATH_TOO_LONG');
      }
    });
  });

  describe('writeFile', () => {
    it('creates a file when scope allows', async () => {
      const { manager, io } = makeManager({}, {
        // Parent exists and is a directory
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          size: 0,
        }),
      });
      const result = await manager.writeFile('new-file.txt', 'hello world');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.resolvedPath).toBe(path.resolve(PROJECT_ROOT, 'new-file.txt'));
        expect(result.decision.allowed).toBe(true);
      }
      expect(io.open).toHaveBeenCalledWith(
        path.resolve(PROJECT_ROOT, 'new-file.txt'),
        'wx',
      );
    });

    it('returns BLOCKED when scope denies write', async () => {
      const { manager } = makeManager(
        {
          scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'write denied' }),
        },
        {
          lstat: vi.fn().mockImplementation(async (p: string) => {
            if (p === path.dirname(path.resolve(PROJECT_ROOT, 'blocked.txt'))) {
              return { isSymbolicLink: () => false, isDirectory: () => true, size: 0 };
            }
            // Target does not exist
            throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          }),
        },
      );
      const result = await manager.writeFile('blocked.txt', 'content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('BLOCKED');
        expect(result.decision).toBeDefined();
      }
    });

    it('returns FILE_EXISTS when file already exists', async () => {
      const existsErr = Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      const { manager } = makeManager(
        {},
        {
          lstat: vi.fn().mockResolvedValue({
            isSymbolicLink: () => false,
            isDirectory: () => true,
            size: 0,
          }),
          open: vi.fn().mockRejectedValue(existsErr),
        },
      );
      const result = await manager.writeFile('existing.txt', 'content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('FILE_EXISTS');
      }
    });

    it('returns PATH_DENIED for paths outside project root', async () => {
      const { manager, client } = makeManager();
      const result = await manager.writeFile('../../evil.txt', 'hacked');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('PATH_DENIED');
      }
      expect(client.scopeCheck).not.toHaveBeenCalled();
    });

    it('returns PATH_DENIED for absolute paths', async () => {
      const { manager, client } = makeManager();
      const result = await manager.writeFile('/tmp/evil.txt', 'hacked');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('PATH_DENIED');
      }
      expect(client.scopeCheck).not.toHaveBeenCalled();
    });

    it('returns CONTENT_TOO_LARGE for oversized content', async () => {
      const { manager } = makeManager();
      const bigContent = 'x'.repeat(6 * 1024 * 1024);
      const result = await manager.writeFile('big.txt', bigContent);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('CONTENT_TOO_LARGE');
      }
    });
  });

  describe('listDir', () => {
    it('lists directory when scope allows', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          size: 0,
        }),
      });
      const result = await manager.listDir('src');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.entries).toHaveLength(2);
        expect(result.entries[0].name).toBe('file.txt');
        expect(result.entries[0].type).toBe('file');
        expect(result.entries[1].name).toBe('subdir');
        expect(result.entries[1].type).toBe('directory');
        expect(result.truncated).toBe(false);
        expect(result.decision.allowed).toBe(true);
      }
    });

    it('lists project root with "."', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          size: 0,
        }),
      });
      const result = await manager.listDir('.');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.entries).toHaveLength(2);
      }
    });

    it('returns BLOCKED when scope denies', async () => {
      const { manager } = makeManager(
        { scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'list denied' }) },
        {
          lstat: vi.fn().mockResolvedValue({
            isSymbolicLink: () => false,
            isDirectory: () => true,
            size: 0,
          }),
        },
      );
      const result = await manager.listDir('secret');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('BLOCKED');
      }
    });

    it('returns NOT_A_DIRECTORY for files', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => false,
          isDirectory: () => false,
          size: 100,
        }),
      });
      const result = await manager.listDir('file.txt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('NOT_A_DIRECTORY');
      }
    });

    it('returns PATH_DENIED for absolute paths', async () => {
      const { manager, client } = makeManager();
      const result = await manager.listDir('/etc');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('PATH_DENIED');
      }
      expect(client.scopeCheck).not.toHaveBeenCalled();
    });

    it('truncates when entries exceed MAX_DIR_ENTRIES', async () => {
      const manyEntries = Array.from({ length: 250 }, (_, i) => ({
        name: `file-${i}.txt`,
        isFile: () => true,
        isDirectory: () => false,
      }));
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          size: 0,
        }),
        readdir: vi.fn().mockResolvedValue(manyEntries),
      });
      const result = await manager.listDir('big-dir');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.entries).toHaveLength(200);
        expect(result.truncated).toBe(true);
      }
    });
  });

  describe('daemon not ready', () => {
    it('returns DAEMON_NOT_READY for read when client is null', async () => {
      const io = makeMockIO();
      const manager = new FileManager(null, PROJECT_ROOT, makeTemplateState(), io);
      const result = await manager.readFile('file.txt');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('DAEMON_NOT_READY');
      }
    });

    it('returns DAEMON_NOT_READY for write when client is not running', async () => {
      const io = makeMockIO({
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          size: 0,
        }),
      });
      const client = makeMockClient({ isRunning: false });
      const manager = new FileManager(client, PROJECT_ROOT, makeTemplateState(), io);
      const result = await manager.writeFile('file.txt', 'content');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('DAEMON_NOT_READY');
      }
    });
  });
});

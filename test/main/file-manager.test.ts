// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import crypto from 'node:crypto';
import { FileManager } from '../../src/main/file-manager';
import type { FileManagerClient, FileManagerIO, FileManagerTemplateState } from '../../src/main/file-manager';
import type { ActivityRecorder } from '../../src/main/activity-manager';
import type { AskGrantToken } from '../../src/shared/types';

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
    readFileRaw: vi.fn().mockResolvedValue(Buffer.from('file content', 'utf-8')),
    readFile: vi.fn().mockResolvedValue('file content'),
    open: vi.fn().mockResolvedValue({
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    rename: vi.fn().mockResolvedValue(undefined),
    realpath: vi.fn().mockImplementation(async (p: string) => p),
    access: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn().mockResolvedValue([
      { name: 'file.txt', isFile: () => true, isDirectory: () => false },
      { name: 'subdir', isFile: () => false, isDirectory: () => true },
    ]),
    mkdir: vi.fn().mockResolvedValue(undefined),
    copyFile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function hashOf(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

function makeTemplateState(): () => FileManagerTemplateState {
  return () => ({
    appliedTemplateId: 'help_me_edit',
    appliedProfile: 'production',
  });
}

function makeMockRecorder(): ActivityRecorder & { record: ReturnType<typeof vi.fn> } {
  return { record: vi.fn() };
}

function makeManager(
  clientOverrides: Partial<FileManagerClient> = {},
  ioOverrides: Partial<FileManagerIO> = {},
  recorder?: ActivityRecorder,
): { manager: FileManager; client: FileManagerClient; io: FileManagerIO } {
  const client = makeMockClient(clientOverrides);
  const io = makeMockIO(ioOverrides);
  const manager = new FileManager(client, PROJECT_ROOT, makeTemplateState(), io, recorder ?? null);
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

  describe('activity recording', () => {
    it('records successful read', async () => {
      const recorder = makeMockRecorder();
      const { manager } = makeManager({}, {}, recorder);
      await manager.readFile('src/index.ts');

      expect(recorder.record).toHaveBeenCalledTimes(1);
      const call = recorder.record.mock.calls[0][0];
      expect(call.kind).toBe('file_read');
      expect(call.allowed).toBe(true);
      expect(call.path).toBe('src/index.ts');
    });

    it('records blocked read', async () => {
      const recorder = makeMockRecorder();
      const { manager } = makeManager(
        { scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'denied' }) },
        {},
        recorder,
      );
      await manager.readFile('secret.key');

      expect(recorder.record).toHaveBeenCalledTimes(1);
      const call = recorder.record.mock.calls[0][0];
      expect(call.kind).toBe('file_read');
      expect(call.allowed).toBe(false);
      expect(call.errorCode).toBe('BLOCKED');
    });

    it('passes correlationId through context', async () => {
      const recorder = makeMockRecorder();
      const { manager } = makeManager({}, {}, recorder);
      await manager.readFile('file.txt', { correlationId: 'stream1:call1' });

      expect(recorder.record).toHaveBeenCalledTimes(1);
      expect(recorder.record.mock.calls[0][0].correlationId).toBe('stream1:call1');
    });
  });

  describe('.clerk/ filtering', () => {
    it('filters .clerk directory from listDir results', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          size: 0,
        }),
        readdir: vi.fn().mockResolvedValue([
          { name: 'file.txt', isFile: () => true, isDirectory: () => false },
          { name: '.clerk', isFile: () => false, isDirectory: () => true },
          { name: 'subdir', isFile: () => false, isDirectory: () => true },
        ]),
      });
      const result = await manager.listDir('.');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.entries).toHaveLength(2);
        expect(result.entries.find(e => e.name === '.clerk')).toBeUndefined();
      }
    });
  });

  describe('readFile hash fields', () => {
    it('returns contentHash and hashCoversFullFile on success', async () => {
      const { manager } = makeManager();
      const result = await manager.readFile('src/index.ts');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.contentHash).toBe(hashOf('file content'));
        expect(result.truncated).toBe(false);
        expect(result.hashCoversFullFile).toBe(true);
      }
    });
  });

  describe('overwriteFile', () => {
    it('overwrites when hash matches (atomic temp+rename)', async () => {
      const existingContent = 'original content';
      const { manager, io } = makeManager({}, {
        readFile: vi.fn().mockResolvedValue(existingContent),
      });
      const result = await manager.overwriteFile('file.txt', 'new content', hashOf(existingContent));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.resolvedPath).toBe(path.resolve(PROJECT_ROOT, 'file.txt'));
        expect(result.decision.allowed).toBe(true);
      }
      expect(io.writeFile).toHaveBeenCalledTimes(1);
      expect(io.rename).toHaveBeenCalledTimes(1);
      // Verify temp file pattern
      const tmpPath = (io.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(tmpPath).toContain('.clerk-tmp-');
    });

    it('returns HASH_MISMATCH when hash differs', async () => {
      const { manager } = makeManager({}, {
        readFile: vi.fn().mockResolvedValue('current content'),
      });
      const result = await manager.overwriteFile('file.txt', 'new content', 'wrong-hash');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('HASH_MISMATCH');
      }
    });

    it('returns NOT_FOUND when file does not exist', async () => {
      const { manager } = makeManager({}, {
        readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
      });
      const result = await manager.overwriteFile('missing.txt', 'content', 'somehash');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('NOT_FOUND');
      }
    });

    it('rejects symlinks', async () => {
      const { manager, client } = makeManager({}, {
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => true,
          isDirectory: () => false,
          size: 100,
        }),
      });
      const result = await manager.overwriteFile('link.txt', 'content', 'hash');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('PATH_DENIED');
      }
      expect(client.scopeCheck).not.toHaveBeenCalled();
    });

    it('returns BLOCKED when scope denies', async () => {
      const existingContent = 'original';
      const { manager } = makeManager(
        { scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'overwrite denied' }) },
        { readFile: vi.fn().mockResolvedValue(existingContent) },
      );
      const result = await manager.overwriteFile('file.txt', 'new', hashOf(existingContent));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('BLOCKED');
        expect(result.decision).toBeDefined();
      }
    });

    it('returns ASK_REQUIRED when scope returns ask_gate_available', async () => {
      const existingContent = 'original';
      const { manager } = makeManager(
        { scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'ASK_REQUIRED', ask_gate_available: true }) },
        { readFile: vi.fn().mockResolvedValue(existingContent) },
      );
      const result = await manager.overwriteFile('file.txt', 'new', hashOf(existingContent));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('ASK_REQUIRED');
        expect(result.decision?.askAvailable).toBe(true);
      }
    });

    it('validates askGrantToken — valid token skips scope check', async () => {
      const existingContent = 'original';
      const token: AskGrantToken = {
        grantId: 'grant-1',
        streamId: 'stream-1',
        correlationId: 'stream-1:call-1',
        toolId: 'file.write.overwrite',
        path: 'file.txt',
        expectedHash: hashOf(existingContent),
        usedAt: null,
      };
      const { manager, client } = makeManager({}, {
        readFile: vi.fn().mockResolvedValue(existingContent),
      });
      const result = await manager.overwriteFile('file.txt', 'new', hashOf(existingContent), {
        correlationId: 'stream-1:call-1',
        streamId: 'stream-1',
        askGrantToken: token,
      });

      expect(result.ok).toBe(true);
      expect(client.scopeCheck).not.toHaveBeenCalled();
      expect(token.usedAt).not.toBeNull();
    });

    it('rejects askGrantToken with wrong path', async () => {
      const existingContent = 'original';
      const token: AskGrantToken = {
        grantId: 'grant-1',
        streamId: 'stream-1',
        correlationId: 'stream-1:call-1',
        toolId: 'file.write.overwrite',
        path: 'other.txt',
        expectedHash: hashOf(existingContent),
        usedAt: null,
      };
      const { manager } = makeManager({}, {
        readFile: vi.fn().mockResolvedValue(existingContent),
      });
      const result = await manager.overwriteFile('file.txt', 'new', hashOf(existingContent), {
        correlationId: 'stream-1:call-1',
        askGrantToken: token,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('BLOCKED');
    });

    it('rejects already-used askGrantToken', async () => {
      const existingContent = 'original';
      const token: AskGrantToken = {
        grantId: 'grant-1',
        streamId: 'stream-1',
        correlationId: 'stream-1:call-1',
        toolId: 'file.write.overwrite',
        path: 'file.txt',
        expectedHash: hashOf(existingContent),
        usedAt: '2026-03-04T00:00:00Z',
      };
      const { manager } = makeManager({}, {
        readFile: vi.fn().mockResolvedValue(existingContent),
      });
      const result = await manager.overwriteFile('file.txt', 'new', hashOf(existingContent), {
        correlationId: 'stream-1:call-1',
        askGrantToken: token,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('BLOCKED');
    });

    it('rejects askGrantToken with wrong correlationId', async () => {
      const existingContent = 'original';
      const token: AskGrantToken = {
        grantId: 'grant-1',
        streamId: 'stream-1',
        correlationId: 'stream-1:call-1',
        toolId: 'file.write.overwrite',
        path: 'file.txt',
        expectedHash: hashOf(existingContent),
        usedAt: null,
      };
      const { manager } = makeManager({}, {
        readFile: vi.fn().mockResolvedValue(existingContent),
      });
      const result = await manager.overwriteFile('file.txt', 'new', hashOf(existingContent), {
        correlationId: 'stream-1:call-DIFFERENT',
        askGrantToken: token,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('BLOCKED');
    });

    it('consumes askGrantToken only after write succeeds', async () => {
      const existingContent = 'original';
      const token: AskGrantToken = {
        grantId: 'grant-1',
        streamId: 'stream-1',
        correlationId: 'stream-1:call-1',
        toolId: 'file.write.overwrite',
        path: 'file.txt',
        expectedHash: hashOf(existingContent),
        usedAt: null,
      };
      const { manager } = makeManager({}, {
        readFile: vi.fn().mockResolvedValue(existingContent),
      });
      const result = await manager.overwriteFile('file.txt', 'new content', hashOf(existingContent), {
        correlationId: 'stream-1:call-1',
        askGrantToken: token,
      });

      expect(result.ok).toBe(true);
      expect(token.usedAt).not.toBeNull();
    });

    it('does not consume askGrantToken when write fails', async () => {
      const existingContent = 'original';
      const token: AskGrantToken = {
        grantId: 'grant-1',
        streamId: 'stream-1',
        correlationId: 'stream-1:call-1',
        toolId: 'file.write.overwrite',
        path: 'file.txt',
        expectedHash: hashOf(existingContent),
        usedAt: null,
      };
      const { manager } = makeManager({}, {
        readFile: vi.fn().mockResolvedValue(existingContent),
        writeFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' })),
      });
      const result = await manager.overwriteFile('file.txt', 'new content', hashOf(existingContent), {
        correlationId: 'stream-1:call-1',
        askGrantToken: token,
      });

      expect(result.ok).toBe(false);
      expect(token.usedAt).toBeNull(); // Token NOT consumed — can retry
    });

    it('returns CONTENT_TOO_LARGE for oversized content', async () => {
      const { manager } = makeManager();
      const bigContent = 'x'.repeat(6 * 1024 * 1024);
      const result = await manager.overwriteFile('big.txt', bigContent, 'hash');

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('CONTENT_TOO_LARGE');
    });

    it('returns PATH_DENIED for paths outside project root', async () => {
      const { manager, client } = makeManager();
      const result = await manager.overwriteFile('../../evil.txt', 'content', 'hash');

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
      expect(client.scopeCheck).not.toHaveBeenCalled();
    });

    it('records activity on successful overwrite', async () => {
      const recorder = makeMockRecorder();
      const existingContent = 'original';
      const { manager } = makeManager({}, {
        readFile: vi.fn().mockResolvedValue(existingContent),
      }, recorder);
      await manager.overwriteFile('file.txt', 'new', hashOf(existingContent));

      expect(recorder.record).toHaveBeenCalledTimes(1);
      const call = recorder.record.mock.calls[0][0];
      expect(call.kind).toBe('file_write_overwrite');
      expect(call.allowed).toBe(true);
    });

    it('records activity on blocked overwrite', async () => {
      const recorder = makeMockRecorder();
      const existingContent = 'original';
      const { manager } = makeManager(
        { scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'denied' }) },
        { readFile: vi.fn().mockResolvedValue(existingContent) },
        recorder,
      );
      await manager.overwriteFile('file.txt', 'new', hashOf(existingContent));

      expect(recorder.record).toHaveBeenCalledTimes(1);
      const call = recorder.record.mock.calls[0][0];
      expect(call.kind).toBe('file_write_overwrite');
      expect(call.allowed).toBe(false);
      expect(call.errorCode).toBe('BLOCKED');
    });

    it('records activity on HASH_MISMATCH', async () => {
      const recorder = makeMockRecorder();
      const existingContent = 'original';
      const { manager } = makeManager(
        {},
        { readFile: vi.fn().mockResolvedValue(existingContent) },
        recorder,
      );
      const result = await manager.overwriteFile('file.txt', 'new', 'wrong-hash');

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('HASH_MISMATCH');
      expect(recorder.record).toHaveBeenCalledTimes(1);
      const call = recorder.record.mock.calls[0][0];
      expect(call.kind).toBe('file_write_overwrite');
      expect(call.allowed).toBe(false);
      expect(call.errorCode).toBe('HASH_MISMATCH');
    });
  });

  // =========================================================================
  // file_patch
  // =========================================================================

  describe('patchFile', () => {
    const fileContent = 'line1\nline2\nline3\n';
    const fileBuffer = Buffer.from(fileContent, 'utf-8');
    const fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const simplePatch = [
      '@@ -1,3 +1,3 @@',
      ' line1',
      '-line2',
      '+LINE2',
      ' line3',
    ].join('\n');

    it('happy path: patches file and returns newHash', async () => {
      const { manager, io } = makeManager({}, {
        readFileRaw: vi.fn().mockResolvedValue(fileBuffer),
      });
      const result = await manager.patchFile('file.txt', simplePatch, fileHash);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.appliedHunks).toBe(1);
        expect(result.newHash).toBeDefined();
        expect(result.resolvedPath).toBe(path.resolve(PROJECT_ROOT, 'file.txt'));
        expect(result.decision.allowed).toBe(true);
      }
      expect(io.writeFile).toHaveBeenCalledTimes(1);
      expect(io.rename).toHaveBeenCalledTimes(1);
      // Verify temp file pattern
      const tmpPath = (io.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
      expect(tmpPath).toContain('.clerk-tmp-');
    });

    it('returns HASH_MISMATCH when hash differs', async () => {
      const { manager } = makeManager({}, {
        readFileRaw: vi.fn().mockResolvedValue(fileBuffer),
      });
      const result = await manager.patchFile('file.txt', simplePatch, 'wrong-hash');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('HASH_MISMATCH');
      }
    });

    it('returns PATCH_FAILED when diff does not apply (content mismatch)', async () => {
      const badPatch = [
        '@@ -1,3 +1,3 @@',
        ' line1',
        '-wrong_content',
        '+new',
        ' line3',
      ].join('\n');
      const { manager } = makeManager({}, {
        readFileRaw: vi.fn().mockResolvedValue(fileBuffer),
      });
      const result = await manager.patchFile('file.txt', badPatch, fileHash);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('PATCH_FAILED');
        expect(result.message).toContain('mismatch');
      }
    });

    it('returns INVALID_PATCH when patch is structurally bad', async () => {
      const invalidPatch = 'this is not a unified diff at all';
      const { manager } = makeManager({}, {
        readFileRaw: vi.fn().mockResolvedValue(fileBuffer),
      });
      const result = await manager.patchFile('file.txt', invalidPatch, fileHash);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('INVALID_PATCH');
      }
    });

    it('returns INVALID_PATCH when ---/+++ headers name wrong file', async () => {
      const wrongFilePatch = [
        '--- a/not-file.txt',
        '+++ b/not-file.txt',
        '@@ -1,3 +1,3 @@',
        ' line1',
        '-line2',
        '+LINE2',
        ' line3',
      ].join('\n');
      const { manager } = makeManager({}, {
        readFileRaw: vi.fn().mockResolvedValue(fileBuffer),
      });
      const result = await manager.patchFile('file.txt', wrongFilePatch, fileHash);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('INVALID_PATCH');
        expect(result.message).toContain('not-file.txt');
        expect(result.message).toContain('file.txt');
      }
    });

    it('scope blocked → BLOCKED, error message has NO file content', async () => {
      const { manager } = makeManager(
        { scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'patch denied by policy' }) },
        { readFileRaw: vi.fn().mockResolvedValue(fileBuffer) },
      );
      const result = await manager.patchFile('file.txt', simplePatch, fileHash);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('BLOCKED');
        expect(result.message).toBe('patch denied by policy');
        // Ensure no file content leaked
        expect(result.message).not.toContain('line1');
        expect(result.message).not.toContain('line2');
      }
    });

    it('non-roundtrippable UTF-8 → BINARY_FILE', async () => {
      // Create a buffer that is not valid UTF-8 roundtrip
      const binaryBuffer = Buffer.from([0xff, 0xfe, 0x00, 0x41]);
      const { manager } = makeManager({}, {
        readFileRaw: vi.fn().mockResolvedValue(binaryBuffer),
      });
      const binaryHash = crypto.createHash('sha256').update(binaryBuffer).digest('hex');
      const result = await manager.patchFile('binary.dat', simplePatch, binaryHash);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('BINARY_FILE');
      }
    });

    it('returns ASK_REQUIRED when scope returns ask_gate_available', async () => {
      const { manager } = makeManager(
        { scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'ASK_REQUIRED', ask_gate_available: true }) },
        { readFileRaw: vi.fn().mockResolvedValue(fileBuffer) },
      );
      const result = await manager.patchFile('file.txt', simplePatch, fileHash);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('ASK_REQUIRED');
        expect(result.decision?.askAvailable).toBe(true);
      }
    });

    it('valid askGrantToken skips scope check', async () => {
      const token: AskGrantToken = {
        grantId: 'grant-1',
        streamId: 'stream-1',
        correlationId: 'stream-1:call-1',
        toolId: 'file.patch',
        path: 'file.txt',
        expectedHash: fileHash,
        usedAt: null,
      };
      const { manager, client } = makeManager({}, {
        readFileRaw: vi.fn().mockResolvedValue(fileBuffer),
      });
      const result = await manager.patchFile('file.txt', simplePatch, fileHash, {
        correlationId: 'stream-1:call-1',
        streamId: 'stream-1',
        askGrantToken: token,
      });

      expect(result.ok).toBe(true);
      expect(client.scopeCheck).not.toHaveBeenCalled();
      expect(token.usedAt).not.toBeNull();
    });

    it('rejects askGrantToken with wrong toolId', async () => {
      const token: AskGrantToken = {
        grantId: 'grant-1',
        streamId: 'stream-1',
        correlationId: 'stream-1:call-1',
        toolId: 'file.write.overwrite', // wrong!
        path: 'file.txt',
        expectedHash: fileHash,
        usedAt: null,
      };
      const { manager } = makeManager({}, {
        readFileRaw: vi.fn().mockResolvedValue(fileBuffer),
      });
      const result = await manager.patchFile('file.txt', simplePatch, fileHash, {
        correlationId: 'stream-1:call-1',
        streamId: 'stream-1',
        askGrantToken: token,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('BLOCKED');
    });

    it('rejects symlinks', async () => {
      const { manager, client } = makeManager({}, {
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => true,
          isDirectory: () => false,
          size: 100,
        }),
      });
      const result = await manager.patchFile('link.txt', simplePatch, fileHash);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
      expect(client.scopeCheck).not.toHaveBeenCalled();
    });

    it('rejects .clerk/ paths', async () => {
      const { manager } = makeManager();
      const result = await manager.patchFile('.clerk/config.json', simplePatch, fileHash);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
    });

    it('atomic write verified (temp+rename)', async () => {
      const { manager, io } = makeManager({}, {
        readFileRaw: vi.fn().mockResolvedValue(fileBuffer),
      });
      await manager.patchFile('file.txt', simplePatch, fileHash);

      const writeCall = (io.writeFile as ReturnType<typeof vi.fn>).mock.calls[0];
      const renameCall = (io.rename as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(writeCall[0]).toContain('.clerk-tmp-');
      expect(renameCall[0]).toBe(writeCall[0]);
      expect(renameCall[1]).toBe(path.resolve(PROJECT_ROOT, 'file.txt'));
    });
  });

  // =========================================================================
  // Slice 3: mkdir, copy, move, delete
  // =========================================================================

  describe('.clerk/ guard', () => {
    it('rejects mkdir inside .clerk/', async () => {
      const { manager } = makeManager();
      const result = await manager.mkdir('.clerk/foo');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('PATH_DENIED');
        expect(result.message).toContain('.clerk');
      }
    });

    it('rejects copy to .clerk/', async () => {
      const { manager } = makeManager();
      const result = await manager.copyFile('file.txt', '.clerk/copy.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
    });

    it('rejects move to .clerk/', async () => {
      const { manager } = makeManager();
      const result = await manager.moveFile('file.txt', '.clerk/moved.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
    });

    it('rejects delete of .clerk/ path', async () => {
      const { manager } = makeManager();
      const result = await manager.deleteFile('.clerk/config.json');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
    });
  });

  describe('mkdir', () => {
    it('creates directory when scope allows', async () => {
      const { manager, io } = makeManager({}, {
        lstat: vi.fn().mockImplementation(async (p: string) => {
          if (p === path.dirname(path.resolve(PROJECT_ROOT, 'new-dir'))) {
            return { isSymbolicLink: () => false, isDirectory: () => true, size: 0 };
          }
          // Target doesn't exist
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }),
        mkdir: vi.fn().mockResolvedValue(undefined),
      });
      const result = await manager.mkdir('new-dir');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.resolvedPath).toBe(path.resolve(PROJECT_ROOT, 'new-dir'));
      }
      expect(io.mkdir).toHaveBeenCalledWith(path.resolve(PROJECT_ROOT, 'new-dir'));
    });

    it('returns PATH_DENIED for absolute path', async () => {
      const { manager, client } = makeManager();
      const result = await manager.mkdir('/tmp/foo');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
      expect(client.scopeCheck).not.toHaveBeenCalled();
    });

    it('returns PATH_DENIED for traversal', async () => {
      const { manager } = makeManager();
      const result = await manager.mkdir('../../escape');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
    });

    it('returns PATH_DENIED when parent is symlink', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockImplementation(async (p: string) => {
          if (p === path.dirname(path.resolve(PROJECT_ROOT, 'sub/new-dir'))) {
            return { isSymbolicLink: () => true, isDirectory: () => true, size: 0 };
          }
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }),
      });
      const result = await manager.mkdir('sub/new-dir');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
    });

    it('returns FILE_EXISTS when target already exists', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => false,
          isDirectory: () => true,
          size: 0,
        }),
      });
      const result = await manager.mkdir('existing-dir');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('FILE_EXISTS');
    });

    it('returns NOT_FOUND when parent does not exist', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
      });
      const result = await manager.mkdir('missing-parent/new-dir');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('NOT_FOUND');
    });

    it('returns NOT_A_DIRECTORY when parent is a file', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockImplementation(async (p: string) => {
          if (p === path.dirname(path.resolve(PROJECT_ROOT, 'file.txt/new-dir'))) {
            return { isSymbolicLink: () => false, isDirectory: () => false, size: 100 };
          }
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }),
      });
      const result = await manager.mkdir('file.txt/new-dir');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('NOT_A_DIRECTORY');
    });

    it('returns BLOCKED when scope denies', async () => {
      const { manager } = makeManager(
        { scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'mkdir denied' }) },
        {
          lstat: vi.fn().mockImplementation(async (p: string) => {
            if (p === path.dirname(path.resolve(PROJECT_ROOT, 'blocked-dir'))) {
              return { isSymbolicLink: () => false, isDirectory: () => true, size: 0 };
            }
            throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          }),
        },
      );
      const result = await manager.mkdir('blocked-dir');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('BLOCKED');
        expect(result.decision).toBeDefined();
      }
    });
  });

  describe('copyFile', () => {
    function makeCopyIO(overrides: Partial<FileManagerIO> = {}): Partial<FileManagerIO> {
      return {
        lstat: vi.fn().mockImplementation(async (p: string) => {
          const srcResolved = path.resolve(PROJECT_ROOT, 'src.txt');
          const destParent = path.dirname(path.resolve(PROJECT_ROOT, 'dest.txt'));
          const srcParent = path.dirname(srcResolved);
          if (p === srcResolved) {
            return { isSymbolicLink: () => false, isDirectory: () => false, size: 100 };
          }
          if (p === srcParent || p === destParent) {
            return { isSymbolicLink: () => false, isDirectory: () => true, size: 0 };
          }
          // dest doesn't exist
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }),
        copyFile: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it('copies file when scope allows', async () => {
      const { manager, io } = makeManager({}, makeCopyIO());
      const result = await manager.copyFile('src.txt', 'dest.txt');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.resolvedSrc).toBe(path.resolve(PROJECT_ROOT, 'src.txt'));
        expect(result.resolvedDest).toBe(path.resolve(PROJECT_ROOT, 'dest.txt'));
      }
      expect(io.copyFile).toHaveBeenCalledWith(
        path.resolve(PROJECT_ROOT, 'src.txt'),
        path.resolve(PROJECT_ROOT, 'dest.txt'),
        1,
      );
    });

    it('returns NOT_FOUND when source does not exist', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
      });
      const result = await manager.copyFile('missing.txt', 'dest.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('NOT_FOUND');
    });

    it('returns NOT_A_DIRECTORY when source is a directory', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => false, isDirectory: () => true, size: 0,
        }),
      });
      const result = await manager.copyFile('src-dir', 'dest.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('NOT_A_DIRECTORY');
    });

    it('returns DEST_EXISTS when destination exists', async () => {
      const srcResolved = path.resolve(PROJECT_ROOT, 'src.txt');
      const destResolved = path.resolve(PROJECT_ROOT, 'existing.txt');
      const srcParent = path.dirname(srcResolved);
      const destParent = path.dirname(destResolved);
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockImplementation(async (p: string) => {
          if (p === srcResolved) {
            return { isSymbolicLink: () => false, isDirectory: () => false, size: 100 };
          }
          if (p === srcParent || p === destParent) {
            return { isSymbolicLink: () => false, isDirectory: () => true, size: 0 };
          }
          if (p === destResolved) {
            return { isSymbolicLink: () => false, isDirectory: () => false, size: 50 };
          }
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }),
      });
      const result = await manager.copyFile('src.txt', 'existing.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('DEST_EXISTS');
    });

    it('returns PATH_DENIED when dest parent is symlink', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockImplementation(async (p: string) => {
          const srcResolved = path.resolve(PROJECT_ROOT, 'src.txt');
          const srcParent = path.dirname(srcResolved);
          const destParent = path.dirname(path.resolve(PROJECT_ROOT, 'link-dir/dest.txt'));
          if (p === srcResolved) {
            return { isSymbolicLink: () => false, isDirectory: () => false, size: 100 };
          }
          if (p === srcParent) {
            return { isSymbolicLink: () => false, isDirectory: () => true, size: 0 };
          }
          if (p === destParent) {
            return { isSymbolicLink: () => true, isDirectory: () => true, size: 0 };
          }
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }),
      });
      const result = await manager.copyFile('src.txt', 'link-dir/dest.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
    });

    it('returns CONTENT_TOO_LARGE for source over 5MB', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockImplementation(async (p: string) => {
          const srcResolved = path.resolve(PROJECT_ROOT, 'big.bin');
          const srcParent = path.dirname(srcResolved);
          if (p === srcResolved) {
            return { isSymbolicLink: () => false, isDirectory: () => false, size: 6 * 1024 * 1024 };
          }
          if (p === srcParent) {
            return { isSymbolicLink: () => false, isDirectory: () => true, size: 0 };
          }
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }),
      });
      const result = await manager.copyFile('big.bin', 'dest.bin');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('CONTENT_TOO_LARGE');
    });

    it('returns PATH_DENIED when source is symlink', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => true, isDirectory: () => false, size: 100,
        }),
      });
      const result = await manager.copyFile('link.txt', 'dest.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
    });

    it('returns BLOCKED when scope denies', async () => {
      const { manager } = makeManager(
        { scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'copy denied' }) },
        makeCopyIO(),
      );
      const result = await manager.copyFile('src.txt', 'dest.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('BLOCKED');
        expect(result.decision).toBeDefined();
      }
    });
  });

  describe('moveFile', () => {
    function makeMoveIO(overrides: Partial<FileManagerIO> = {}): Partial<FileManagerIO> {
      return {
        lstat: vi.fn().mockImplementation(async (p: string) => {
          const srcResolved = path.resolve(PROJECT_ROOT, 'old.txt');
          const destParent = path.dirname(path.resolve(PROJECT_ROOT, 'new.txt'));
          const srcParent = path.dirname(srcResolved);
          if (p === srcResolved) {
            return { isSymbolicLink: () => false, isDirectory: () => false, size: 100 };
          }
          if (p === srcParent || p === destParent) {
            return { isSymbolicLink: () => false, isDirectory: () => true, size: 0 };
          }
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }),
        rename: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it('moves file when scope allows', async () => {
      const { manager, io } = makeManager({}, makeMoveIO());
      const result = await manager.moveFile('old.txt', 'new.txt');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.resolvedSrc).toBe(path.resolve(PROJECT_ROOT, 'old.txt'));
        expect(result.resolvedDest).toBe(path.resolve(PROJECT_ROOT, 'new.txt'));
      }
      expect(io.rename).toHaveBeenCalled();
    });

    it('returns DEST_EXISTS when destination exists', async () => {
      const srcResolved = path.resolve(PROJECT_ROOT, 'old.txt');
      const destResolved = path.resolve(PROJECT_ROOT, 'existing.txt');
      const srcParent = path.dirname(srcResolved);
      const destParent = path.dirname(destResolved);
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockImplementation(async (p: string) => {
          if (p === srcResolved) {
            return { isSymbolicLink: () => false, isDirectory: () => false, size: 100 };
          }
          if (p === srcParent || p === destParent) {
            return { isSymbolicLink: () => false, isDirectory: () => true, size: 0 };
          }
          if (p === destResolved) {
            return { isSymbolicLink: () => false, isDirectory: () => false, size: 50 };
          }
          throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        }),
      });
      const result = await manager.moveFile('old.txt', 'existing.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('DEST_EXISTS');
    });

    it('returns NOT_FOUND when source does not exist', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
      });
      const result = await manager.moveFile('missing.txt', 'dest.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('NOT_FOUND');
    });

    it('returns PATH_DENIED when source is symlink', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => true, isDirectory: () => false, size: 100,
        }),
      });
      const result = await manager.moveFile('link.txt', 'dest.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
    });

    it('returns BLOCKED when scope denies', async () => {
      const { manager } = makeManager(
        { scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'move denied' }) },
        makeMoveIO(),
      );
      const result = await manager.moveFile('old.txt', 'new.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('BLOCKED');
      }
    });

    it('returns ASK_REQUIRED when scope returns ask_gate_available', async () => {
      const { manager } = makeManager(
        { scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'ASK_REQUIRED', ask_gate_available: true }) },
        makeMoveIO(),
      );
      const result = await manager.moveFile('old.txt', 'new.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('ASK_REQUIRED');
        expect(result.decision?.askAvailable).toBe(true);
      }
    });

    it('validates askGrantToken — valid token skips scope check', async () => {
      const token: AskGrantToken = {
        grantId: 'grant-1',
        streamId: 'stream-1',
        correlationId: 'stream-1:call-1',
        toolId: 'file.move',
        path: 'old.txt',
        toPath: 'new.txt',
        usedAt: null,
      };
      const { manager, client } = makeManager({}, makeMoveIO());
      const result = await manager.moveFile('old.txt', 'new.txt', {
        correlationId: 'stream-1:call-1',
        streamId: 'stream-1',
        askGrantToken: token,
      });
      expect(result.ok).toBe(true);
      expect(client.scopeCheck).not.toHaveBeenCalled();
      expect(token.usedAt).not.toBeNull();
    });

    it('rejects askGrantToken with wrong toPath', async () => {
      const token: AskGrantToken = {
        grantId: 'grant-1',
        streamId: 'stream-1',
        correlationId: 'stream-1:call-1',
        toolId: 'file.move',
        path: 'old.txt',
        toPath: 'wrong.txt',
        usedAt: null,
      };
      const { manager } = makeManager({}, makeMoveIO());
      const result = await manager.moveFile('old.txt', 'new.txt', {
        correlationId: 'stream-1:call-1',
        askGrantToken: token,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('BLOCKED');
    });
  });

  describe('deleteFile', () => {
    function makeDeleteIO(overrides: Partial<FileManagerIO> = {}): Partial<FileManagerIO> {
      return {
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => false,
          isDirectory: () => false,
          size: 100,
        }),
        rename: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      };
    }

    it('soft-deletes to .clerk/trash/', async () => {
      const { manager, io } = makeManager({}, makeDeleteIO());
      const result = await manager.deleteFile('temp.txt');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.trashPath).toContain('.clerk/trash/');
        expect(result.trashPath).toContain('temp.txt');
        expect(result.resolvedPath).toBe(path.resolve(PROJECT_ROOT, 'temp.txt'));
      }
      expect(io.rename).toHaveBeenCalled();
      expect(io.mkdir).toHaveBeenCalledTimes(2); // .clerk + .clerk/trash
    });

    it('returns NOT_FOUND when file does not exist', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
      });
      const result = await manager.deleteFile('missing.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('NOT_FOUND');
    });

    it('returns PATH_DENIED for symlinks', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => true,
          isDirectory: () => false,
          size: 100,
        }),
      });
      const result = await manager.deleteFile('link.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
    });

    it('returns BLOCKED when scope denies', async () => {
      const { manager } = makeManager(
        { scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'delete denied' }) },
        makeDeleteIO(),
      );
      const result = await manager.deleteFile('temp.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('BLOCKED');
      }
    });

    it('returns ASK_REQUIRED when scope returns ask_gate_available', async () => {
      const { manager } = makeManager(
        { scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'ASK_REQUIRED', ask_gate_available: true }) },
        makeDeleteIO(),
      );
      const result = await manager.deleteFile('temp.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('ASK_REQUIRED');
        expect(result.decision?.askAvailable).toBe(true);
      }
    });

    it('validates askGrantToken — valid token skips scope check', async () => {
      const token: AskGrantToken = {
        grantId: 'grant-1',
        streamId: 'stream-1',
        correlationId: 'stream-1:call-1',
        toolId: 'file.delete',
        path: 'temp.txt',
        usedAt: null,
      };
      const { manager, client } = makeManager({}, makeDeleteIO());
      const result = await manager.deleteFile('temp.txt', {
        correlationId: 'stream-1:call-1',
        streamId: 'stream-1',
        askGrantToken: token,
      });
      expect(result.ok).toBe(true);
      expect(client.scopeCheck).not.toHaveBeenCalled();
      expect(token.usedAt).not.toBeNull();
    });

    it('rejects already-used askGrantToken', async () => {
      const token: AskGrantToken = {
        grantId: 'grant-1',
        streamId: 'stream-1',
        correlationId: 'stream-1:call-1',
        toolId: 'file.delete',
        path: 'temp.txt',
        usedAt: '2026-03-05T00:00:00Z',
      };
      const { manager } = makeManager({}, makeDeleteIO());
      const result = await manager.deleteFile('temp.txt', {
        correlationId: 'stream-1:call-1',
        askGrantToken: token,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('BLOCKED');
    });

    it('handles trash dir already existing', async () => {
      const existsErr = Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
      const { manager } = makeManager({}, {
        ...makeDeleteIO(),
        mkdir: vi.fn().mockRejectedValue(existsErr),
      });
      const result = await manager.deleteFile('temp.txt');
      expect(result.ok).toBe(true);
    });

    it('first delete in fresh project creates .clerk/trash and succeeds', async () => {
      // Proves internal trash mkdir bypasses .clerk/ guard
      const mkdirCalls: string[] = [];
      const { manager } = makeManager({}, {
        ...makeDeleteIO(),
        mkdir: vi.fn().mockImplementation(async (p: string) => { mkdirCalls.push(p); }),
      });
      const result = await manager.deleteFile('temp.txt');
      expect(result.ok).toBe(true);
      // Should have created .clerk and .clerk/trash
      expect(mkdirCalls).toHaveLength(2);
      expect(mkdirCalls[0]).toBe(path.join(PROJECT_ROOT, '.clerk'));
      expect(mkdirCalls[1]).toBe(path.join(PROJECT_ROOT, '.clerk', 'trash'));
      // The trash path should be under .clerk/trash
      if (result.ok) {
        expect(result.trashPath).toContain(path.join(PROJECT_ROOT, '.clerk', 'trash'));
      }
    });
  });

  describe('scope axes consistency', () => {
    it('copyFile scope check uses post-validation resolved absolute paths', async () => {
      const srcResolved = path.resolve(PROJECT_ROOT, 'src.txt');
      const destResolved = path.resolve(PROJECT_ROOT, 'dest.txt');
      const scopeCheck = vi.fn().mockResolvedValue({ allowed: true, reason: 'ok' });
      const { manager } = makeManager(
        { scopeCheck },
        {
          lstat: vi.fn().mockImplementation(async (p: string) => {
            if (p === srcResolved) {
              return { isSymbolicLink: () => false, isDirectory: () => false, size: 100 };
            }
            if (p === path.dirname(srcResolved) || p === path.dirname(destResolved)) {
              return { isSymbolicLink: () => false, isDirectory: () => true, size: 0 };
            }
            throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          }),
          copyFile: vi.fn().mockResolvedValue(undefined),
        },
      );
      await manager.copyFile('src.txt', 'dest.txt');

      expect(scopeCheck).toHaveBeenCalledWith('file.copy', expect.objectContaining({
        resource: srcResolved,
        from: srcResolved,
        to: destResolved,
        op: 'copy',
        project_root: PROJECT_ROOT,
      }));
    });

    it('moveFile scope check uses post-validation resolved absolute paths', async () => {
      const srcResolved = path.resolve(PROJECT_ROOT, 'old.txt');
      const destResolved = path.resolve(PROJECT_ROOT, 'new.txt');
      const scopeCheck = vi.fn().mockResolvedValue({ allowed: true, reason: 'ok' });
      const { manager } = makeManager(
        { scopeCheck },
        {
          lstat: vi.fn().mockImplementation(async (p: string) => {
            if (p === srcResolved) {
              return { isSymbolicLink: () => false, isDirectory: () => false, size: 100 };
            }
            if (p === path.dirname(srcResolved) || p === path.dirname(destResolved)) {
              return { isSymbolicLink: () => false, isDirectory: () => true, size: 0 };
            }
            throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          }),
          rename: vi.fn().mockResolvedValue(undefined),
        },
      );
      await manager.moveFile('old.txt', 'new.txt');

      expect(scopeCheck).toHaveBeenCalledWith('file.move', expect.objectContaining({
        resource: srcResolved,
        from: srcResolved,
        to: destResolved,
        op: 'move',
        project_root: PROJECT_ROOT,
      }));
    });
  });

  describe('fileFind', () => {
    function makeFindIO(): Partial<FileManagerIO> {
      return {
        lstat: vi.fn().mockImplementation(async (p: string) => {
          // base is always a dir
          return { isSymbolicLink: () => false, isDirectory: () => true, size: 0 };
        }),
        readdir: vi.fn().mockImplementation(async (dir: string) => {
          const base = path.resolve(PROJECT_ROOT, '.');
          if (dir === base) {
            return [
              { name: 'readme.md', isFile: () => true, isDirectory: () => false },
              { name: 'src', isFile: () => false, isDirectory: () => true },
              { name: '.clerk', isFile: () => false, isDirectory: () => true },
              { name: 'node_modules', isFile: () => false, isDirectory: () => true },
              { name: '.git', isFile: () => false, isDirectory: () => true },
            ];
          }
          if (dir === path.join(base, 'src')) {
            return [
              { name: 'index.ts', isFile: () => true, isDirectory: () => false },
              { name: 'utils.ts', isFile: () => true, isDirectory: () => false },
            ];
          }
          return [];
        }),
      };
    }

    it('finds files recursively, excluding .clerk/node_modules/.git', async () => {
      const { manager } = makeManager({}, makeFindIO());
      const result = await manager.fileFind('.');
      expect(result.ok).toBe(true);
      if (result.ok) {
        const paths = result.entries.map(e => e.path);
        expect(paths).toContain('readme.md');
        expect(paths).toContain('src');
        expect(paths).toContain(path.join('src', 'index.ts'));
        expect(paths).toContain(path.join('src', 'utils.ts'));
        // Excluded dirs should NOT appear
        expect(paths).not.toContain('.clerk');
        expect(paths).not.toContain('node_modules');
        expect(paths).not.toContain('.git');
        expect(result.truncated).toBe(false);
      }
    });

    it('filters by pattern', async () => {
      const { manager } = makeManager({}, makeFindIO());
      const result = await manager.fileFind('.', '*.ts');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.entries.every(e => e.path.endsWith('.ts'))).toBe(true);
        expect(result.entries.length).toBe(2);
      }
    });

    it('returns BLOCKED when scope denies', async () => {
      const { manager } = makeManager(
        { scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'find denied' }) },
        makeFindIO(),
      );
      const result = await manager.fileFind('.');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('BLOCKED');
    });

    it('returns PATH_DENIED for .clerk/ path', async () => {
      const { manager } = makeManager();
      const result = await manager.fileFind('.clerk');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
    });

    it('returns NOT_A_DIRECTORY for file path', async () => {
      const { manager } = makeManager({}, {
        lstat: vi.fn().mockResolvedValue({
          isSymbolicLink: () => false, isDirectory: () => false, size: 100,
        }),
      });
      const result = await manager.fileFind('file.txt');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('NOT_A_DIRECTORY');
    });
  });

  describe('fileGrep', () => {
    function makeGrepIO(): Partial<FileManagerIO> {
      return {
        lstat: vi.fn().mockImplementation(async () => {
          return { isSymbolicLink: () => false, isDirectory: () => true, size: 0 };
        }),
        readdir: vi.fn().mockImplementation(async (dir: string) => {
          const base = path.resolve(PROJECT_ROOT, '.');
          if (dir === base) {
            return [
              { name: 'main.ts', isFile: () => true, isDirectory: () => false },
              { name: 'test.ts', isFile: () => true, isDirectory: () => false },
              { name: '.clerk', isFile: () => false, isDirectory: () => true },
            ];
          }
          return [];
        }),
        readFile: vi.fn().mockImplementation(async (p: string) => {
          if (p.endsWith('main.ts')) return 'line1\nTODO fix this\nline3\n';
          if (p.endsWith('test.ts')) return 'line1\nline2\nAnother TODO here\n';
          return '';
        }),
      };
    }

    it('finds matches across files', async () => {
      const { manager } = makeManager({}, makeGrepIO());
      const result = await manager.fileGrep('TODO', '.');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.matchCount).toBe(2);
        expect(result.fileCount).toBe(2);
        expect(result.matches[0].file).toBe('main.ts');
        expect(result.matches[0].line).toBe(2);
        expect(result.matches[0].preview).toContain('TODO');
      }
    });

    it('is case-insensitive', async () => {
      const { manager } = makeManager({}, makeGrepIO());
      const result = await manager.fileGrep('todo', '.');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.matchCount).toBe(2);
      }
    });

    it('excludes .clerk directory from results', async () => {
      const { manager } = makeManager({}, makeGrepIO());
      const result = await manager.fileGrep('TODO', '.');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.matches.every(m => !m.file.startsWith('.clerk'))).toBe(true);
      }
    });

    it('returns BLOCKED when scope denies', async () => {
      const { manager } = makeManager(
        { scopeCheck: vi.fn().mockResolvedValue({ allowed: false, reason: 'grep denied' }) },
        makeGrepIO(),
      );
      const result = await manager.fileGrep('TODO', '.');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('BLOCKED');
    });

    it('rejects empty query', async () => {
      const { manager } = makeManager();
      const result = await manager.fileGrep('', '.');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
    });

    it('rejects query over 500 chars', async () => {
      const { manager } = makeManager();
      const result = await manager.fileGrep('x'.repeat(501), '.');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('PATH_DENIED');
    });

    it('skips binary files (null bytes)', async () => {
      const { manager } = makeManager({}, {
        ...makeGrepIO(),
        readFile: vi.fn().mockResolvedValue('TODO\0binary'),
      });
      const result = await manager.fileGrep('TODO', '.');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.matchCount).toBe(0);
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

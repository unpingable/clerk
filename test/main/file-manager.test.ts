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

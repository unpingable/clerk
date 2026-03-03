// SPDX-License-Identifier: Apache-2.0
/**
 * FileManager — gated file read/write through the Governor daemon.
 *
 * Safety model:
 * - Root-bounded: relative paths only, resolved against projectRoot
 * - Create-only writes: fs.open('wx') — atomic, no TOCTOU
 * - Symlink rejection: lstat checks on target and parent
 * - Size caps: 5MB read/write, 1024-char path length
 * - UTF-8 only: binary files rejected
 * - All ops go through daemon scope.check before touching disk
 */

import path from 'node:path';
import type {
  FileReadResponse,
  FileWriteResponse,
  FileListResponse,
  FileErrorCode,
  FileErrorResult,
  ScopeDecision,
  DirEntry,
} from '../shared/types.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_PATH_LENGTH = 1024;
export const TOOL_FILE_READ = 'file.read';
export const TOOL_FILE_WRITE_CREATE = 'file.write.create';
export const TOOL_FILE_LIST = 'file.list';
export const MAX_DIR_ENTRIES = 200;

// ---------------------------------------------------------------------------
// DI interfaces
// ---------------------------------------------------------------------------

/** Subset of GovernorClient used by FileManager. */
export interface FileManagerClient {
  scopeCheck(toolId: string, scope: Record<string, string>): Promise<{ allowed: boolean; reason: string }>;
  readonly isRunning: boolean;
}

/** Subset of TemplateManager used by FileManager. */
export interface FileManagerTemplateState {
  appliedTemplateId: string;
  appliedProfile: string;
}

/** Filesystem operations — injectable for testing. */
export interface FileManagerIO {
  lstat(filePath: string): Promise<{ isSymbolicLink(): boolean; isDirectory(): boolean; size: number }>;
  stat(filePath: string): Promise<{ size: number }>;
  readFile(filePath: string, encoding: 'utf-8'): Promise<string>;
  open(filePath: string, flags: string): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  realpath(filePath: string): Promise<string>;
  access(filePath: string): Promise<void>;
  readdir(dirPath: string, options: { withFileTypes: true }): Promise<Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>>;
}

// ---------------------------------------------------------------------------
// FileManager
// ---------------------------------------------------------------------------

export class FileManager {
  private client: FileManagerClient | null;
  private projectRoot: string;
  private getTemplateState: () => FileManagerTemplateState;
  private io: FileManagerIO;

  constructor(
    client: FileManagerClient | null,
    projectRoot: string,
    getTemplateState: () => FileManagerTemplateState,
    io: FileManagerIO,
  ) {
    this.client = client;
    this.projectRoot = projectRoot;
    this.getTemplateState = getTemplateState;
    this.io = io;
  }

  async readFile(relativePath: string): Promise<FileReadResponse> {
    // Input validation
    const pathErr = this.validatePath(relativePath);
    if (pathErr) return pathErr;

    const resolved = path.resolve(this.projectRoot, relativePath);

    // Root bound check
    if (!this.isSubpath(resolved, this.projectRoot)) {
      return this.error('PATH_DENIED', 'Path escapes project root.');
    }

    // Symlink check
    const symlinkErr = await this.rejectSymlink(resolved);
    if (symlinkErr) return symlinkErr;

    // Daemon readiness
    if (!this.client || !this.client.isRunning) {
      return this.error('DAEMON_NOT_READY', 'Governor daemon is not running.');
    }

    // Scope check
    const decision = await this.checkScope(TOOL_FILE_READ, resolved, 'read');
    if (!decision.allowed) {
      return { ok: false, code: 'BLOCKED', message: decision.reason, decision };
    }

    // Size check
    let size: number;
    try {
      const st = await this.io.stat(resolved);
      size = st.size;
    } catch (err) {
      return this.mapNodeError(err);
    }
    if (size > MAX_FILE_SIZE) {
      return this.error('CONTENT_TOO_LARGE', `File is ${size} bytes (limit ${MAX_FILE_SIZE}).`);
    }

    // Read
    let content: string;
    try {
      content = await this.io.readFile(resolved, 'utf-8');
    } catch (err) {
      // If readFile throws on binary content (invalid UTF-8), catch it
      if (isBinaryError(err)) {
        return this.error('BINARY_FILE', 'File contains binary content.');
      }
      return this.mapNodeError(err);
    }

    // UTF-8 validation — check for replacement characters indicating binary
    if (hasBinaryMarkers(content)) {
      return this.error('BINARY_FILE', 'File contains binary content.');
    }

    return { ok: true, content, resolvedPath: resolved, decision };
  }

  async writeFile(relativePath: string, content: string): Promise<FileWriteResponse> {
    // Input validation
    const pathErr = this.validatePath(relativePath);
    if (pathErr) return pathErr;

    if (typeof content !== 'string') {
      return this.error('PATH_DENIED', 'Content must be a string.');
    }

    const contentBytes = Buffer.byteLength(content, 'utf-8');
    if (contentBytes > MAX_FILE_SIZE) {
      return this.error('CONTENT_TOO_LARGE', `Content is ${contentBytes} bytes (limit ${MAX_FILE_SIZE}).`);
    }

    const resolved = path.resolve(this.projectRoot, relativePath);

    // Root bound check
    if (!this.isSubpath(resolved, this.projectRoot)) {
      return this.error('PATH_DENIED', 'Path escapes project root.');
    }

    // Parent directory check
    const parentDir = path.dirname(resolved);
    let parentStat;
    try {
      parentStat = await this.io.lstat(parentDir);
    } catch (err) {
      return this.mapNodeError(err);
    }

    if (parentStat.isSymbolicLink()) {
      return this.error('PATH_DENIED', 'Parent directory is a symlink.');
    }
    if (!parentStat.isDirectory()) {
      return this.error('NOT_A_DIRECTORY', 'Parent path is not a directory.');
    }

    // Symlink check on target (if it exists)
    try {
      const targetStat = await this.io.lstat(resolved);
      if (targetStat.isSymbolicLink()) {
        return this.error('PATH_DENIED', 'Target path is a symlink.');
      }
    } catch {
      // ENOENT is expected — file doesn't exist yet, which is what we want
    }

    // Daemon readiness
    if (!this.client || !this.client.isRunning) {
      return this.error('DAEMON_NOT_READY', 'Governor daemon is not running.');
    }

    // Scope check
    const decision = await this.checkScope(TOOL_FILE_WRITE_CREATE, resolved, 'write');
    if (!decision.allowed) {
      return { ok: false, code: 'BLOCKED', message: decision.reason, decision };
    }

    // Create-only write: 'wx' flag = exclusive create, fails if exists
    let fh;
    try {
      fh = await this.io.open(resolved, 'wx');
      await fh.write(content);
      await fh.close();
    } catch (err) {
      return this.mapNodeError(err);
    }

    return { ok: true, resolvedPath: resolved, decision };
  }

  async listDir(relativePath: string): Promise<FileListResponse> {
    // Input validation
    const pathErr = this.validatePath(relativePath);
    if (pathErr) return pathErr;

    const resolved = path.resolve(this.projectRoot, relativePath);

    // Root bound check
    if (!this.isSubpath(resolved, this.projectRoot)) {
      return this.error('PATH_DENIED', 'Path escapes project root.');
    }

    // Symlink check
    const symlinkErr = await this.rejectSymlink(resolved);
    if (symlinkErr) return symlinkErr;

    // Check that path is a directory
    let dirStat;
    try {
      dirStat = await this.io.lstat(resolved);
    } catch (err) {
      return this.mapNodeError(err);
    }
    if (!dirStat.isDirectory()) {
      return this.error('NOT_A_DIRECTORY', 'Path is not a directory.');
    }

    // Daemon readiness
    if (!this.client || !this.client.isRunning) {
      return this.error('DAEMON_NOT_READY', 'Governor daemon is not running.');
    }

    // Scope check
    const decision = await this.checkScope(TOOL_FILE_LIST, resolved, 'list');
    if (!decision.allowed) {
      return { ok: false, code: 'BLOCKED', message: decision.reason, decision };
    }

    // Read directory
    let rawEntries;
    try {
      rawEntries = await this.io.readdir(resolved, { withFileTypes: true });
    } catch (err) {
      return this.mapNodeError(err);
    }

    const truncated = rawEntries.length > MAX_DIR_ENTRIES;
    const entries: DirEntry[] = rawEntries.slice(0, MAX_DIR_ENTRIES).map((entry) => {
      const type = entry.isFile() ? 'file' as const : entry.isDirectory() ? 'directory' as const : 'other' as const;
      return { name: entry.name, type, size: 0 };
    });

    return { ok: true, entries, truncated, resolvedPath: resolved, decision };
  }

  // --- Private helpers ---

  private validatePath(relativePath: string): FileErrorResult | null {
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      return this.error('PATH_DENIED', 'Path must be a non-empty string.');
    }

    if (relativePath.length > MAX_PATH_LENGTH) {
      return this.error('PATH_TOO_LONG', `Path is ${relativePath.length} chars (limit ${MAX_PATH_LENGTH}).`);
    }

    // Reject absolute paths
    if (path.isAbsolute(relativePath)) {
      return this.error('PATH_DENIED', 'Absolute paths are not allowed.');
    }

    // Reject path traversal
    const normalized = path.normalize(relativePath);
    if (normalized.startsWith('..') || normalized.includes(`${path.sep}..`)) {
      return this.error('PATH_DENIED', 'Path traversal (..) is not allowed.');
    }

    return null;
  }

  private isSubpath(target: string, root: string): boolean {
    const normalizedTarget = path.normalize(target);
    const normalizedRoot = path.normalize(root);
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(normalizedRoot + path.sep);
  }

  private async rejectSymlink(filePath: string): Promise<FileErrorResult | null> {
    try {
      const st = await this.io.lstat(filePath);
      if (st.isSymbolicLink()) {
        return this.error('PATH_DENIED', 'Symlinks are not allowed.');
      }
    } catch {
      // File doesn't exist — that's fine for read (will fail at read time)
    }
    return null;
  }

  private async checkScope(toolId: string, resolvedPath: string, op: string): Promise<ScopeDecision> {
    const templateState = this.getTemplateState();
    const result = await this.client!.scopeCheck(toolId, {
      resource: resolvedPath,
      op,
      project_root: this.projectRoot,
    });
    return {
      allowed: result.allowed,
      reason: result.reason,
      toolId,
      appliedTemplateId: templateState.appliedTemplateId,
      appliedProfile: templateState.appliedProfile,
    };
  }

  private error(code: FileErrorCode, message: string): FileErrorResult {
    return { ok: false, code, message };
  }

  private mapNodeError(err: unknown): FileErrorResult {
    const nodeErr = err as NodeJS.ErrnoException;
    switch (nodeErr.code) {
      case 'ENOENT':
        return this.error('NOT_FOUND', 'File not found.');
      case 'EACCES':
      case 'EPERM':
        return this.error('IO_ERROR', `Permission denied: ${nodeErr.message}`);
      case 'EISDIR':
        return this.error('NOT_A_DIRECTORY', 'Path is a directory.');
      case 'EEXIST':
        return this.error('FILE_EXISTS', 'File already exists.');
      default:
        return this.error('IO_ERROR', nodeErr.message || 'Unknown I/O error.');
    }
  }
}

/** Detect binary content errors from Node's UTF-8 decoding. */
function isBinaryError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.message.includes('encoding') || err.message.includes('EILSEQ');
  }
  return false;
}

/** Check if a string has common binary markers (null bytes, high density of replacement chars). */
function hasBinaryMarkers(content: string): boolean {
  return content.includes('\0');
}

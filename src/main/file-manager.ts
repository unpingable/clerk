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
import crypto from 'node:crypto';
import type {
  FileReadResponse,
  FileWriteResponse,
  FileOverwriteResponse,
  FilePatchResponse,
  FileListResponse,
  FileMkdirResponse,
  FileCopyResponse,
  FileMoveResponse,
  FileDeleteResponse,
  FileFindResponse,
  FileGrepResponse,
  FileFindEntry,
  FileGrepMatch,
  FileErrorCode,
  FileErrorResult,
  ScopeDecision,
  DirEntry,
  AskGrantToken,
} from '../shared/types.js';
import type { ActivityKind } from '../shared/activity-types.js';
import type { ActivityRecorder } from './activity-manager.js';
import { activitySummary } from './activity-summary.js';
import { applyUnifiedPatch, MAX_PATCH_SIZE } from './patch.js';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_PATH_LENGTH = 1024;
export const TOOL_FILE_READ = 'file.read';
export const TOOL_FILE_WRITE_CREATE = 'file.write.create';
export const TOOL_FILE_WRITE_OVERWRITE = 'file.write.overwrite';
export const TOOL_FILE_LIST = 'file.list';
export const TOOL_FILE_MKDIR = 'file.mkdir';
export const TOOL_FILE_COPY = 'file.copy';
export const TOOL_FILE_MOVE = 'file.move';
export const TOOL_FILE_DELETE = 'file.delete';
export const TOOL_FILE_PATCH = 'file.patch';
export const TOOL_FILE_FIND = 'file.find';
export const TOOL_FILE_GREP = 'file.grep';
export const MAX_DIR_ENTRIES = 200;
export const MAX_FIND_RESULTS = 200;
export const MAX_GREP_MATCHES = 200;
export const MAX_GREP_FILES = 50;
const GREP_PREVIEW_LENGTH = 200;

/** Directories excluded from find/grep by default. */
const SEARCH_EXCLUDED_DIRS = new Set(['.clerk', 'node_modules', '.git', '.svn', '.hg']);

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
  readFileRaw(filePath: string): Promise<Buffer>;
  readFile(filePath: string, encoding: 'utf-8'): Promise<string>;
  open(filePath: string, flags: string): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
  writeFile(filePath: string, content: string): Promise<void>;
  rename(src: string, dst: string): Promise<void>;
  realpath(filePath: string): Promise<string>;
  access(filePath: string): Promise<void>;
  readdir(dirPath: string, options: { withFileTypes: true }): Promise<Array<{ name: string; isFile(): boolean; isDirectory(): boolean }>>;
  mkdir(dirPath: string): Promise<void>;
  copyFile(src: string, dest: string, flags?: number): Promise<void>;
}

// ---------------------------------------------------------------------------
// FileManager
// ---------------------------------------------------------------------------

/** Options for individual file operations. */
export interface FileOpContext {
  correlationId?: string;
  streamId?: string;
  askGrantToken?: AskGrantToken;
}

export class FileManager {
  private client: FileManagerClient | null;
  private projectRoot: string;
  private getTemplateState: () => FileManagerTemplateState;
  private io: FileManagerIO;
  private recorder: ActivityRecorder | null;

  constructor(
    client: FileManagerClient | null,
    projectRoot: string,
    getTemplateState: () => FileManagerTemplateState,
    io: FileManagerIO,
    recorder: ActivityRecorder | null = null,
  ) {
    this.client = client;
    this.projectRoot = projectRoot;
    this.getTemplateState = getTemplateState;
    this.io = io;
    this.recorder = recorder;
  }

  async readFile(relativePath: string, ctx?: FileOpContext): Promise<FileReadResponse> {
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
      this.recordActivity('file_read', TOOL_FILE_READ, relativePath, false, decision.reason, 'BLOCKED', ctx);
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

    const contentHash = crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
    this.recordActivity('file_read', TOOL_FILE_READ, relativePath, true, undefined, undefined, ctx);
    return { ok: true, content, contentHash, truncated: false, hashCoversFullFile: true, resolvedPath: resolved, decision };
  }

  async writeFile(relativePath: string, content: string, ctx?: FileOpContext): Promise<FileWriteResponse> {
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
      this.recordActivity('file_write_create', TOOL_FILE_WRITE_CREATE, relativePath, false, decision.reason, 'BLOCKED', ctx);
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

    this.recordActivity('file_write_create', TOOL_FILE_WRITE_CREATE, relativePath, true, undefined, undefined, ctx);
    return { ok: true, resolvedPath: resolved, decision };
  }

  async overwriteFile(relativePath: string, content: string, expectedHash: string, ctx?: FileOpContext): Promise<FileOverwriteResponse> {
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

    // Symlink check on target
    const symlinkErr = await this.rejectSymlink(resolved);
    if (symlinkErr) return symlinkErr;

    // File must exist for overwrite
    let existingContent: string;
    try {
      existingContent = await this.io.readFile(resolved, 'utf-8');
    } catch (err) {
      return this.mapNodeError(err);
    }

    // Hash check
    const actualHash = crypto.createHash('sha256').update(existingContent, 'utf-8').digest('hex');
    if (actualHash !== expectedHash) {
      this.recordActivity('file_write_overwrite', TOOL_FILE_WRITE_OVERWRITE, relativePath, false, 'Hash mismatch — file modified since last read.', 'HASH_MISMATCH', ctx);
      return {
        ok: false,
        code: 'HASH_MISMATCH',
        message: `File has been modified since last read. Expected hash ${expectedHash.slice(0, 8)}..., got ${actualHash.slice(0, 8)}...`,
      };
    }

    // Daemon readiness
    if (!this.client || !this.client.isRunning) {
      return this.error('DAEMON_NOT_READY', 'Governor daemon is not running.');
    }

    // Check for ask grant token — skip scope check if valid
    if (ctx?.askGrantToken) {
      const token = ctx.askGrantToken;
      if (
        token.toolId !== TOOL_FILE_WRITE_OVERWRITE ||
        token.path !== relativePath ||
        token.correlationId !== ctx.correlationId
      ) {
        return this.error('BLOCKED', 'Ask grant token does not match this operation.');
      }
      if (token.usedAt !== null) {
        return this.error('BLOCKED', 'Ask grant token has already been used.');
      }
      // Token consumed after write succeeds (below) — not here,
      // so the user can retry if the write fails (e.g. disk full).
    } else {
      // Scope check
      const decision = await this.checkScope(TOOL_FILE_WRITE_OVERWRITE, resolved, 'write');
      if (!decision.allowed) {
        const code = decision.askAvailable ? 'ASK_REQUIRED' : 'BLOCKED';
        this.recordActivity('file_write_overwrite', TOOL_FILE_WRITE_OVERWRITE, relativePath, false, decision.reason, code, ctx);
        return { ok: false, code, message: decision.reason, decision };
      }
    }

    // Atomic overwrite: temp+rename
    const tmpPath = `${resolved}.clerk-tmp-${crypto.randomUUID()}`;
    try {
      await this.io.writeFile(tmpPath, content);
      await this.io.rename(tmpPath, resolved);
    } catch (err) {
      return this.mapNodeError(err);
    }

    // Consume grant token only after write succeeds — allows retry on failure
    if (ctx?.askGrantToken) {
      ctx.askGrantToken.usedAt = new Date().toISOString();
    }

    const decision: ScopeDecision = {
      allowed: true,
      reason: 'allowed by policy',
      toolId: TOOL_FILE_WRITE_OVERWRITE,
      appliedTemplateId: this.getTemplateState().appliedTemplateId,
      appliedProfile: this.getTemplateState().appliedProfile,
    };

    this.recordActivity('file_write_overwrite', TOOL_FILE_WRITE_OVERWRITE, relativePath, true, undefined, undefined, ctx);
    return { ok: true, resolvedPath: resolved, decision };
  }

  async patchFile(relativePath: string, patch: string, expectedHash: string, ctx?: FileOpContext): Promise<FilePatchResponse> {
    // 1. validatePath → resolve → root bound → symlink reject
    const pathErr = this.validatePath(relativePath);
    if (pathErr) return pathErr;

    const resolved = path.resolve(this.projectRoot, relativePath);

    if (!this.isSubpath(resolved, this.projectRoot)) {
      return this.error('PATH_DENIED', 'Path escapes project root.');
    }

    const symlinkErr = await this.rejectSymlink(resolved);
    if (symlinkErr) return symlinkErr;

    // 2. Read file as Buffer
    let rawBuffer: Buffer;
    try {
      rawBuffer = await this.io.readFileRaw(resolved);
    } catch (err) {
      return this.mapNodeError(err);
    }

    // 3. UTF-8 roundtrip verification
    const decoded = rawBuffer.toString('utf-8');
    const reEncoded = Buffer.from(decoded, 'utf-8');
    if (!rawBuffer.equals(reEncoded)) {
      return this.error('BINARY_FILE', 'File is not clean UTF-8 text.');
    }

    // 4. Hash check (SHA-256 of raw bytes)
    const actualHash = crypto.createHash('sha256').update(rawBuffer).digest('hex');
    if (actualHash !== expectedHash) {
      this.recordActivity('file_patch', TOOL_FILE_PATCH, relativePath, false, 'Hash mismatch — file modified since last read.', 'HASH_MISMATCH', ctx);
      return {
        ok: false,
        code: 'HASH_MISMATCH',
        message: `File has been modified since last read. Expected hash ${expectedHash.slice(0, 8)}..., got ${actualHash.slice(0, 8)}...`,
      };
    }

    // 5. Daemon readiness + ASK/grant/scope check
    if (!this.client || !this.client.isRunning) {
      return this.error('DAEMON_NOT_READY', 'Governor daemon is not running.');
    }

    if (ctx?.askGrantToken) {
      const token = ctx.askGrantToken;
      if (
        token.toolId !== TOOL_FILE_PATCH ||
        token.path !== relativePath ||
        token.correlationId !== ctx.correlationId
      ) {
        return this.error('BLOCKED', 'Ask grant token does not match this operation.');
      }
      if (token.usedAt !== null) {
        return this.error('BLOCKED', 'Ask grant token has already been used.');
      }
    } else {
      const decision = await this.checkScope(TOOL_FILE_PATCH, resolved, 'patch');
      if (!decision.allowed) {
        const code = decision.askAvailable ? 'ASK_REQUIRED' : 'BLOCKED';
        this.recordActivity('file_patch', TOOL_FILE_PATCH, relativePath, false, decision.reason, code, ctx);
        return { ok: false, code, message: decision.reason, decision };
      }
    }

    // 6. Validate patch caps (no file content in errors)
    const patchBytes = Buffer.byteLength(patch, 'utf-8');
    if (patchBytes > MAX_PATCH_SIZE) {
      return this.error('INVALID_PATCH', `Patch exceeds maximum size (${MAX_PATCH_SIZE} bytes).`);
    }

    // 7. Apply patch — safe to include content excerpts (user is authorized)
    //    Pass target basename so ---/+++ headers can be validated against it.
    const targetBasename = path.basename(relativePath);
    const patchResult = applyUnifiedPatch(decoded, patch, targetBasename);
    if (!patchResult.ok) {
      const errorCode = patchResult.kind === 'invalid' ? 'INVALID_PATCH' : 'PATCH_FAILED';
      this.recordActivity('file_patch', TOOL_FILE_PATCH, relativePath, false, patchResult.reason, errorCode, ctx);
      return { ok: false, code: errorCode, message: patchResult.reason };
    }

    // 8. Atomic temp+rename write
    const tmpPath = `${resolved}.clerk-tmp-${crypto.randomUUID()}`;
    try {
      await this.io.writeFile(tmpPath, patchResult.result);
      await this.io.rename(tmpPath, resolved);
    } catch (err) {
      return this.mapNodeError(err);
    }

    // 9. Consume grant token after success
    if (ctx?.askGrantToken) {
      ctx.askGrantToken.usedAt = new Date().toISOString();
    }

    // 10. Compute newHash of written content
    const newHash = crypto.createHash('sha256').update(patchResult.result, 'utf-8').digest('hex');

    // 11. Record activity
    const decision: ScopeDecision = {
      allowed: true,
      reason: 'allowed by policy',
      toolId: TOOL_FILE_PATCH,
      appliedTemplateId: this.getTemplateState().appliedTemplateId,
      appliedProfile: this.getTemplateState().appliedProfile,
    };

    this.recordActivity('file_patch', TOOL_FILE_PATCH, relativePath, true, undefined, undefined, ctx, {
      appliedHunks: patchResult.appliedHunks,
    });

    // 12. Return result
    return { ok: true, newHash, appliedHunks: patchResult.appliedHunks, resolvedPath: resolved, decision };
  }

  async listDir(relativePath: string, ctx?: FileOpContext): Promise<FileListResponse> {
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
      this.recordActivity('file_list', TOOL_FILE_LIST, relativePath, false, decision.reason, 'BLOCKED', ctx);
      return { ok: false, code: 'BLOCKED', message: decision.reason, decision };
    }

    // Read directory
    let rawEntries;
    try {
      rawEntries = await this.io.readdir(resolved, { withFileTypes: true });
    } catch (err) {
      return this.mapNodeError(err);
    }

    // Filter out .clerk internal directory to prevent model self-referencing
    const filtered = rawEntries.filter(e => e.name !== '.clerk');
    const truncated = filtered.length > MAX_DIR_ENTRIES;
    const entries: DirEntry[] = filtered.slice(0, MAX_DIR_ENTRIES).map((entry) => {
      const type = entry.isFile() ? 'file' as const : entry.isDirectory() ? 'directory' as const : 'other' as const;
      return { name: entry.name, type, size: 0 };
    });

    this.recordActivity('file_list', TOOL_FILE_LIST, relativePath, true, undefined, undefined, ctx);
    return { ok: true, entries, truncated, resolvedPath: resolved, decision };
  }

  async mkdir(relativePath: string, ctx?: FileOpContext): Promise<FileMkdirResponse> {
    const pathErr = this.validatePath(relativePath);
    if (pathErr) return pathErr;

    const resolved = path.resolve(this.projectRoot, relativePath);

    if (!this.isSubpath(resolved, this.projectRoot)) {
      return this.error('PATH_DENIED', 'Path escapes project root.');
    }

    // Parent must exist, be a dir, not a symlink
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

    // Target must NOT exist
    try {
      await this.io.lstat(resolved);
      return this.error('FILE_EXISTS', 'Directory already exists.');
    } catch {
      // ENOENT expected
    }

    if (!this.client || !this.client.isRunning) {
      return this.error('DAEMON_NOT_READY', 'Governor daemon is not running.');
    }

    const decision = await this.checkScope(TOOL_FILE_MKDIR, resolved, 'mkdir');
    if (!decision.allowed) {
      this.recordActivity('file_mkdir', TOOL_FILE_MKDIR, relativePath, false, decision.reason, 'BLOCKED', ctx);
      return { ok: false, code: 'BLOCKED', message: decision.reason, decision };
    }

    try {
      await this.io.mkdir(resolved);
    } catch (err) {
      return this.mapNodeError(err);
    }

    this.recordActivity('file_mkdir', TOOL_FILE_MKDIR, relativePath, true, undefined, undefined, ctx);
    return { ok: true, resolvedPath: resolved, decision };
  }

  async copyFile(srcRelative: string, destRelative: string, ctx?: FileOpContext): Promise<FileCopyResponse> {
    const srcErr = this.validatePath(srcRelative);
    if (srcErr) return srcErr;
    const destErr = this.validatePath(destRelative);
    if (destErr) return destErr;

    const resolvedSrc = path.resolve(this.projectRoot, srcRelative);
    const resolvedDest = path.resolve(this.projectRoot, destRelative);

    if (!this.isSubpath(resolvedSrc, this.projectRoot)) {
      return this.error('PATH_DENIED', 'Source path escapes project root.');
    }
    if (!this.isSubpath(resolvedDest, this.projectRoot)) {
      return this.error('PATH_DENIED', 'Destination path escapes project root.');
    }

    // Source must exist, be file, not symlink
    let srcStat;
    try {
      srcStat = await this.io.lstat(resolvedSrc);
    } catch (err) {
      return this.mapNodeError(err);
    }
    if (srcStat.isSymbolicLink()) {
      return this.error('PATH_DENIED', 'Source is a symlink.');
    }
    if (srcStat.isDirectory()) {
      return this.error('NOT_A_DIRECTORY', 'Cannot copy directories. Copy individual files instead.');
    }

    // Source size check
    if (srcStat.size > MAX_FILE_SIZE) {
      return this.error('CONTENT_TOO_LARGE', `Source file is ${srcStat.size} bytes (limit ${MAX_FILE_SIZE}).`);
    }

    // Source parent symlink check
    const srcParent = path.dirname(resolvedSrc);
    try {
      const srcParentStat = await this.io.lstat(srcParent);
      if (srcParentStat.isSymbolicLink()) {
        return this.error('PATH_DENIED', 'Source parent directory is a symlink.');
      }
    } catch {
      // unlikely — source exists so parent should too
    }

    // Dest parent must exist, be dir, not symlink
    const destParent = path.dirname(resolvedDest);
    let destParentStat;
    try {
      destParentStat = await this.io.lstat(destParent);
    } catch (err) {
      return this.mapNodeError(err);
    }
    if (destParentStat.isSymbolicLink()) {
      return this.error('PATH_DENIED', 'Destination parent directory is a symlink.');
    }
    if (!destParentStat.isDirectory()) {
      return this.error('NOT_A_DIRECTORY', 'Destination parent is not a directory.');
    }

    // Dest must NOT exist
    try {
      await this.io.lstat(resolvedDest);
      return this.error('DEST_EXISTS', 'Destination already exists.');
    } catch {
      // ENOENT expected
    }

    if (!this.client || !this.client.isRunning) {
      return this.error('DAEMON_NOT_READY', 'Governor daemon is not running.');
    }

    const decision = await this.checkScopeWithAxes(TOOL_FILE_COPY, 'copy', resolvedSrc, {
      from: resolvedSrc,
      to: resolvedDest,
    });
    if (!decision.allowed) {
      this.recordActivity('file_copy', TOOL_FILE_COPY, srcRelative, false, decision.reason, 'BLOCKED', ctx);
      return { ok: false, code: 'BLOCKED', message: decision.reason, decision };
    }

    try {
      // COPYFILE_EXCL = 1
      await this.io.copyFile(resolvedSrc, resolvedDest, 1);
    } catch (err) {
      return this.mapNodeError(err);
    }

    const destName = path.basename(destRelative);
    this.recordActivity('file_copy', TOOL_FILE_COPY, srcRelative, true, undefined, undefined, ctx, { destName });
    return { ok: true, resolvedSrc, resolvedDest, decision };
  }

  async moveFile(srcRelative: string, destRelative: string, ctx?: FileOpContext): Promise<FileMoveResponse> {
    const srcErr = this.validatePath(srcRelative);
    if (srcErr) return srcErr;
    const destErr = this.validatePath(destRelative);
    if (destErr) return destErr;

    const resolvedSrc = path.resolve(this.projectRoot, srcRelative);
    const resolvedDest = path.resolve(this.projectRoot, destRelative);

    if (!this.isSubpath(resolvedSrc, this.projectRoot)) {
      return this.error('PATH_DENIED', 'Source path escapes project root.');
    }
    if (!this.isSubpath(resolvedDest, this.projectRoot)) {
      return this.error('PATH_DENIED', 'Destination path escapes project root.');
    }

    // Source must exist, not be symlink
    let srcStat;
    try {
      srcStat = await this.io.lstat(resolvedSrc);
    } catch (err) {
      return this.mapNodeError(err);
    }
    if (srcStat.isSymbolicLink()) {
      return this.error('PATH_DENIED', 'Source is a symlink.');
    }

    // Source parent symlink check
    const srcParent = path.dirname(resolvedSrc);
    try {
      const srcParentStat = await this.io.lstat(srcParent);
      if (srcParentStat.isSymbolicLink()) {
        return this.error('PATH_DENIED', 'Source parent directory is a symlink.');
      }
    } catch {
      // unlikely
    }

    // Dest parent must exist, be dir, not symlink
    const destParent = path.dirname(resolvedDest);
    let destParentStat;
    try {
      destParentStat = await this.io.lstat(destParent);
    } catch (err) {
      return this.mapNodeError(err);
    }
    if (destParentStat.isSymbolicLink()) {
      return this.error('PATH_DENIED', 'Destination parent directory is a symlink.');
    }
    if (!destParentStat.isDirectory()) {
      return this.error('NOT_A_DIRECTORY', 'Destination parent is not a directory.');
    }

    // Dest must NOT exist
    try {
      await this.io.lstat(resolvedDest);
      return this.error('DEST_EXISTS', 'Destination already exists.');
    } catch {
      // ENOENT expected
    }

    if (!this.client || !this.client.isRunning) {
      return this.error('DAEMON_NOT_READY', 'Governor daemon is not running.');
    }

    // Check for ask grant token — skip scope check if valid
    if (ctx?.askGrantToken) {
      const token = ctx.askGrantToken;
      if (
        token.toolId !== TOOL_FILE_MOVE ||
        token.path !== srcRelative ||
        token.toPath !== destRelative ||
        token.correlationId !== ctx.correlationId
      ) {
        return this.error('BLOCKED', 'Ask grant token does not match this operation.');
      }
      if (token.usedAt !== null) {
        return this.error('BLOCKED', 'Ask grant token has already been used.');
      }
    } else {
      const decision = await this.checkScopeWithAxes(TOOL_FILE_MOVE, 'move', resolvedSrc, {
        from: resolvedSrc,
        to: resolvedDest,
      });
      if (!decision.allowed) {
        const code = decision.askAvailable ? 'ASK_REQUIRED' : 'BLOCKED';
        this.recordActivity('file_move', TOOL_FILE_MOVE, srcRelative, false, decision.reason, code, ctx);
        return { ok: false, code, message: decision.reason, decision };
      }
    }

    try {
      await this.io.rename(resolvedSrc, resolvedDest);
    } catch (err) {
      return this.mapNodeError(err);
    }

    if (ctx?.askGrantToken) {
      ctx.askGrantToken.usedAt = new Date().toISOString();
    }

    const decision: ScopeDecision = {
      allowed: true,
      reason: 'allowed by policy',
      toolId: TOOL_FILE_MOVE,
      appliedTemplateId: this.getTemplateState().appliedTemplateId,
      appliedProfile: this.getTemplateState().appliedProfile,
    };

    const destName = path.basename(destRelative);
    this.recordActivity('file_move', TOOL_FILE_MOVE, srcRelative, true, undefined, undefined, ctx, { destName });
    return { ok: true, resolvedSrc, resolvedDest, decision };
  }

  async deleteFile(relativePath: string, ctx?: FileOpContext): Promise<FileDeleteResponse> {
    const pathErr = this.validatePath(relativePath);
    if (pathErr) return pathErr;

    const resolved = path.resolve(this.projectRoot, relativePath);

    if (!this.isSubpath(resolved, this.projectRoot)) {
      return this.error('PATH_DENIED', 'Path escapes project root.');
    }

    // Symlink reject
    const symlinkErr = await this.rejectSymlink(resolved);
    if (symlinkErr) return symlinkErr;

    // Must exist and be a file
    let fileStat;
    try {
      fileStat = await this.io.lstat(resolved);
    } catch (err) {
      return this.mapNodeError(err);
    }
    if (fileStat.isDirectory()) {
      return this.error('NOT_A_DIRECTORY', 'Cannot delete directories directly.');
    }

    if (!this.client || !this.client.isRunning) {
      return this.error('DAEMON_NOT_READY', 'Governor daemon is not running.');
    }

    // Check for ask grant token — skip scope check if valid
    if (ctx?.askGrantToken) {
      const token = ctx.askGrantToken;
      if (
        token.toolId !== TOOL_FILE_DELETE ||
        token.path !== relativePath ||
        token.correlationId !== ctx.correlationId
      ) {
        return this.error('BLOCKED', 'Ask grant token does not match this operation.');
      }
      if (token.usedAt !== null) {
        return this.error('BLOCKED', 'Ask grant token has already been used.');
      }
    } else {
      const decision = await this.checkScope(TOOL_FILE_DELETE, resolved, 'delete');
      if (!decision.allowed) {
        const code = decision.askAvailable ? 'ASK_REQUIRED' : 'BLOCKED';
        this.recordActivity('file_delete', TOOL_FILE_DELETE, relativePath, false, decision.reason, code, ctx);
        return { ok: false, code, message: decision.reason, decision };
      }
    }

    // Ensure .clerk/trash/ exists
    const clerkDir = path.join(this.projectRoot, '.clerk');
    const trashDir = path.join(clerkDir, 'trash');
    try { await this.io.mkdir(clerkDir); } catch { /* EEXIST ok */ }
    try { await this.io.mkdir(trashDir); } catch { /* EEXIST ok */ }

    const basename = path.basename(resolved);
    const trashName = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${basename}`;
    const trashPath = path.join(trashDir, trashName);

    try {
      await this.io.rename(resolved, trashPath);
    } catch (err) {
      return this.mapNodeError(err);
    }

    if (ctx?.askGrantToken) {
      ctx.askGrantToken.usedAt = new Date().toISOString();
    }

    const decision: ScopeDecision = {
      allowed: true,
      reason: 'allowed by policy',
      toolId: TOOL_FILE_DELETE,
      appliedTemplateId: this.getTemplateState().appliedTemplateId,
      appliedProfile: this.getTemplateState().appliedProfile,
    };

    this.recordActivity('file_delete', TOOL_FILE_DELETE, relativePath, true, undefined, undefined, ctx, {
      originalPath: relativePath,
      trashPath,
    });
    return { ok: true, resolvedPath: resolved, trashPath, decision };
  }

  async fileFind(basePath: string, pattern?: string, ctx?: FileOpContext): Promise<FileFindResponse> {
    const pathErr = this.validatePath(basePath);
    if (pathErr) return pathErr;

    const resolvedBase = path.resolve(this.projectRoot, basePath);

    if (!this.isSubpath(resolvedBase, this.projectRoot)) {
      return this.error('PATH_DENIED', 'Path escapes project root.');
    }

    // Base must exist and be a directory
    let baseStat;
    try {
      baseStat = await this.io.lstat(resolvedBase);
    } catch (err) {
      return this.mapNodeError(err);
    }
    if (baseStat.isSymbolicLink()) {
      return this.error('PATH_DENIED', 'Symlinks are not allowed.');
    }
    if (!baseStat.isDirectory()) {
      return this.error('NOT_A_DIRECTORY', 'Path is not a directory.');
    }

    if (!this.client || !this.client.isRunning) {
      return this.error('DAEMON_NOT_READY', 'Governor daemon is not running.');
    }

    const decision = await this.checkScope(TOOL_FILE_FIND, resolvedBase, 'find');
    if (!decision.allowed) {
      this.recordActivity('file_find', TOOL_FILE_FIND, basePath, false, decision.reason, 'BLOCKED', ctx);
      return { ok: false, code: 'BLOCKED', message: decision.reason, decision };
    }

    // Walk directory tree, collecting matches
    const entries: FileFindEntry[] = [];
    let truncated = false;

    const walk = async (dir: string) => {
      if (entries.length >= MAX_FIND_RESULTS) {
        truncated = true;
        return;
      }

      let items;
      try {
        items = await this.io.readdir(dir, { withFileTypes: true });
      } catch {
        return; // skip unreadable dirs
      }

      for (const item of items) {
        if (entries.length >= MAX_FIND_RESULTS) {
          truncated = true;
          return;
        }

        if (SEARCH_EXCLUDED_DIRS.has(item.name)) continue;

        const relPath = path.relative(this.projectRoot, path.join(dir, item.name));
        const isDir = item.isDirectory();
        const isFile = item.isFile();

        if (pattern) {
          if (matchGlob(item.name, pattern)) {
            entries.push({ path: relPath, type: isDir ? 'directory' : 'file' });
          }
        } else {
          if (isFile || isDir) {
            entries.push({ path: relPath, type: isDir ? 'directory' : 'file' });
          }
        }

        if (isDir) {
          await walk(path.join(dir, item.name));
        }
      }
    };

    await walk(resolvedBase);

    this.recordActivity('file_find', TOOL_FILE_FIND, basePath, true, undefined, undefined, ctx, {
      count: entries.length,
      pattern,
    });
    return { ok: true, entries, truncated, decision };
  }

  async fileGrep(query: string, basePath: string = '.', ctx?: FileOpContext): Promise<FileGrepResponse> {
    if (typeof query !== 'string' || query.length === 0) {
      return this.error('PATH_DENIED', 'Query must be a non-empty string.');
    }
    if (query.length > 500) {
      return this.error('PATH_DENIED', 'Query is too long (max 500 characters).');
    }

    const pathErr = this.validatePath(basePath);
    if (pathErr) return pathErr;

    const resolvedBase = path.resolve(this.projectRoot, basePath);

    if (!this.isSubpath(resolvedBase, this.projectRoot)) {
      return this.error('PATH_DENIED', 'Path escapes project root.');
    }

    let baseStat;
    try {
      baseStat = await this.io.lstat(resolvedBase);
    } catch (err) {
      return this.mapNodeError(err);
    }
    if (baseStat.isSymbolicLink()) {
      return this.error('PATH_DENIED', 'Symlinks are not allowed.');
    }
    if (!baseStat.isDirectory()) {
      return this.error('NOT_A_DIRECTORY', 'Path is not a directory.');
    }

    if (!this.client || !this.client.isRunning) {
      return this.error('DAEMON_NOT_READY', 'Governor daemon is not running.');
    }

    const decision = await this.checkScope(TOOL_FILE_GREP, resolvedBase, 'grep');
    if (!decision.allowed) {
      this.recordActivity('file_grep', TOOL_FILE_GREP, basePath, false, decision.reason, 'BLOCKED', ctx);
      return { ok: false, code: 'BLOCKED', message: decision.reason, decision };
    }

    const matches: FileGrepMatch[] = [];
    let fileCount = 0;
    let truncated = false;
    const queryLower = query.toLowerCase();

    const walk = async (dir: string) => {
      if (matches.length >= MAX_GREP_MATCHES || fileCount >= MAX_GREP_FILES) {
        truncated = true;
        return;
      }

      let items;
      try {
        items = await this.io.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const item of items) {
        if (matches.length >= MAX_GREP_MATCHES || fileCount >= MAX_GREP_FILES) {
          truncated = true;
          return;
        }

        if (SEARCH_EXCLUDED_DIRS.has(item.name)) continue;

        const fullPath = path.join(dir, item.name);

        if (item.isDirectory()) {
          await walk(fullPath);
        } else if (item.isFile()) {
          // Size cap: skip files > 1MB for grep
          let stat;
          try {
            stat = await this.io.lstat(fullPath);
          } catch {
            continue;
          }
          if (stat.isSymbolicLink() || stat.size > 1024 * 1024) continue;

          let content: string;
          try {
            content = await this.io.readFile(fullPath, 'utf-8');
          } catch {
            continue; // skip binary / unreadable files
          }

          if (content.includes('\0')) continue; // skip binary

          const lines = content.split('\n');
          let foundInFile = false;

          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= MAX_GREP_MATCHES) {
              truncated = true;
              break;
            }

            if (lines[i].toLowerCase().includes(queryLower)) {
              if (!foundInFile) {
                foundInFile = true;
                fileCount++;
              }
              const relPath = path.relative(this.projectRoot, fullPath);
              const preview = lines[i].length > GREP_PREVIEW_LENGTH
                ? lines[i].slice(0, GREP_PREVIEW_LENGTH) + '...'
                : lines[i];
              matches.push({ file: relPath, line: i + 1, preview });
            }
          }
        }
      }
    };

    await walk(resolvedBase);

    this.recordActivity('file_grep', TOOL_FILE_GREP, basePath, true, undefined, undefined, ctx, {
      query,
      matchCount: matches.length,
      fileCount,
    });
    return { ok: true, matches, matchCount: matches.length, fileCount, truncated, decision };
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

    // Reject .clerk/ internal directory
    if (normalized === '.clerk' || normalized.startsWith(`.clerk${path.sep}`)) {
      return this.error('PATH_DENIED', 'The .clerk directory is reserved for internal use.');
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
    const askAvailable = !result.allowed && (result.reason === 'ASK_REQUIRED' || (result as Record<string, unknown>)['ask_gate_available'] === true);
    return {
      allowed: result.allowed,
      reason: result.reason,
      toolId,
      appliedTemplateId: templateState.appliedTemplateId,
      appliedProfile: templateState.appliedProfile,
      askAvailable,
    };
  }

  private async checkScopeWithAxes(
    toolId: string,
    op: string,
    resolvedResource: string,
    extra: Record<string, string>,
  ): Promise<ScopeDecision> {
    const templateState = this.getTemplateState();
    const result = await this.client!.scopeCheck(toolId, {
      resource: resolvedResource,
      op,
      project_root: this.projectRoot,
      ...extra,
    });
    const askAvailable = !result.allowed && (result.reason === 'ASK_REQUIRED' || (result as Record<string, unknown>)['ask_gate_available'] === true);
    return {
      allowed: result.allowed,
      reason: result.reason,
      toolId,
      appliedTemplateId: templateState.appliedTemplateId,
      appliedProfile: templateState.appliedProfile,
      askAvailable,
    };
  }

  private recordActivity(
    kind: ActivityKind,
    toolId: string,
    filePath: string,
    allowed: boolean,
    reason?: string,
    errorCode?: string,
    ctx?: FileOpContext,
    extra?: Record<string, unknown>,
  ): void {
    if (!this.recorder) return;
    this.recorder.record({
      kind,
      toolId,
      path: filePath,
      allowed,
      decisionSource: 'daemon',
      reason,
      errorCode,
      summary: activitySummary(kind, filePath, allowed, extra),
      correlationId: ctx?.correlationId,
      streamId: ctx?.streamId,
      details: extra,
    });
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
      case 'EXDEV':
        return this.error('IO_ERROR', 'Cross-device move not supported. Use file_copy + file_delete instead.');
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

/**
 * Simple glob matching — supports *, ?, and character classes.
 * Only matches against the filename (basename), not the full path.
 */
function matchGlob(name: string, pattern: string): boolean {
  // Convert glob to regex
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      regex += '.*';
    } else if (c === '?') {
      regex += '.';
    } else if (c === '[') {
      const end = pattern.indexOf(']', i + 1);
      if (end === -1) {
        regex += '\\[';
      } else {
        regex += pattern.slice(i, end + 1);
        i = end;
      }
    } else {
      regex += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  regex += '$';

  try {
    return new RegExp(regex, 'i').test(name);
  } catch {
    return false;
  }
}

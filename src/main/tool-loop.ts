// SPDX-License-Identifier: Apache-2.0
/**
 * ToolLoop — client-side tool execution for chat.
 *
 * The daemon is text-only (no tool_use). Clerk builds its own tool loop:
 * - System prompt injection with tool descriptions
 * - Structured text tool calling via <tool_calls> XML tags
 * - Client-side tool execution — scope.check gates every op
 * - Each daemon turn gets its own governance receipt
 * - Structured JSON tool results so the model can self-correct
 *
 * Safety: parse only after turn completes, last tag wins, must be at end,
 * cap payloads, relative paths only, anti-thrash limits.
 *
 * Slice 2 additions:
 * - file_write_overwrite tool (hash-guarded atomic overwrite)
 * - AbortSignal / stop() — user-initiated halt
 * - AskGate — pause on ASK_REQUIRED, resume on user response
 */

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
  FileAction,
  ReceiptRef,
  ViolationRef,
  PendingViolation,
  AskRequest,
  AskGrantToken,
} from '../shared/types.js';
import type { FileOpContext } from './file-manager.js';
import type { ActivityRecorder } from './activity-manager.js';
import type { ActivityKind } from '../shared/activity-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolName = 'file_list' | 'file_read' | 'file_write_create' | 'file_write_overwrite' | 'file_patch' | 'file_mkdir' | 'file_copy' | 'file_move' | 'file_delete' | 'file_find' | 'file_grep';

export type ToolCall = {
  id: string;
  name: ToolName;
  arguments: Record<string, unknown>;
};

export type ToolParseErrorCode =
  | 'MALFORMED_XML'
  | 'TRAILING_TEXT'
  | 'JSON_PARSE'
  | 'INVALID_SHAPE'
  | 'INVALID_TOOL'
  | 'INVALID_ARGS'
  | 'INVALID_PATH'
  | 'TOO_MANY_CALLS'
  | 'DUPLICATE_ID';

export type ToolParseResult =
  | { ok: true; calls: ToolCall[] }
  | { ok: false; error: { code: ToolParseErrorCode; message: string } };

export interface ToolResult {
  id: string;
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  blocked?: boolean;
  askRequired?: boolean;
  suggestion?: string;
}

/** Subset of GovernorClient used by ToolLoop for chat streaming. */
export interface ToolLoopClient {
  chatStreamStart(
    messages: Array<{ role: string; content: string }>,
    options: Record<string, unknown>,
    onDelta: (delta: { content?: string }) => void,
    onEnd: (result: { receipt?: unknown; violations?: unknown[]; pending?: unknown }) => void,
  ): Promise<string>;
}

/** Subset of FileManager used by ToolLoop for file operations. */
export interface ToolLoopFileOps {
  readFile(relativePath: string, ctx?: FileOpContext): Promise<FileReadResponse>;
  writeFile(relativePath: string, content: string, ctx?: FileOpContext): Promise<FileWriteResponse>;
  overwriteFile(relativePath: string, content: string, expectedHash: string, ctx?: FileOpContext): Promise<FileOverwriteResponse>;
  patchFile(relativePath: string, patch: string, expectedHash: string, ctx?: FileOpContext): Promise<FilePatchResponse>;
  listDir(relativePath: string, ctx?: FileOpContext): Promise<FileListResponse>;
  mkdir(relativePath: string, ctx?: FileOpContext): Promise<FileMkdirResponse>;
  copyFile(srcRelative: string, destRelative: string, ctx?: FileOpContext): Promise<FileCopyResponse>;
  moveFile(srcRelative: string, destRelative: string, ctx?: FileOpContext): Promise<FileMoveResponse>;
  deleteFile(relativePath: string, ctx?: FileOpContext): Promise<FileDeleteResponse>;
  fileFind(basePath: string, pattern?: string, ctx?: FileOpContext): Promise<FileFindResponse>;
  fileGrep(query: string, basePath?: string, ctx?: FileOpContext): Promise<FileGrepResponse>;
}

/** AskGate — pauses tool loop on ASK_REQUIRED, resolves when user responds. */
export interface AskGate {
  requestAsk(
    req: AskRequest,
    signal: AbortSignal,
  ): Promise<{ decision: 'allow_once' | 'deny'; grantToken?: AskGrantToken; reason?: string }>;
}

export interface ToolLoopCallbacks {
  onDelta: (delta: { content?: string }) => void;
  onEnd: (result: {
    receipt?: ReceiptRef | null;
    violations?: ViolationRef[];
    pending?: PendingViolation | null;
    fileActions?: FileAction[];
    stoppedByUser?: boolean;
  }) => void;
  onFileAction?: (action: FileAction) => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OPEN = '<tool_calls>';
const CLOSE = '</tool_calls>';
const MAX_CALLS_PER_TURN = 5;
const MAX_CALLS_PER_RUN = 20;
const MAX_TURNS = 10;
const RUN_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export function buildToolSystemPrompt(projectRootLabel = 'the project folder'): string {
  return `
You are Clerk running inside a desktop app. You can ask the app to use file tools on your behalf.

CRITICAL RULES (follow exactly):
- Use tools only when needed. Prefer answering directly when you can.
- All paths MUST be relative to ${projectRootLabel}. Do NOT use absolute paths. Do NOT use "..".
- If you need to discover files, call file_list on "." or a subfolder.
- When you call tools, you MUST append a single <tool_calls>...</tool_calls> block at the VERY END of your message.
- The <tool_calls> block MUST contain valid JSON: an array of tool call objects.
- Do NOT include any text after </tool_calls>.
- If you do not need tools, do NOT output <tool_calls> at all.

TOOL CALL FORMAT:
At the end of your message, append:

<tool_calls>
[
  {"id":"1","name":"file_list","arguments":{"path":"."}},
  {"id":"2","name":"file_read","arguments":{"path":"README.md"}}
]
</tool_calls>

- "id" must be a short string unique within the message.
- "name" must be one of: "file_list", "file_read", "file_write_create", "file_write_overwrite", "file_patch", "file_mkdir", "file_copy", "file_move", "file_delete", "file_find", "file_grep".
- "arguments" must be an object. Only the arguments listed below are allowed.

AVAILABLE TOOLS:

1) file_list
- Purpose: list directory entries to discover files/folders.
- Arguments:
  - path: string (relative directory path, "." allowed)
- Notes:
  - Results may be truncated if the directory is large.

2) file_read
- Purpose: read a UTF-8 text file.
- Arguments:
  - path: string (relative file path)
- Notes:
  - Results include contentHash, truncated, and hashCoversFullFile fields.
  - If hashCoversFullFile is false, the content was truncated and you cannot use the hash for overwrite. Ask the user or re-read a narrower range.

3) file_write_create
- Purpose: create a NEW file with UTF-8 text content. This tool FAILS if the file already exists.
- Arguments:
  - path: string (relative file path; parent directories must already exist)
  - content: string (UTF-8 text)

4) file_write_overwrite
- Purpose: replace the ENTIRE contents of an existing file. Requires the expected_hash from a previous file_read.
- Arguments:
  - path: string (relative file path)
  - content: string (the new file content)
  - expected_hash: string (the contentHash from the most recent file_read of this file)
- Notes:
  - You MUST read the file first (file_read) to get the contentHash.
  - The expected_hash must match the current file content. If the file was modified externally, you'll get a HASH_MISMATCH error — re-read the file and try again.
  - Only works when hashCoversFullFile was true in the read result.
  - If the operation requires user approval, you'll get an ASK_REQUIRED response. The app will ask the user and retry automatically.

5) file_mkdir
- Purpose: create a new directory.
- Arguments:
  - path: string (relative directory path)
- Notes:
  - Non-recursive: parent directory must already exist.
  - Fails if the directory already exists.

6) file_copy
- Purpose: copy a file to a new location.
- Arguments:
  - source: string (relative path of the source file)
  - destination: string (relative path for the copy)
- Notes:
  - File-only — cannot copy directories. To copy a directory, create it with file_mkdir then copy each file individually.
  - Fails if the destination already exists.

7) file_move
- Purpose: move or rename a file.
- Arguments:
  - source: string (relative path of the source)
  - destination: string (relative path for the new location)
- Notes:
  - Fails if the destination already exists.
  - May require user approval depending on the current policy.

8) file_delete
- Purpose: delete a file (moves it to a trash folder — soft delete).
- Arguments:
  - path: string (relative file path)
- Notes:
  - The file is moved to .clerk/trash/, not permanently deleted.
  - May require user approval depending on the current policy.

9) file_find
- Purpose: search for files by name pattern (glob).
- Arguments:
  - path: string (relative base directory to search in, "." allowed)
  - pattern: string (optional glob pattern, e.g. "*.ts", "test_*")
- Notes:
  - Recursively searches subdirectories.
  - Results are capped at 200 entries.
  - Excludes node_modules, .git, and internal directories automatically.

10) file_grep
- Purpose: search file contents for a text string.
- Arguments:
  - query: string (the text to search for, case-insensitive)
  - path: string (optional; relative base directory to search in, defaults to ".")
- Notes:
  - Returns matching lines with file path, line number, and preview.
  - Capped at 200 matches across 50 files.
  - Skips binary files and files over 1MB.
  - Excludes node_modules, .git, and internal directories automatically.

11) file_patch
- Purpose: apply a unified diff patch to an existing file. More efficient than file_write_overwrite for surgical edits.
- Arguments:
  - path: string (relative file path)
  - expected_hash: string (the contentHash from the most recent file_read of this file)
  - patch: string (unified diff format — must start with @@ hunk headers)
- Notes:
  - You MUST read the file first (file_read) to get the contentHash.
  - The patch must be in unified diff format with @@ hunk headers.
  - Context lines must match exactly. If the patch fails to apply, re-read the file and generate a new patch.
  - If the operation requires user approval, you'll get an ASK_REQUIRED response.
  - Prefer this over file_write_overwrite when making small changes to large files.
  - Do NOT include diff --git or --- / +++ headers — start directly with @@ lines.
  - Max 50 hunks, 2000 changed lines, 100KB patch size.

IMPORTANT: All paths under .clerk/ are off-limits and will be denied.

HOW TOOL RESULTS APPEAR:
After you call tools, the app will reply with a user message containing:

<tool_results>
[ ... JSON results ... ]
</tool_results>

You must read those results and then continue the task. If a tool is blocked or fails, adapt your plan and explain what happened.

PATH GUIDANCE:
- Use "." to mean the project root.
- Prefer short, simple paths (e.g. "notes.md", "docs/notes.md").
- Never invent paths. If unsure, call file_list first.

REMEMBER:
- No text after </tool_calls>.
- No <tool_calls> block unless you are actually requesting tool execution.
`.trim();
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function stripToolCalls(text: string): { text: string; hadToolCalls: boolean } {
  const lastOpen = text.lastIndexOf(OPEN);
  if (lastOpen === -1) return { text, hadToolCalls: false };

  const close = text.indexOf(CLOSE, lastOpen);
  if (close === -1) return { text, hadToolCalls: false };

  const before = text.slice(0, lastOpen).trimEnd();
  return { text: before, hadToolCalls: true };
}

export function parseToolCalls(
  fullText: string,
  opts?: { maxCalls?: number },
): ToolParseResult {
  const maxCalls = opts?.maxCalls ?? MAX_CALLS_PER_TURN;

  const lastOpen = fullText.lastIndexOf(OPEN);
  if (lastOpen === -1) return { ok: true, calls: [] };

  const close = fullText.indexOf(CLOSE, lastOpen);
  if (close === -1) {
    return { ok: false, error: { code: 'MALFORMED_XML', message: 'Missing </tool_calls>.' } };
  }

  const after = fullText.slice(close + CLOSE.length);
  if (after.trim().length !== 0) {
    return {
      ok: false,
      error: { code: 'TRAILING_TEXT', message: 'Tool calls must be the last thing in the message.' },
    };
  }

  const inner = fullText.slice(lastOpen + OPEN.length, close).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(inner);
  } catch (e) {
    return {
      ok: false,
      error: { code: 'JSON_PARSE', message: `Invalid JSON inside <tool_calls>: ${String(e)}` },
    };
  }

  if (!Array.isArray(parsed)) {
    return {
      ok: false,
      error: { code: 'INVALID_SHAPE', message: 'Tool calls JSON must be an array.' },
    };
  }

  if (parsed.length > maxCalls) {
    return {
      ok: false,
      error: { code: 'TOO_MANY_CALLS', message: `Too many tool calls (${parsed.length}); max is ${maxCalls}.` },
    };
  }

  const calls: ToolCall[] = [];
  const seenIds = new Set<string>();

  for (const item of parsed) {
    if (!isPlainObject(item)) {
      return { ok: false, error: { code: 'INVALID_SHAPE', message: 'Each tool call must be an object.' } };
    }

    const id = item['id'];
    const name = item['name'];
    const args = item['arguments'];

    if (typeof id !== 'string' || id.trim() === '') {
      return { ok: false, error: { code: 'INVALID_SHAPE', message: "Tool call 'id' must be a non-empty string." } };
    }
    if (seenIds.has(id)) {
      return { ok: false, error: { code: 'DUPLICATE_ID', message: `Duplicate tool call id: ${id}` } };
    }
    seenIds.add(id);

    if (!isToolName(name)) {
      return { ok: false, error: { code: 'INVALID_TOOL', message: `Unknown tool: ${String(name)}` } };
    }
    if (!isPlainObject(args)) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: `Tool '${name}' arguments must be an object.` } };
    }

    const v = validateArgs(name, args);
    if (!v.ok) return v;

    calls.push({ id, name, arguments: args });
  }

  return { ok: true, calls };
}

function validateArgs(name: ToolName, args: Record<string, unknown>): ToolParseResult {
  const keys = Object.keys(args);

  const requireOnly = (required: string[]) => {
    for (const r of required) {
      if (!(r in args)) return `Missing argument '${r}'.`;
    }
    for (const k of keys) {
      if (!required.includes(k)) return `Unknown argument '${k}'.`;
    }
    return null;
  };

  if (name === 'file_list') {
    const err = requireOnly(['path']);
    if (err) return { ok: false, error: { code: 'INVALID_ARGS', message: `file_list: ${err}` } };

    const p = args['path'];
    if (typeof p !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_list: 'path' must be a string." } };
    }
    return validateRelPath(p);
  }

  if (name === 'file_read') {
    const err = requireOnly(['path']);
    if (err) return { ok: false, error: { code: 'INVALID_ARGS', message: `file_read: ${err}` } };

    const p = args['path'];
    if (typeof p !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_read: 'path' must be a string." } };
    }
    return validateRelPath(p);
  }

  if (name === 'file_write_overwrite') {
    const err = requireOnly(['path', 'content', 'expected_hash']);
    if (err) return { ok: false, error: { code: 'INVALID_ARGS', message: `file_write_overwrite: ${err}` } };

    const p = args['path'];
    const content = args['content'];
    const hash = args['expected_hash'];
    if (typeof p !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_write_overwrite: 'path' must be a string." } };
    }
    if (typeof content !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_write_overwrite: 'content' must be a string." } };
    }
    if (typeof hash !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_write_overwrite: 'expected_hash' must be a string." } };
    }
    return validateRelPath(p);
  }

  if (name === 'file_patch') {
    const err = requireOnly(['path', 'expected_hash', 'patch']);
    if (err) return { ok: false, error: { code: 'INVALID_ARGS', message: `file_patch: ${err}` } };

    const p = args['path'];
    const hash = args['expected_hash'];
    const patch = args['patch'];
    if (typeof p !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_patch: 'path' must be a string." } };
    }
    if (typeof hash !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_patch: 'expected_hash' must be a string." } };
    }
    if (typeof patch !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_patch: 'patch' must be a string." } };
    }
    return validateRelPath(p);
  }

  if (name === 'file_mkdir') {
    const err = requireOnly(['path']);
    if (err) return { ok: false, error: { code: 'INVALID_ARGS', message: `file_mkdir: ${err}` } };

    const p = args['path'];
    if (typeof p !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_mkdir: 'path' must be a string." } };
    }
    return validateRelPath(p);
  }

  if (name === 'file_copy') {
    const err = requireOnly(['source', 'destination']);
    if (err) return { ok: false, error: { code: 'INVALID_ARGS', message: `file_copy: ${err}` } };

    const src = args['source'];
    const dest = args['destination'];
    if (typeof src !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_copy: 'source' must be a string." } };
    }
    if (typeof dest !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_copy: 'destination' must be a string." } };
    }
    const srcCheck = validateRelPath(src);
    if (!srcCheck.ok) return srcCheck;
    return validateRelPath(dest);
  }

  if (name === 'file_move') {
    const err = requireOnly(['source', 'destination']);
    if (err) return { ok: false, error: { code: 'INVALID_ARGS', message: `file_move: ${err}` } };

    const src = args['source'];
    const dest = args['destination'];
    if (typeof src !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_move: 'source' must be a string." } };
    }
    if (typeof dest !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_move: 'destination' must be a string." } };
    }
    const srcCheck = validateRelPath(src);
    if (!srcCheck.ok) return srcCheck;
    return validateRelPath(dest);
  }

  if (name === 'file_delete') {
    const err = requireOnly(['path']);
    if (err) return { ok: false, error: { code: 'INVALID_ARGS', message: `file_delete: ${err}` } };

    const p = args['path'];
    if (typeof p !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_delete: 'path' must be a string." } };
    }
    return validateRelPath(p);
  }

  if (name === 'file_find') {
    // path required, pattern optional
    for (const k of keys) {
      if (k !== 'path' && k !== 'pattern') {
        return { ok: false, error: { code: 'INVALID_ARGS', message: `file_find: Unknown argument '${k}'.` } };
      }
    }
    if (!('path' in args)) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_find: Missing argument 'path'." } };
    }
    const p = args['path'];
    if (typeof p !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_find: 'path' must be a string." } };
    }
    if ('pattern' in args && typeof args['pattern'] !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_find: 'pattern' must be a string." } };
    }
    return validateRelPath(p);
  }

  if (name === 'file_grep') {
    // query required, path optional
    for (const k of keys) {
      if (k !== 'query' && k !== 'path') {
        return { ok: false, error: { code: 'INVALID_ARGS', message: `file_grep: Unknown argument '${k}'.` } };
      }
    }
    if (!('query' in args)) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_grep: Missing argument 'query'." } };
    }
    const q = args['query'];
    if (typeof q !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_grep: 'query' must be a string." } };
    }
    if ('path' in args) {
      const p = args['path'];
      if (typeof p !== 'string') {
        return { ok: false, error: { code: 'INVALID_ARGS', message: "file_grep: 'path' must be a string." } };
      }
      return validateRelPath(p);
    }
    return { ok: true, calls: [] };
  }

  // file_write_create
  {
    const err = requireOnly(['path', 'content']);
    if (err) return { ok: false, error: { code: 'INVALID_ARGS', message: `file_write_create: ${err}` } };

    const p = args['path'];
    const content = args['content'];
    if (typeof p !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_write_create: 'path' must be a string." } };
    }
    if (typeof content !== 'string') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: "file_write_create: 'content' must be a string." } };
    }
    return validateRelPath(p);
  }
}

function validateRelPath(p: string): ToolParseResult {
  if (p.trim() === '' || p.includes('\0')) {
    return { ok: false, error: { code: 'INVALID_PATH', message: 'Path is empty or contains null byte.' } };
  }

  if (p.startsWith('/')) {
    return { ok: false, error: { code: 'INVALID_PATH', message: 'Absolute paths are not allowed.' } };
  }

  if (/^[a-zA-Z]:[/\\]/.test(p)) {
    return { ok: false, error: { code: 'INVALID_PATH', message: 'Absolute Windows paths are not allowed.' } };
  }

  if (p.startsWith('\\\\')) {
    return { ok: false, error: { code: 'INVALID_PATH', message: 'UNC paths are not allowed.' } };
  }

  const parts = p.split(/[/\\]+/);
  if (parts.some((seg) => seg === '..')) {
    return { ok: false, error: { code: 'INVALID_PATH', message: "Path traversal ('..') is not allowed." } };
  }

  return { ok: true, calls: [] };
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null) return false;
  const proto = Object.getPrototypeOf(x);
  return proto === Object.prototype || proto === null;
}

function isToolName(x: unknown): x is ToolName {
  return x === 'file_list' || x === 'file_read' || x === 'file_write_create' || x === 'file_write_overwrite'
    || x === 'file_patch' || x === 'file_mkdir' || x === 'file_copy' || x === 'file_move' || x === 'file_delete'
    || x === 'file_find' || x === 'file_grep';
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

/** Tracks hash coverage per file path — set by file_read, checked by file_write_overwrite. */
type HashCoverageMap = Map<string, boolean>;

interface ExecuteToolResult {
  result: ToolResult;
  action: FileAction;
  askRequired?: boolean;
  askInfo?: { toolId: string; path: string; toPath?: string; content?: string; contentSize?: number; expectedHash?: string };
}

async function executeTool(
  call: ToolCall,
  fileOps: ToolLoopFileOps,
  ctx?: FileOpContext,
  hashCoverage?: HashCoverageMap,
): Promise<ExecuteToolResult> {
  const toolPath = (call.arguments['path'] as string) ?? '.';

  if (call.name === 'file_list') {
    const resp = await fileOps.listDir(toolPath, ctx);
    if (resp.ok) {
      const action: FileAction = {
        tool: 'LIST',
        path: toolPath,
        allowed: true,
        profile: resp.decision.appliedProfile,
        summary: `${resp.entries.length} entries${resp.truncated ? ' (truncated)' : ''}`,
        status: 'allowed',
      };
      return {
        result: {
          id: call.id,
          name: call.name,
          ok: true,
          result: { entries: resp.entries, truncated: resp.truncated },
        },
        action,
      };
    } else {
      const action: FileAction = {
        tool: 'LIST',
        path: toolPath,
        allowed: !resp.decision || resp.code !== 'BLOCKED',
        profile: resp.decision?.appliedProfile ?? '',
        error: resp.message,
        status: resp.code === 'BLOCKED' ? 'blocked' : undefined,
      };
      return {
        result: {
          id: call.id,
          name: call.name,
          ok: false,
          error: resp.message,
          blocked: resp.code === 'BLOCKED',
          suggestion: resp.code === 'BLOCKED' ? 'This directory is blocked by the current policy.' : undefined,
        },
        action,
      };
    }
  }

  if (call.name === 'file_read') {
    const resp = await fileOps.readFile(toolPath, ctx);
    if (resp.ok) {
      const truncated = resp.content.length > MAX_FILE_SIZE_FOR_RESULT;
      const content = truncated ? resp.content.slice(0, MAX_FILE_SIZE_FOR_RESULT) : resp.content;
      const fullCoverage = !truncated && resp.hashCoversFullFile;
      // Track hash coverage for overwrite enforcement
      if (hashCoverage && resp.contentHash) {
        hashCoverage.set(toolPath, fullCoverage);
      }
      const action: FileAction = {
        tool: 'READ',
        path: toolPath,
        allowed: true,
        profile: resp.decision.appliedProfile,
        summary: truncated ? `${content.length} chars (truncated)` : `${content.length} chars`,
        status: 'allowed',
      };
      return {
        result: {
          id: call.id,
          name: call.name,
          ok: true,
          result: {
            content,
            truncated: truncated || resp.truncated,
            contentHash: resp.contentHash,
            hashCoversFullFile: fullCoverage,
          },
        },
        action,
      };
    } else {
      const action: FileAction = {
        tool: 'READ',
        path: toolPath,
        allowed: !resp.decision || resp.code !== 'BLOCKED',
        profile: resp.decision?.appliedProfile ?? '',
        error: resp.message,
        status: resp.code === 'BLOCKED' ? 'blocked' : undefined,
      };
      return {
        result: {
          id: call.id,
          name: call.name,
          ok: false,
          error: resp.message,
          blocked: resp.code === 'BLOCKED',
          suggestion: resp.code === 'BLOCKED' ? 'This file is blocked by the current policy.' : undefined,
        },
        action,
      };
    }
  }

  if (call.name === 'file_write_overwrite') {
    const content = call.arguments['content'] as string;
    const expectedHash = call.arguments['expected_hash'] as string;

    // Enforce hashCoversFullFile — reject overwrite if hash came from truncated read
    if (hashCoverage && hashCoverage.has(toolPath) && !hashCoverage.get(toolPath)) {
      const action: FileAction = {
        tool: 'OVERWRITE',
        path: toolPath,
        allowed: false,
        profile: '',
        error: 'Hash is from a truncated read — cannot overwrite.',
        status: 'blocked',
      };
      return {
        result: {
          id: call.id,
          name: call.name,
          ok: false,
          error: 'The contentHash from your last file_read does not cover the full file (hashCoversFullFile was false). You cannot use it for overwrite. Re-read the file without truncation first.',
          suggestion: 'Re-read the file to get a full content hash before overwriting.',
        },
        action,
      };
    }

    const resp = await fileOps.overwriteFile(toolPath, content, expectedHash, ctx);
    if (resp.ok) {
      const action: FileAction = {
        tool: 'OVERWRITE',
        path: toolPath,
        allowed: true,
        profile: resp.decision.appliedProfile,
        summary: `overwrote (${Buffer.byteLength(content, 'utf-8')} bytes)`,
        status: 'allowed',
      };
      return {
        result: { id: call.id, name: call.name, ok: true },
        action,
      };
    } else {
      const isAskRequired = resp.code === 'ASK_REQUIRED';
      const action: FileAction = {
        tool: 'OVERWRITE',
        path: toolPath,
        allowed: false,
        profile: resp.decision?.appliedProfile ?? '',
        error: resp.message,
        status: isAskRequired ? 'ask_pending' : 'blocked',
      };
      return {
        result: {
          id: call.id,
          name: call.name,
          ok: false,
          error: resp.message,
          blocked: resp.code === 'BLOCKED',
          askRequired: isAskRequired,
          suggestion: isAskRequired
            ? 'This operation requires user approval.'
            : resp.code === 'BLOCKED' ? 'File overwrite is blocked by the current policy.'
            : resp.code === 'HASH_MISMATCH' ? 'The file was modified since you last read it. Re-read the file and try again.'
            : undefined,
        },
        action,
        askRequired: isAskRequired,
        askInfo: isAskRequired ? {
          toolId: 'file.write.overwrite',
          path: toolPath,
          content,
          contentSize: Buffer.byteLength(content, 'utf-8'),
          expectedHash,
        } : undefined,
      };
    }
  }

  if (call.name === 'file_patch') {
    const expectedHash = call.arguments['expected_hash'] as string;
    const patchContent = call.arguments['patch'] as string;

    const resp = await fileOps.patchFile(toolPath, patchContent, expectedHash, ctx);
    if (resp.ok) {
      const action: FileAction = {
        tool: 'PATCH',
        path: toolPath,
        allowed: true,
        profile: resp.decision.appliedProfile,
        summary: `patched (${resp.appliedHunks} hunk${resp.appliedHunks !== 1 ? 's' : ''})`,
        status: 'allowed',
      };
      return {
        result: { id: call.id, name: call.name, ok: true, result: { newHash: resp.newHash, appliedHunks: resp.appliedHunks } },
        action,
      };
    } else {
      const isAskRequired = resp.code === 'ASK_REQUIRED';
      const action: FileAction = {
        tool: 'PATCH',
        path: toolPath,
        allowed: false,
        profile: resp.decision?.appliedProfile ?? '',
        error: resp.message,
        status: isAskRequired ? 'ask_pending' : 'blocked',
      };
      return {
        result: {
          id: call.id,
          name: call.name,
          ok: false,
          error: resp.message,
          blocked: resp.code === 'BLOCKED',
          askRequired: isAskRequired,
          suggestion: isAskRequired
            ? 'This operation requires user approval.'
            : resp.code === 'BLOCKED' ? 'File patching is blocked by the current policy.'
            : resp.code === 'HASH_MISMATCH' ? 'The file was modified since you last read it. Re-read the file and try again.'
            : resp.code === 'PATCH_FAILED' ? 'The patch does not apply cleanly. Re-read the file and generate a fresh patch.'
            : resp.code === 'INVALID_PATCH' ? 'The patch is structurally invalid. Check the diff format, hunk counts, and target file name.'
            : undefined,
        },
        action,
        askRequired: isAskRequired,
        askInfo: isAskRequired ? {
          toolId: 'file.patch',
          path: toolPath,
          content: patchContent,
          contentSize: Buffer.byteLength(patchContent, 'utf-8'),
          expectedHash,
        } : undefined,
      };
    }
  }

  if (call.name === 'file_mkdir') {
    const resp = await fileOps.mkdir(toolPath, ctx);
    if (resp.ok) {
      const action: FileAction = { tool: 'MKDIR', path: toolPath, allowed: true, profile: resp.decision.appliedProfile, summary: 'created', status: 'allowed' };
      return { result: { id: call.id, name: call.name, ok: true }, action };
    } else {
      const action: FileAction = { tool: 'MKDIR', path: toolPath, allowed: !resp.decision || resp.code !== 'BLOCKED', profile: resp.decision?.appliedProfile ?? '', error: resp.message, status: resp.code === 'BLOCKED' ? 'blocked' : undefined };
      return { result: { id: call.id, name: call.name, ok: false, error: resp.message, blocked: resp.code === 'BLOCKED', suggestion: resp.code === 'BLOCKED' ? 'Creating directories is blocked by the current policy.' : undefined }, action };
    }
  }

  if (call.name === 'file_copy') {
    const source = call.arguments['source'] as string;
    const destination = call.arguments['destination'] as string;
    const resp = await fileOps.copyFile(source, destination, ctx);
    if (resp.ok) {
      const action: FileAction = { tool: 'COPY', path: source, toPath: destination, allowed: true, profile: resp.decision.appliedProfile, summary: `copied to ${destination}`, status: 'allowed' };
      return { result: { id: call.id, name: call.name, ok: true }, action };
    } else {
      const action: FileAction = { tool: 'COPY', path: source, toPath: destination, allowed: !resp.decision || resp.code !== 'BLOCKED', profile: resp.decision?.appliedProfile ?? '', error: resp.message, status: resp.code === 'BLOCKED' ? 'blocked' : undefined };
      return { result: { id: call.id, name: call.name, ok: false, error: resp.message, blocked: resp.code === 'BLOCKED', suggestion: resp.code === 'BLOCKED' ? 'Copying files is blocked by the current policy.' : undefined }, action };
    }
  }

  if (call.name === 'file_move') {
    const source = call.arguments['source'] as string;
    const destination = call.arguments['destination'] as string;
    const resp = await fileOps.moveFile(source, destination, ctx);
    if (resp.ok) {
      const action: FileAction = { tool: 'MOVE', path: source, toPath: destination, allowed: true, profile: resp.decision.appliedProfile, summary: `moved to ${destination}`, status: 'allowed' };
      return { result: { id: call.id, name: call.name, ok: true }, action };
    } else {
      const isAskRequired = resp.code === 'ASK_REQUIRED';
      const action: FileAction = { tool: 'MOVE', path: source, toPath: destination, allowed: false, profile: resp.decision?.appliedProfile ?? '', error: resp.message, status: isAskRequired ? 'ask_pending' : 'blocked' };
      return {
        result: { id: call.id, name: call.name, ok: false, error: resp.message, blocked: resp.code === 'BLOCKED', askRequired: isAskRequired, suggestion: isAskRequired ? 'This operation requires user approval.' : resp.code === 'BLOCKED' ? 'Moving files is blocked by the current policy.' : undefined },
        action,
        askRequired: isAskRequired,
        askInfo: isAskRequired ? { toolId: 'file.move', path: source, toPath: destination } : undefined,
      };
    }
  }

  if (call.name === 'file_delete') {
    const resp = await fileOps.deleteFile(toolPath, ctx);
    if (resp.ok) {
      const action: FileAction = { tool: 'DELETE', path: toolPath, allowed: true, profile: resp.decision.appliedProfile, summary: 'moved to Trash', status: 'allowed' };
      return { result: { id: call.id, name: call.name, ok: true }, action };
    } else {
      const isAskRequired = resp.code === 'ASK_REQUIRED';
      const action: FileAction = { tool: 'DELETE', path: toolPath, allowed: false, profile: resp.decision?.appliedProfile ?? '', error: resp.message, status: isAskRequired ? 'ask_pending' : 'blocked' };
      return {
        result: { id: call.id, name: call.name, ok: false, error: resp.message, blocked: resp.code === 'BLOCKED', askRequired: isAskRequired, suggestion: isAskRequired ? 'This operation requires user approval.' : resp.code === 'BLOCKED' ? 'Deleting files is blocked by the current policy.' : undefined },
        action,
        askRequired: isAskRequired,
        askInfo: isAskRequired ? { toolId: 'file.delete', path: toolPath } : undefined,
      };
    }
  }

  if (call.name === 'file_find') {
    const pattern = call.arguments['pattern'] as string | undefined;
    const resp = await fileOps.fileFind(toolPath, pattern, ctx);
    if (resp.ok) {
      const action: FileAction = { tool: 'FIND', path: toolPath, allowed: true, profile: resp.decision.appliedProfile, summary: `${resp.entries.length} file${resp.entries.length !== 1 ? 's' : ''}${resp.truncated ? ' (truncated)' : ''}${pattern ? ` matching ${pattern}` : ''}`, status: 'allowed' };
      return { result: { id: call.id, name: call.name, ok: true, result: { entries: resp.entries, truncated: resp.truncated } }, action };
    } else {
      const action: FileAction = { tool: 'FIND', path: toolPath, allowed: !resp.decision || resp.code !== 'BLOCKED', profile: resp.decision?.appliedProfile ?? '', error: resp.message, status: resp.code === 'BLOCKED' ? 'blocked' : undefined };
      return { result: { id: call.id, name: call.name, ok: false, error: resp.message, blocked: resp.code === 'BLOCKED' }, action };
    }
  }

  if (call.name === 'file_grep') {
    const query = call.arguments['query'] as string;
    const grepPath = (call.arguments['path'] as string) ?? '.';
    const resp = await fileOps.fileGrep(query, grepPath, ctx);
    if (resp.ok) {
      const action: FileAction = { tool: 'GREP', path: grepPath, allowed: true, profile: resp.decision.appliedProfile, summary: `${resp.matchCount} match${resp.matchCount !== 1 ? 'es' : ''} in ${resp.fileCount} file${resp.fileCount !== 1 ? 's' : ''}${resp.truncated ? ' (truncated)' : ''}`, status: 'allowed' };
      return { result: { id: call.id, name: call.name, ok: true, result: { matches: resp.matches, matchCount: resp.matchCount, fileCount: resp.fileCount, truncated: resp.truncated } }, action };
    } else {
      const action: FileAction = { tool: 'GREP', path: grepPath, allowed: !resp.decision || resp.code !== 'BLOCKED', profile: resp.decision?.appliedProfile ?? '', error: resp.message, status: resp.code === 'BLOCKED' ? 'blocked' : undefined };
      return { result: { id: call.id, name: call.name, ok: false, error: resp.message, blocked: resp.code === 'BLOCKED' }, action };
    }
  }

  // file_write_create
  {
    const content = call.arguments['content'] as string;
    const resp = await fileOps.writeFile(toolPath, content, ctx);
    if (resp.ok) {
      const action: FileAction = {
        tool: 'WRITE',
        path: toolPath,
        allowed: true,
        profile: resp.decision.appliedProfile,
        summary: `created (${Buffer.byteLength(content, 'utf-8')} bytes)`,
        status: 'allowed',
      };
      return {
        result: { id: call.id, name: call.name, ok: true },
        action,
      };
    } else {
      const action: FileAction = {
        tool: 'WRITE',
        path: toolPath,
        allowed: !resp.decision || resp.code !== 'BLOCKED',
        profile: resp.decision?.appliedProfile ?? '',
        error: resp.message,
        status: resp.code === 'BLOCKED' ? 'blocked' : undefined,
      };
      return {
        result: {
          id: call.id,
          name: call.name,
          ok: false,
          error: resp.message,
          blocked: resp.code === 'BLOCKED',
          suggestion: resp.code === 'BLOCKED' ? 'File creation is blocked by the current policy.' : undefined,
        },
        action,
      };
    }
  }
}

const MAX_FILE_SIZE_FOR_RESULT = 100_000; // 100KB truncation for tool results

function toolIdToActivityKind(toolId: string): ActivityKind {
  switch (toolId) {
    case 'file.write.overwrite': return 'file_write_overwrite';
    case 'file.patch': return 'file_patch';
    case 'file.move': return 'file_move';
    case 'file.delete': return 'file_delete';
    default: return 'system';
  }
}

// ---------------------------------------------------------------------------
// Build tool results message
// ---------------------------------------------------------------------------

function buildToolResultsMessage(results: ToolResult[]): string {
  return `<tool_results>\n${JSON.stringify(results, null, 2)}\n</tool_results>`;
}

// ---------------------------------------------------------------------------
// ToolLoop
// ---------------------------------------------------------------------------

export class ToolLoop {
  private client: ToolLoopClient;
  private fileOps: ToolLoopFileOps;
  private askGate: AskGate | null;
  private recorder: ActivityRecorder | null;

  /** Active controllers per streamId — used for stop(). */
  private activeControllers = new Map<string, AbortController>();

  constructor(client: ToolLoopClient, fileOps: ToolLoopFileOps, askGate?: AskGate | null, recorder?: ActivityRecorder | null) {
    this.client = client;
    this.fileOps = fileOps;
    this.askGate = askGate ?? null;
    this.recorder = recorder ?? null;
  }

  /** Idempotent stop — aborts the controller for the given stream. */
  stop(streamId: string): void {
    const controller = this.activeControllers.get(streamId);
    if (controller && !controller.signal.aborted) {
      controller.abort();
    }
  }

  async run(
    messages: Array<{ role: string; content: string }>,
    options: Record<string, unknown>,
    callbacks: ToolLoopCallbacks,
    streamId?: string,
  ): Promise<string> {
    // Set up abort controller
    const controller = new AbortController();
    const { signal } = controller;
    if (streamId) {
      this.activeControllers.set(streamId, controller);
    }

    // Prepend tool system prompt
    const systemMsg = { role: 'system', content: buildToolSystemPrompt() };
    const workingMessages = [systemMsg, ...messages];

    let totalCalls = 0;
    let turn = 0;
    const allFileActions: FileAction[] = [];
    const blockedCallSet = new Set<string>(); // track "tool:path" combos that were blocked
    const hashCoverage: HashCoverageMap = new Map(); // track hash coverage per file path
    let lastReceipt: ReceiptRef | null = null;
    let lastViolations: ViolationRef[] = [];
    let lastPending: PendingViolation | null = null;
    let stoppedByUser = false;

    // Active time tracking for ask suspension
    let activeElapsedMs = 0;
    let activeStartTime = Date.now();

    const isTimedOut = () => activeElapsedMs > RUN_TIMEOUT_MS;

    try {
      while (turn < MAX_TURNS) {
        // Check abort
        if (signal.aborted) {
          stoppedByUser = true;
          break;
        }

        // Check timeout (active time only)
        activeElapsedMs += Date.now() - activeStartTime;
        activeStartTime = Date.now();
        if (isTimedOut()) break;

        turn++;

        // Stream a turn
        const { text, receipt, violations, pending } = await this.streamOneTurn(
          workingMessages,
          options,
          (delta) => {
            if (!signal.aborted) callbacks.onDelta(delta);
          },
        );

        // Check abort after turn
        if (signal.aborted) {
          stoppedByUser = true;
          break;
        }

        lastReceipt = receipt;
        lastViolations = violations;
        lastPending = pending;

        // Parse tool calls from the completed text
        const parseResult = parseToolCalls(text);

        if (!parseResult.ok) {
          const errorResult: ToolResult = {
            id: '_parse_error',
            name: '_system',
            ok: false,
            error: parseResult.error.message,
          };

          workingMessages.push(
            { role: 'assistant', content: text },
            { role: 'user', content: buildToolResultsMessage([errorResult]) },
          );
          continue;
        }

        if (parseResult.calls.length === 0) {
          break;
        }

        // Check total call limit
        if (totalCalls + parseResult.calls.length > MAX_CALLS_PER_RUN) {
          const errorResult: ToolResult = {
            id: '_limit',
            name: '_system',
            ok: false,
            error: `Tool call limit reached (${MAX_CALLS_PER_RUN} total calls per conversation turn).`,
          };
          workingMessages.push(
            { role: 'assistant', content: text },
            { role: 'user', content: buildToolResultsMessage([errorResult]) },
          );
          break;
        }

        // Anti-thrash: check for repeated blocked calls
        let shortCircuit = false;
        for (const call of parseResult.calls) {
          const key = `${call.name}:${call.arguments['path'] ?? ''}`;
          if (blockedCallSet.has(key)) {
            shortCircuit = true;
            break;
          }
        }

        if (shortCircuit) {
          const errorResult: ToolResult = {
            id: '_anti_thrash',
            name: '_system',
            ok: false,
            error: 'You are repeating a blocked tool call. Please take a different approach or ask the user.',
          };
          workingMessages.push(
            { role: 'assistant', content: text },
            { role: 'user', content: buildToolResultsMessage([errorResult]) },
          );
          break;
        }

        // Execute tool calls sequentially — halt on first ASK_REQUIRED
        const results: ToolResult[] = [];
        let haltedOnAsk = false;
        const remainingCalls: ToolCall[] = [];

        for (let i = 0; i < parseResult.calls.length; i++) {
          if (signal.aborted) {
            stoppedByUser = true;
            break;
          }

          const call = parseResult.calls[i];
          const correlationId = streamId ? `${streamId}:${call.id}` : call.id;
          const ctx: FileOpContext = {
            streamId,
            correlationId,
          };
          const execResult = await executeTool(call, this.fileOps, ctx, hashCoverage);
          results.push(execResult.result);
          allFileActions.push(execResult.action);
          callbacks.onFileAction?.(execResult.action);

          if (execResult.result.blocked) {
            const key = `${call.name}:${call.arguments['path'] ?? ''}`;
            blockedCallSet.add(key);
          }

          // Handle ASK_REQUIRED
          if (execResult.askRequired && this.askGate && execResult.askInfo) {
            // Halt remaining calls
            remainingCalls.push(...parseResult.calls.slice(i + 1));
            haltedOnAsk = true;

            // Suspend active time tracking
            activeElapsedMs += Date.now() - activeStartTime;

            const askId = correlationId;
            const operationLabel = execResult.askInfo.toolId === 'file.move'
              ? `Move ${execResult.askInfo.path} → ${execResult.askInfo.toPath}`
              : execResult.askInfo.toolId === 'file.delete'
                ? `Move ${execResult.askInfo.path} to Trash`
                : execResult.askInfo.toolId === 'file.patch'
                  ? `Patch ${execResult.askInfo.path}`
                  : `Replace contents of ${execResult.askInfo.path}`;
            const askReq: AskRequest = {
              askId,
              streamId: streamId ?? '',
              correlationId,
              toolId: execResult.askInfo.toolId,
              path: execResult.askInfo.path,
              toPath: execResult.askInfo.toPath,
              operationLabel,
              contentSize: execResult.askInfo.contentSize,
              contentPreview: execResult.askInfo.content?.slice(0, 200),
              expectedHash: execResult.askInfo.expectedHash,
            };

            let askResponse: { decision: 'allow_once' | 'deny'; grantToken?: AskGrantToken; reason?: string };
            try {
              askResponse = await this.askGate.requestAsk(askReq, signal);
            } catch {
              // Aborted or error — treat as deny
              askResponse = { decision: 'deny', reason: 'STOPPED_BY_USER' };
              stoppedByUser = signal.aborted;
            }

            // Resume active time tracking
            activeStartTime = Date.now();

            if (askResponse.decision === 'allow_once' && askResponse.grantToken) {
              // Re-execute with grant token
              const retryCtx: FileOpContext = {
                streamId,
                correlationId,
                askGrantToken: askResponse.grantToken,
              };
              const retryResult = await executeTool(call, this.fileOps, retryCtx, hashCoverage);
              // Replace the last result and action
              results[results.length - 1] = retryResult.result;
              allFileActions[allFileActions.length - 1] = { ...retryResult.action, status: 'ask_approved' };
              callbacks.onFileAction?.({ ...retryResult.action, status: 'ask_approved' });
              // Upsert activity with ask_approved status
              if (this.recorder) {
                const askKind = toolIdToActivityKind(execResult.askInfo!.toolId);
                this.recorder.record({
                  kind: askKind,
                  toolId: execResult.askInfo!.toolId,
                  path: execResult.askInfo!.path,
                  allowed: retryResult.result.ok,
                  status: 'ask_approved',
                  decisionSource: 'daemon',
                  summary: retryResult.action.summary ?? `Approved ${execResult.askInfo!.path}`,
                  correlationId,
                  streamId,
                });
              }
            } else {
              // Denied — update action status
              allFileActions[allFileActions.length - 1] = { ...execResult.action, status: 'ask_denied' };
              callbacks.onFileAction?.({ ...execResult.action, status: 'ask_denied' });
              // Upsert activity with ask_denied status
              if (this.recorder) {
                const denyKind = toolIdToActivityKind(execResult.askInfo!.toolId);
                this.recorder.record({
                  kind: denyKind,
                  toolId: execResult.askInfo!.toolId,
                  path: execResult.askInfo!.path,
                  allowed: false,
                  status: 'ask_denied',
                  decisionSource: 'daemon',
                  reason: askResponse.reason ?? 'Denied by user',
                  summary: `Denied ${execResult.askInfo!.path}`,
                  correlationId,
                  streamId,
                });
              }

              if (stoppedByUser) break;
            }

            // Continue with remaining calls if approved
            if (askResponse.decision === 'allow_once') {
              haltedOnAsk = false;
            } else {
              break; // Don't execute remaining calls on deny
            }
          }

          totalCalls++;
        }

        if (stoppedByUser) break;

        // Add assistant turn + tool results to conversation
        workingMessages.push(
          { role: 'assistant', content: text },
          { role: 'user', content: buildToolResultsMessage(results) },
        );

        // If halted on ask + denied, break the loop
        if (haltedOnAsk) break;
      }
    } finally {
      if (streamId) {
        this.activeControllers.delete(streamId);
      }
      if (stoppedByUser && this.recorder) {
        this.recorder.record({
          kind: 'system',
          summary: 'Stopped by user',
          allowed: true,
          decisionSource: 'local',
          streamId,
        });
      }
    }

    // Final onEnd with accumulated file actions
    callbacks.onEnd({
      receipt: lastReceipt,
      violations: lastViolations,
      pending: lastPending,
      fileActions: allFileActions.length > 0 ? allFileActions : undefined,
      stoppedByUser: stoppedByUser || undefined,
    });

    return 'done';
  }

  private streamOneTurn(
    messages: Array<{ role: string; content: string }>,
    options: Record<string, unknown>,
    onDelta: (delta: { content?: string }) => void,
  ): Promise<{
    text: string;
    receipt: ReceiptRef | null;
    violations: ViolationRef[];
    pending: PendingViolation | null;
  }> {
    return new Promise((resolve, reject) => {
      let assembled = '';

      this.client.chatStreamStart(
        messages,
        options,
        (delta) => {
          assembled += delta.content ?? '';
          onDelta(delta);
        },
        (result) => {
          resolve({
            text: assembled,
            receipt: (result.receipt as ReceiptRef) ?? null,
            violations: (result.violations as ViolationRef[]) ?? [],
            pending: (result.pending as PendingViolation) ?? null,
          });
        },
      ).catch(reject);
    });
  }
}

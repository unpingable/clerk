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
 */

import type {
  FileReadResponse,
  FileWriteResponse,
  FileListResponse,
  FileAction,
  ReceiptRef,
  ViolationRef,
  PendingViolation,
} from '../shared/types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToolName = 'file_list' | 'file_read' | 'file_write_create';

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
  readFile(relativePath: string): Promise<FileReadResponse>;
  writeFile(relativePath: string, content: string): Promise<FileWriteResponse>;
  listDir(relativePath: string): Promise<FileListResponse>;
}

export interface ToolLoopCallbacks {
  onDelta: (delta: { content?: string }) => void;
  onEnd: (result: {
    receipt?: ReceiptRef | null;
    violations?: ViolationRef[];
    pending?: PendingViolation | null;
    fileActions?: FileAction[];
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
- "name" must be one of: "file_list", "file_read", "file_write_create".
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
  - Results may be truncated for large files. If truncated, request a narrower file or ask the user.

3) file_write_create
- Purpose: create a NEW file with UTF-8 text content. This tool FAILS if the file already exists.
- Arguments:
  - path: string (relative file path; parent directories must already exist)
  - content: string (UTF-8 text)
- Notes:
  - If you need to modify an existing file, you must ask the user for confirmation or propose creating a new file next to it.

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
  return x === 'file_list' || x === 'file_read' || x === 'file_write_create';
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

async function executeTool(
  call: ToolCall,
  fileOps: ToolLoopFileOps,
): Promise<{ result: ToolResult; action: FileAction }> {
  const toolPath = (call.arguments['path'] as string) ?? '.';

  if (call.name === 'file_list') {
    const resp = await fileOps.listDir(toolPath);
    if (resp.ok) {
      const action: FileAction = {
        tool: 'LIST',
        path: toolPath,
        allowed: true,
        profile: resp.decision.appliedProfile,
        summary: `${resp.entries.length} entries${resp.truncated ? ' (truncated)' : ''}`,
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
    const resp = await fileOps.readFile(toolPath);
    if (resp.ok) {
      const truncated = resp.content.length > MAX_FILE_SIZE_FOR_RESULT;
      const content = truncated ? resp.content.slice(0, MAX_FILE_SIZE_FOR_RESULT) : resp.content;
      const action: FileAction = {
        tool: 'READ',
        path: toolPath,
        allowed: true,
        profile: resp.decision.appliedProfile,
        summary: truncated ? `${content.length} chars (truncated)` : `${content.length} chars`,
      };
      return {
        result: {
          id: call.id,
          name: call.name,
          ok: true,
          result: { content, truncated },
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

  // file_write_create
  {
    const content = call.arguments['content'] as string;
    const resp = await fileOps.writeFile(toolPath, content);
    if (resp.ok) {
      const action: FileAction = {
        tool: 'WRITE',
        path: toolPath,
        allowed: true,
        profile: resp.decision.appliedProfile,
        summary: `created (${Buffer.byteLength(content, 'utf-8')} bytes)`,
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

  constructor(client: ToolLoopClient, fileOps: ToolLoopFileOps) {
    this.client = client;
    this.fileOps = fileOps;
  }

  async run(
    messages: Array<{ role: string; content: string }>,
    options: Record<string, unknown>,
    callbacks: ToolLoopCallbacks,
  ): Promise<string> {
    // Prepend tool system prompt
    const systemMsg = { role: 'system', content: buildToolSystemPrompt() };
    const workingMessages = [systemMsg, ...messages];

    let totalCalls = 0;
    let turn = 0;
    const allFileActions: FileAction[] = [];
    const blockedCallSet = new Set<string>(); // track "tool:path" combos that were blocked
    let lastReceipt: ReceiptRef | null = null;
    let lastViolations: ViolationRef[] = [];
    let lastPending: PendingViolation | null = null;

    const deadline = Date.now() + RUN_TIMEOUT_MS;

    while (turn < MAX_TURNS) {
      if (Date.now() > deadline) {
        break;
      }

      turn++;

      // Stream a turn
      const { text, receipt, violations, pending } = await this.streamOneTurn(
        workingMessages,
        options,
        callbacks.onDelta,
      );

      lastReceipt = receipt;
      lastViolations = violations;
      lastPending = pending;

      // Parse tool calls from the completed text
      const parseResult = parseToolCalls(text);

      if (!parseResult.ok) {
        // Inject parse error as tool result so model can recover
        const errorResult: ToolResult = {
          id: '_parse_error',
          name: '_system',
          ok: false,
          error: parseResult.error.message,
        };

        // Strip failed tool calls from displayed text
        const { text: cleanText } = stripToolCalls(text);
        // Re-send delta with clean text (replace what was streamed)
        // The delta callback already sent the raw text, so the renderer
        // will see the full text. We just need to continue the loop.

        workingMessages.push(
          { role: 'assistant', content: text },
          { role: 'user', content: buildToolResultsMessage([errorResult]) },
        );
        continue;
      }

      if (parseResult.calls.length === 0) {
        // No tool calls — we're done
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

      // Strip tool calls from text before sending delta
      const { text: displayText } = stripToolCalls(text);
      // Note: deltas were already sent during streaming. The renderer will
      // get the raw text with tool_calls in it. The final onEnd carries
      // the clean text. For a polished UX you'd buffer, but this is Day 1.

      // Execute tool calls
      const results: ToolResult[] = [];
      for (const call of parseResult.calls) {
        const { result, action } = await executeTool(call, this.fileOps);
        results.push(result);
        allFileActions.push(action);
        callbacks.onFileAction?.(action);

        if (result.blocked) {
          const key = `${call.name}:${call.arguments['path'] ?? ''}`;
          blockedCallSet.add(key);
        }

        totalCalls++;
      }

      // Add assistant turn + tool results to conversation
      workingMessages.push(
        { role: 'assistant', content: text },
        { role: 'user', content: buildToolResultsMessage(results) },
      );
    }

    // Final onEnd with accumulated file actions
    callbacks.onEnd({
      receipt: lastReceipt,
      violations: lastViolations,
      pending: lastPending,
      fileActions: allFileActions.length > 0 ? allFileActions : undefined,
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

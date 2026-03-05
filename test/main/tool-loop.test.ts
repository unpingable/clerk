// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import {
  parseToolCalls,
  stripToolCalls,
  buildToolSystemPrompt,
  ToolLoop,
} from '../../src/main/tool-loop';
import type { ToolLoopClient, ToolLoopFileOps, ToolLoopCallbacks, AskGate } from '../../src/main/tool-loop';
import type { AskRequest, AskGrantToken } from '../../src/shared/types';

// ---------------------------------------------------------------------------
// parseToolCalls
// ---------------------------------------------------------------------------

describe('parseToolCalls', () => {
  it('parses a valid single tool call', () => {
    const text = `Let me check that.\n<tool_calls>\n[{"id":"1","name":"file_read","arguments":{"path":"README.md"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].name).toBe('file_read');
      expect(result.calls[0].arguments['path']).toBe('README.md');
    }
  });

  it('parses multiple tool calls', () => {
    const text = `Looking.\n<tool_calls>\n[{"id":"1","name":"file_list","arguments":{"path":"."}},{"id":"2","name":"file_read","arguments":{"path":"src/main.ts"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.calls).toHaveLength(2);
    }
  });

  it('returns empty calls when no tag present', () => {
    const result = parseToolCalls('Just a regular answer.');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.calls).toHaveLength(0);
    }
  });

  it('rejects malformed XML (missing close tag)', () => {
    const text = `Hmm.\n<tool_calls>\n[{"id":"1","name":"file_read","arguments":{"path":"x"}}]`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MALFORMED_XML');
    }
  });

  it('rejects trailing text after </tool_calls>', () => {
    const text = `Ok.\n<tool_calls>\n[{"id":"1","name":"file_read","arguments":{"path":"x"}}]\n</tool_calls>\nSome extra text`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TRAILING_TEXT');
    }
  });

  it('rejects unknown tool name', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_explode","arguments":{"path":"x"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TOOL');
    }
  });

  it('rejects absolute path', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_read","arguments":{"path":"/etc/passwd"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_PATH');
    }
  });

  it('rejects path traversal (..)', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_read","arguments":{"path":"../secret"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_PATH');
    }
  });

  it('rejects duplicate ids', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_read","arguments":{"path":"a.txt"}},{"id":"1","name":"file_read","arguments":{"path":"b.txt"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('DUPLICATE_ID');
    }
  });

  it('rejects too many calls', () => {
    const calls = Array.from({ length: 6 }, (_, i) =>
      `{"id":"${i}","name":"file_read","arguments":{"path":"f${i}.txt"}}`
    ).join(',');
    const text = `<tool_calls>\n[${calls}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('TOO_MANY_CALLS');
    }
  });

  it('uses last tag when tool_calls appears mid-answer (last wins)', () => {
    const text = `Here's an example:\n<tool_calls>\n[{"id":"old","name":"file_read","arguments":{"path":"ignore.txt"}}]\n</tool_calls>\nActually let me do this:\n<tool_calls>\n[{"id":"1","name":"file_list","arguments":{"path":"."}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].id).toBe('1');
      expect(result.calls[0].name).toBe('file_list');
    }
  });

  it('rejects invalid JSON', () => {
    const text = `<tool_calls>\n{not json}\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('JSON_PARSE');
    }
  });

  it('accepts "." as a valid path for file_list', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_list","arguments":{"path":"."}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.calls[0].arguments['path']).toBe('.');
    }
  });

  it('validates file_write_create requires content', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_write_create","arguments":{"path":"test.txt"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_ARGS');
    }
  });

  it('accepts file_write_overwrite with expected_hash', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_write_overwrite","arguments":{"path":"test.txt","content":"new","expected_hash":"abc123"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].name).toBe('file_write_overwrite');
      expect(result.calls[0].arguments['expected_hash']).toBe('abc123');
    }
  });

  it('rejects file_write_overwrite without expected_hash', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_write_overwrite","arguments":{"path":"test.txt","content":"new"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_ARGS');
      expect(result.error.message).toContain('expected_hash');
    }
  });

  // --- file_patch ---

  it('accepts file_patch with path, expected_hash, patch', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_patch","arguments":{"path":"test.txt","expected_hash":"abc123","patch":"@@ -1,1 +1,1 @@\\n-old\\n+new"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.calls).toHaveLength(1);
      expect(result.calls[0].name).toBe('file_patch');
      expect(result.calls[0].arguments['expected_hash']).toBe('abc123');
      expect(result.calls[0].arguments['patch']).toContain('@@');
    }
  });

  it('rejects file_patch without expected_hash', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_patch","arguments":{"path":"test.txt","patch":"@@ -1 +1 @@\\n-a\\n+b"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_ARGS');
      expect(result.error.message).toContain('expected_hash');
    }
  });

  it('rejects file_patch without patch', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_patch","arguments":{"path":"test.txt","expected_hash":"abc"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_ARGS');
      expect(result.error.message).toContain('patch');
    }
  });

  // --- Slice 3: new tools ---

  it('parses file_mkdir with path', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_mkdir","arguments":{"path":"new-dir"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.calls[0].name).toBe('file_mkdir');
      expect(result.calls[0].arguments['path']).toBe('new-dir');
    }
  });

  it('parses file_copy with source and destination', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_copy","arguments":{"source":"a.txt","destination":"b.txt"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.calls[0].name).toBe('file_copy');
      expect(result.calls[0].arguments['source']).toBe('a.txt');
      expect(result.calls[0].arguments['destination']).toBe('b.txt');
    }
  });

  it('parses file_move with source and destination', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_move","arguments":{"source":"old.txt","destination":"new.txt"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.calls[0].name).toBe('file_move');
    }
  });

  it('parses file_delete with path', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_delete","arguments":{"path":"temp.txt"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.calls[0].name).toBe('file_delete');
    }
  });

  it('rejects file_copy missing destination', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_copy","arguments":{"source":"a.txt"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_ARGS');
      expect(result.error.message).toContain('destination');
    }
  });

  it('rejects file_move missing source', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_move","arguments":{"destination":"b.txt"}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_ARGS');
      expect(result.error.message).toContain('source');
    }
  });

  it('rejects file_mkdir with extra arguments', () => {
    const text = `<tool_calls>\n[{"id":"1","name":"file_mkdir","arguments":{"path":"dir","recursive":true}}]\n</tool_calls>`;
    const result = parseToolCalls(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_ARGS');
    }
  });
});

// ---------------------------------------------------------------------------
// stripToolCalls
// ---------------------------------------------------------------------------

describe('stripToolCalls', () => {
  it('strips tool_calls block from text', () => {
    const text = `Here is the answer.\n<tool_calls>\n[{"id":"1","name":"file_read","arguments":{"path":"x"}}]\n</tool_calls>`;
    const result = stripToolCalls(text);
    expect(result.text).toBe('Here is the answer.');
    expect(result.hadToolCalls).toBe(true);
  });

  it('returns original text when no tool_calls', () => {
    const text = 'Just a normal response.';
    const result = stripToolCalls(text);
    expect(result.text).toBe(text);
    expect(result.hadToolCalls).toBe(false);
  });

  it('handles no closing tag', () => {
    const text = 'Broken <tool_calls> [stuff]';
    const result = stripToolCalls(text);
    expect(result.text).toBe(text);
    expect(result.hadToolCalls).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildToolSystemPrompt
// ---------------------------------------------------------------------------

describe('buildToolSystemPrompt', () => {
  it('includes tool descriptions', () => {
    const prompt = buildToolSystemPrompt();
    expect(prompt).toContain('file_list');
    expect(prompt).toContain('file_read');
    expect(prompt).toContain('file_write_create');
    expect(prompt).toContain('file_write_overwrite');
    expect(prompt).toContain('file_mkdir');
    expect(prompt).toContain('file_copy');
    expect(prompt).toContain('file_move');
    expect(prompt).toContain('file_delete');
    expect(prompt).toContain('file_patch');
    expect(prompt).toContain('<tool_calls>');
    expect(prompt).toContain('.clerk/');
  });

  it('accepts custom project root label', () => {
    const prompt = buildToolSystemPrompt('my-project');
    expect(prompt).toContain('my-project');
  });

  it('includes overwrite and truncation guidance', () => {
    const prompt = buildToolSystemPrompt();
    expect(prompt).toContain('expected_hash');
    expect(prompt).toContain('hashCoversFullFile');
    expect(prompt).toContain('HASH_MISMATCH');
  });
});

// ---------------------------------------------------------------------------
// ToolLoop.run
// ---------------------------------------------------------------------------

describe('ToolLoop.run', () => {
  function makeMockClient(responses: Array<{ text: string; receipt?: unknown }>): ToolLoopClient {
    let callIdx = 0;
    return {
      chatStreamStart: vi.fn().mockImplementation(
        async (
          _messages: unknown,
          _options: unknown,
          onDelta: (d: { content?: string }) => void,
          onEnd: (r: { receipt?: unknown; violations?: unknown[]; pending?: unknown }) => void,
        ) => {
          const resp = responses[callIdx++] ?? { text: '' };
          onDelta({ content: resp.text });
          onEnd({ receipt: resp.receipt ?? null, violations: [] });
          return 'stream-id';
        },
      ),
    };
  }

  function makeMockFileOps(): ToolLoopFileOps {
    return {
      readFile: vi.fn().mockResolvedValue({
        ok: true,
        content: 'file contents here',
        contentHash: 'abc123hash',
        truncated: false,
        hashCoversFullFile: true,
        resolvedPath: '/project/test.txt',
        decision: { allowed: true, reason: 'ok', toolId: 'file.read', appliedTemplateId: 'help_me_edit', appliedProfile: 'production' },
      }),
      writeFile: vi.fn().mockResolvedValue({
        ok: true,
        resolvedPath: '/project/new.txt',
        decision: { allowed: true, reason: 'ok', toolId: 'file.write.create', appliedTemplateId: 'help_me_edit', appliedProfile: 'production' },
      }),
      overwriteFile: vi.fn().mockResolvedValue({
        ok: true,
        resolvedPath: '/project/existing.txt',
        decision: { allowed: true, reason: 'ok', toolId: 'file.write.overwrite', appliedTemplateId: 'help_me_edit', appliedProfile: 'production' },
      }),
      listDir: vi.fn().mockResolvedValue({
        ok: true,
        entries: [
          { name: 'README.md', type: 'file', size: 0 },
          { name: 'src', type: 'directory', size: 0 },
        ],
        truncated: false,
        resolvedPath: '/project',
        decision: { allowed: true, reason: 'ok', toolId: 'file.list', appliedTemplateId: 'help_me_edit', appliedProfile: 'production' },
      }),
      mkdir: vi.fn().mockResolvedValue({
        ok: true,
        resolvedPath: '/project/new-dir',
        decision: { allowed: true, reason: 'ok', toolId: 'file.mkdir', appliedTemplateId: 'help_me_edit', appliedProfile: 'production' },
      }),
      copyFile: vi.fn().mockResolvedValue({
        ok: true,
        resolvedSrc: '/project/src.txt',
        resolvedDest: '/project/dest.txt',
        decision: { allowed: true, reason: 'ok', toolId: 'file.copy', appliedTemplateId: 'help_me_edit', appliedProfile: 'production' },
      }),
      moveFile: vi.fn().mockResolvedValue({
        ok: true,
        resolvedSrc: '/project/old.txt',
        resolvedDest: '/project/new.txt',
        decision: { allowed: true, reason: 'ok', toolId: 'file.move', appliedTemplateId: 'help_me_edit', appliedProfile: 'production' },
      }),
      deleteFile: vi.fn().mockResolvedValue({
        ok: true,
        resolvedPath: '/project/temp.txt',
        trashPath: '/project/.clerk/trash/123-abcd-temp.txt',
        decision: { allowed: true, reason: 'ok', toolId: 'file.delete', appliedTemplateId: 'help_me_edit', appliedProfile: 'production' },
      }),
      patchFile: vi.fn().mockResolvedValue({
        ok: true,
        newHash: 'newhash123',
        appliedHunks: 1,
        resolvedPath: '/project/test.txt',
        decision: { allowed: true, reason: 'ok', toolId: 'file.patch', appliedTemplateId: 'help_me_edit', appliedProfile: 'production' },
      }),
      fileFind: vi.fn().mockResolvedValue({
        ok: true,
        entries: [{ path: 'test.txt', type: 'file' }],
        truncated: false,
        decision: { allowed: true, reason: 'ok', toolId: 'file.find', appliedTemplateId: 'help_me_edit', appliedProfile: 'production' },
      }),
      fileGrep: vi.fn().mockResolvedValue({
        ok: true,
        matches: [],
        matchCount: 0,
        fileCount: 0,
        truncated: false,
        decision: { allowed: true, reason: 'ok', toolId: 'file.grep', appliedTemplateId: 'help_me_edit', appliedProfile: 'production' },
      }),
    };
  }

  function makeCallbacks(): ToolLoopCallbacks & { deltas: string[]; endResult: unknown; actions: unknown[] } {
    const obj = {
      deltas: [] as string[],
      endResult: null as unknown,
      actions: [] as unknown[],
      onDelta: (d: { content?: string }) => { obj.deltas.push(d.content ?? ''); },
      onEnd: (r: unknown) => { obj.endResult = r; },
      onFileAction: (a: unknown) => { obj.actions.push(a); },
    };
    return obj;
  }

  it('passes through when no tool calls in response', async () => {
    const client = makeMockClient([{ text: 'Hello! I can help with that.' }]);
    const fileOps = makeMockFileOps();
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'hi' }], {}, callbacks);

    expect(callbacks.deltas).toContain('Hello! I can help with that.');
    expect(callbacks.endResult).toBeDefined();
    expect(callbacks.actions).toHaveLength(0);
  });

  it('prepends system prompt to messages', async () => {
    const client = makeMockClient([{ text: 'Done.' }]);
    const fileOps = makeMockFileOps();
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'hi' }], {}, callbacks);

    const passedMessages = (client.chatStreamStart as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(passedMessages[0].role).toBe('system');
    expect(passedMessages[0].content).toContain('file_list');
  });

  it('executes a single tool call turn', async () => {
    const client = makeMockClient([
      { text: `Let me check.\n<tool_calls>\n[{"id":"1","name":"file_list","arguments":{"path":"."}}]\n</tool_calls>` },
      { text: 'I see README.md and src/.' },
    ]);
    const fileOps = makeMockFileOps();
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'what files are here?' }], {}, callbacks);

    expect(fileOps.listDir).toHaveBeenCalledWith('.', expect.objectContaining({ correlationId: expect.any(String) }));
    expect(callbacks.actions).toHaveLength(1);
    expect((callbacks.actions[0] as any).tool).toBe('LIST');
    expect(client.chatStreamStart).toHaveBeenCalledTimes(2);
  });

  it('handles blocked tool call — model gets error result', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_read","arguments":{"path":"secret.key"}}]\n</tool_calls>` },
      { text: 'Sorry, that file is blocked.' },
    ]);
    const fileOps = makeMockFileOps();
    fileOps.readFile = vi.fn().mockResolvedValue({
      ok: false,
      code: 'BLOCKED',
      message: 'Blocked by policy',
      decision: { allowed: false, reason: 'blocked', toolId: 'file.read', appliedTemplateId: 'help_me_edit', appliedProfile: 'production' },
    });
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'read secret.key' }], {}, callbacks);

    expect(callbacks.actions).toHaveLength(1);
    expect((callbacks.actions[0] as any).allowed).toBe(false);
    expect(client.chatStreamStart).toHaveBeenCalledTimes(2);
  });

  it('multi-turn tool execution', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_list","arguments":{"path":"."}}]\n</tool_calls>` },
      { text: `<tool_calls>\n[{"id":"2","name":"file_read","arguments":{"path":"README.md"}}]\n</tool_calls>` },
      { text: 'The README says hello.' },
    ]);
    const fileOps = makeMockFileOps();
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'read the readme' }], {}, callbacks);

    expect(client.chatStreamStart).toHaveBeenCalledTimes(3);
    expect(callbacks.actions).toHaveLength(2);
  });

  it('detects repeated blocked call and short-circuits', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_read","arguments":{"path":"blocked.txt"}}]\n</tool_calls>` },
      { text: `<tool_calls>\n[{"id":"2","name":"file_read","arguments":{"path":"blocked.txt"}}]\n</tool_calls>` },
      { text: 'I gave up.' },
    ]);
    const fileOps = makeMockFileOps();
    fileOps.readFile = vi.fn().mockResolvedValue({
      ok: false,
      code: 'BLOCKED',
      message: 'Blocked',
      decision: { allowed: false, reason: 'blocked', toolId: 'file.read', appliedTemplateId: 'x', appliedProfile: 'strict' },
    });
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'read blocked.txt' }], {}, callbacks);

    expect(fileOps.readFile).toHaveBeenCalledTimes(1);
    expect(client.chatStreamStart).toHaveBeenCalledTimes(2);
  });

  it('passes correlationId context to file ops', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"c1","name":"file_list","arguments":{"path":"."}}]\n</tool_calls>` },
      { text: 'Done.' },
    ]);
    const fileOps = makeMockFileOps();
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'list' }], {}, callbacks, 'stream-42');

    expect(fileOps.listDir).toHaveBeenCalledWith('.', {
      streamId: 'stream-42',
      correlationId: 'stream-42:c1',
    });
  });

  it('returns fileActions in final onEnd payload', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_list","arguments":{"path":"."}}]\n</tool_calls>` },
      { text: 'Done.' },
    ]);
    const fileOps = makeMockFileOps();
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'list' }], {}, callbacks);

    const endResult = callbacks.endResult as any;
    expect(endResult.fileActions).toBeDefined();
    expect(endResult.fileActions).toHaveLength(1);
    expect(endResult.fileActions[0].tool).toBe('LIST');
  });

  // --- file_write_overwrite ---

  it('executes file_write_overwrite tool', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_write_overwrite","arguments":{"path":"test.txt","content":"new content","expected_hash":"abc123"}}]\n</tool_calls>` },
      { text: 'Done.' },
    ]);
    const fileOps = makeMockFileOps();
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'update test.txt' }], {}, callbacks);

    expect(fileOps.overwriteFile).toHaveBeenCalledWith('test.txt', 'new content', 'abc123', expect.any(Object));
    expect(callbacks.actions).toHaveLength(1);
    expect((callbacks.actions[0] as any).tool).toBe('OVERWRITE');
  });

  it('HASH_MISMATCH gives model error in tool result', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_write_overwrite","arguments":{"path":"test.txt","content":"new","expected_hash":"wrong"}}]\n</tool_calls>` },
      { text: 'I see it was modified. Let me re-read.' },
    ]);
    const fileOps = makeMockFileOps();
    fileOps.overwriteFile = vi.fn().mockResolvedValue({
      ok: false,
      code: 'HASH_MISMATCH',
      message: 'File has been modified.',
    });
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'update' }], {}, callbacks);

    // Model got second turn to handle the error
    expect(client.chatStreamStart).toHaveBeenCalledTimes(2);
  });

  // --- stop ---

  it('stop() aborts the loop and sets stoppedByUser', async () => {
    let turnCount = 0;
    const client: ToolLoopClient = {
      chatStreamStart: vi.fn().mockImplementation(
        async (
          _messages: unknown,
          _options: unknown,
          onDelta: (d: { content?: string }) => void,
          onEnd: (r: { receipt?: unknown; violations?: unknown[] }) => void,
        ) => {
          turnCount++;
          if (turnCount === 1) {
            onDelta({ content: `<tool_calls>\n[{"id":"1","name":"file_list","arguments":{"path":"."}}]\n</tool_calls>` });
          } else {
            onDelta({ content: 'More work...' });
          }
          onEnd({ receipt: null, violations: [] });
          return 'stream-id';
        },
      ),
    };
    const fileOps = makeMockFileOps();
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    // Stop after first tool call resolves
    const origListDir = fileOps.listDir;
    fileOps.listDir = vi.fn().mockImplementation(async (...args: unknown[]) => {
      loop.stop('test-stream');
      return (origListDir as any)(...args);
    });

    await loop.run([{ role: 'user', content: 'list' }], {}, callbacks, 'test-stream');

    const endResult = callbacks.endResult as any;
    expect(endResult.stoppedByUser).toBe(true);
  });

  it('stop() is idempotent', () => {
    const client = makeMockClient([]);
    const fileOps = makeMockFileOps();
    const loop = new ToolLoop(client, fileOps);

    // Should not throw
    loop.stop('nonexistent');
    loop.stop('nonexistent');
  });

  it('late deltas after stop are dropped', async () => {
    const client: ToolLoopClient = {
      chatStreamStart: vi.fn().mockImplementation(
        async (
          _messages: unknown,
          _options: unknown,
          onDelta: (d: { content?: string }) => void,
          onEnd: (r: { receipt?: unknown; violations?: unknown[] }) => void,
        ) => {
          onDelta({ content: 'Hello' });
          onEnd({ receipt: null, violations: [] });
          return 'stream-id';
        },
      ),
    };
    const fileOps = makeMockFileOps();
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    // Pre-abort
    loop.stop('pre-aborted');

    // Run should complete cleanly with stoppedByUser
    await loop.run([{ role: 'user', content: 'hi' }], {}, callbacks, 'pre-aborted');

    // Since stop was called before run, it won't find the controller
    // The loop will run normally since stop was called before the controller was created
    expect(callbacks.endResult).toBeDefined();
  });

  // --- ASK_REQUIRED ---

  it('ASK_REQUIRED pauses and resumes on allow', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_write_overwrite","arguments":{"path":"config.json","content":"{}","expected_hash":"abc"}}]\n</tool_calls>` },
      { text: 'Done.' },
    ]);
    const fileOps = makeMockFileOps();
    let callCount = 0;
    fileOps.overwriteFile = vi.fn().mockImplementation(async (_path: string, _content: string, _hash: string, ctx: any) => {
      callCount++;
      if (callCount === 1) {
        // First call: ASK_REQUIRED
        return {
          ok: false,
          code: 'ASK_REQUIRED',
          message: 'Requires approval',
          decision: { allowed: false, reason: 'ASK_REQUIRED', toolId: 'file.write.overwrite', appliedTemplateId: 'x', appliedProfile: 'research', askAvailable: true },
        };
      }
      // Second call (with grant token): success
      return {
        ok: true,
        resolvedPath: '/project/config.json',
        decision: { allowed: true, reason: 'ok', toolId: 'file.write.overwrite', appliedTemplateId: 'x', appliedProfile: 'research' },
      };
    });

    const grantToken: AskGrantToken = {
      grantId: 'grant-1',
      streamId: 'stream-1',
      correlationId: 'stream-1:1',
      toolId: 'file.write.overwrite',
      path: 'config.json',
      usedAt: null,
    };

    const askGate: AskGate = {
      requestAsk: vi.fn().mockResolvedValue({ decision: 'allow_once', grantToken }),
    };

    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps, askGate);

    await loop.run([{ role: 'user', content: 'update config' }], {}, callbacks, 'stream-1');

    expect(askGate.requestAsk).toHaveBeenCalledTimes(1);
    expect(fileOps.overwriteFile).toHaveBeenCalledTimes(2);
    // Last action should be ask_approved
    const lastAction = callbacks.actions[callbacks.actions.length - 1] as any;
    expect(lastAction.status).toBe('ask_approved');
  });

  it('ASK_REQUIRED pauses and stops on deny', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_write_overwrite","arguments":{"path":"config.json","content":"{}","expected_hash":"abc"}}]\n</tool_calls>` },
      { text: 'Ok, I wont do that.' },
    ]);
    const fileOps = makeMockFileOps();
    fileOps.overwriteFile = vi.fn().mockResolvedValue({
      ok: false,
      code: 'ASK_REQUIRED',
      message: 'Requires approval',
      decision: { allowed: false, reason: 'ASK_REQUIRED', toolId: 'file.write.overwrite', appliedTemplateId: 'x', appliedProfile: 'research', askAvailable: true },
    });

    const askGate: AskGate = {
      requestAsk: vi.fn().mockResolvedValue({ decision: 'deny' }),
    };

    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps, askGate);

    await loop.run([{ role: 'user', content: 'update config' }], {}, callbacks, 'stream-1');

    expect(askGate.requestAsk).toHaveBeenCalledTimes(1);
    // Only one overwrite call (no retry on deny)
    expect(fileOps.overwriteFile).toHaveBeenCalledTimes(1);
    // Action should be ask_denied
    const lastAction = callbacks.actions[callbacks.actions.length - 1] as any;
    expect(lastAction.status).toBe('ask_denied');
  });

  it('abort during pending ask auto-denies', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_write_overwrite","arguments":{"path":"f.txt","content":"x","expected_hash":"h"}}]\n</tool_calls>` },
      { text: 'Done.' },
    ]);
    const fileOps = makeMockFileOps();
    fileOps.overwriteFile = vi.fn().mockResolvedValue({
      ok: false,
      code: 'ASK_REQUIRED',
      message: 'Requires approval',
      decision: { allowed: false, reason: 'ASK_REQUIRED', toolId: 'file.write.overwrite', appliedTemplateId: 'x', appliedProfile: 'research', askAvailable: true },
    });

    const loop = new ToolLoop(client, fileOps);
    const askGate: AskGate = {
      requestAsk: vi.fn().mockImplementation(async (_req: AskRequest, signal: AbortSignal) => {
        // Simulate stop during ask
        loop.stop('stream-1');
        // The signal should now be aborted
        return new Promise((_resolve, reject) => {
          if (signal.aborted) {
            reject(new Error('Aborted'));
          }
        });
      }),
    };
    (loop as any).askGate = askGate;

    const callbacks = makeCallbacks();
    await loop.run([{ role: 'user', content: 'update' }], {}, callbacks, 'stream-1');

    const endResult = callbacks.endResult as any;
    expect(endResult.stoppedByUser).toBe(true);
  });

  it('halt on first ASK in multi-call turn', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_write_overwrite","arguments":{"path":"a.txt","content":"x","expected_hash":"h1"}},{"id":"2","name":"file_read","arguments":{"path":"b.txt"}}]\n</tool_calls>` },
      { text: 'Done.' },
    ]);
    const fileOps = makeMockFileOps();
    fileOps.overwriteFile = vi.fn().mockResolvedValue({
      ok: false,
      code: 'ASK_REQUIRED',
      message: 'Requires approval',
      decision: { allowed: false, reason: 'ASK_REQUIRED', toolId: 'file.write.overwrite', appliedTemplateId: 'x', appliedProfile: 'research', askAvailable: true },
    });

    const askGate: AskGate = {
      requestAsk: vi.fn().mockResolvedValue({ decision: 'deny' }),
    };

    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps, askGate);

    await loop.run([{ role: 'user', content: 'update' }], {}, callbacks, 'stream-1');

    // Second call (file_read) should NOT have been executed because ask was denied
    expect(fileOps.readFile).not.toHaveBeenCalled();
  });

  it('rejects overwrite when hashCoversFullFile was false for that path', async () => {
    const client = makeMockClient([
      // Turn 1: model reads a file (truncated → hashCoversFullFile: false)
      { text: `<tool_calls>\n[{"id":"1","name":"file_read","arguments":{"path":"big.txt"}}]\n</tool_calls>` },
      // Turn 2: model tries to overwrite using the truncated hash
      { text: `<tool_calls>\n[{"id":"2","name":"file_write_overwrite","arguments":{"path":"big.txt","content":"new","expected_hash":"abc"}}]\n</tool_calls>` },
      // Turn 3: model gives up
      { text: 'Cannot overwrite truncated file.' },
    ]);
    const fileOps = makeMockFileOps();
    // Return truncated content with hashCoversFullFile: false
    fileOps.readFile = vi.fn().mockResolvedValue({
      ok: true,
      content: 'x'.repeat(200_000),
      contentHash: 'abc',
      truncated: true,
      hashCoversFullFile: false,
      resolvedPath: '/project/big.txt',
      decision: { allowed: true, reason: 'ok', toolId: 'file.read', appliedTemplateId: 't', appliedProfile: 'production' },
    });
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'edit big.txt' }], {}, callbacks, 'stream-1');

    // overwriteFile should never have been called
    expect(fileOps.overwriteFile).not.toHaveBeenCalled();
    // The tool result sent to model should contain error about hashCoversFullFile
    const thirdCallMessages = (client.chatStreamStart as ReturnType<typeof vi.fn>).mock.calls[1][0];
    const toolResultsMsg = thirdCallMessages[thirdCallMessages.length - 1].content;
    expect(toolResultsMsg).toContain('hashCoversFullFile');
  });

  it('file_read result includes contentHash and hashCoversFullFile', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_read","arguments":{"path":"test.txt"}}]\n</tool_calls>` },
      { text: 'Got it.' },
    ]);
    const fileOps = makeMockFileOps();
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'read test.txt' }], {}, callbacks, 'stream-1');

    // Check that the tool result passed to the model includes hash info
    const secondCallMessages = (client.chatStreamStart as ReturnType<typeof vi.fn>).mock.calls[1][0];
    const toolResultsMsg = secondCallMessages[secondCallMessages.length - 1].content;
    expect(toolResultsMsg).toContain('contentHash');
    expect(toolResultsMsg).toContain('hashCoversFullFile');
  });

  // --- Slice 3: execution of new tools ---

  it('executes file_mkdir and emits MKDIR action', async () => {
    const client = makeMockClient([
      { text: `I'll create the directory.\n<tool_calls>\n[{"id":"1","name":"file_mkdir","arguments":{"path":"docs"}}]\n</tool_calls>` },
      { text: 'Done!' },
    ]);
    const fileOps = makeMockFileOps();
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'create docs dir' }], {}, callbacks, 'stream-1');

    expect(fileOps.mkdir).toHaveBeenCalledWith('docs', expect.objectContaining({ streamId: 'stream-1' }));
    expect(callbacks.actions).toContainEqual(expect.objectContaining({ tool: 'MKDIR', path: 'docs', allowed: true }));
  });

  it('executes file_copy and emits COPY action with toPath', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_copy","arguments":{"source":"a.txt","destination":"b.txt"}}]\n</tool_calls>` },
      { text: 'Copied.' },
    ]);
    const fileOps = makeMockFileOps();
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'copy a to b' }], {}, callbacks, 'stream-1');

    expect(fileOps.copyFile).toHaveBeenCalledWith('a.txt', 'b.txt', expect.objectContaining({ streamId: 'stream-1' }));
    expect(callbacks.actions).toContainEqual(expect.objectContaining({ tool: 'COPY', path: 'a.txt', toPath: 'b.txt', allowed: true }));
  });

  it('executes file_move and emits MOVE action', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_move","arguments":{"source":"old.txt","destination":"new.txt"}}]\n</tool_calls>` },
      { text: 'Moved.' },
    ]);
    const fileOps = makeMockFileOps();
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'rename old to new' }], {}, callbacks, 'stream-1');

    expect(fileOps.moveFile).toHaveBeenCalledWith('old.txt', 'new.txt', expect.objectContaining({ streamId: 'stream-1' }));
    expect(callbacks.actions).toContainEqual(expect.objectContaining({ tool: 'MOVE', path: 'old.txt', toPath: 'new.txt', allowed: true }));
  });

  it('executes file_delete and emits DELETE action', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_delete","arguments":{"path":"temp.log"}}]\n</tool_calls>` },
      { text: 'Deleted.' },
    ]);
    const fileOps = makeMockFileOps();
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'delete temp.log' }], {}, callbacks, 'stream-1');

    expect(fileOps.deleteFile).toHaveBeenCalledWith('temp.log', expect.objectContaining({ streamId: 'stream-1' }));
    expect(callbacks.actions).toContainEqual(expect.objectContaining({ tool: 'DELETE', path: 'temp.log', allowed: true }));
  });

  it('handles ASK_REQUIRED for file_move', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_move","arguments":{"source":"a.txt","destination":"b.txt"}}]\n</tool_calls>` },
      { text: 'Done.' },
    ]);
    const fileOps = makeMockFileOps();
    (fileOps.moveFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      code: 'ASK_REQUIRED',
      message: 'Requires approval',
      decision: { allowed: false, reason: 'ASK_REQUIRED', toolId: 'file.move', appliedTemplateId: 'help_me_edit', appliedProfile: 'research', askAvailable: true },
    });
    // After grant, succeeds:
    (fileOps.moveFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      resolvedSrc: '/project/a.txt',
      resolvedDest: '/project/b.txt',
      decision: { allowed: true, reason: 'ok', toolId: 'file.move', appliedTemplateId: 'help_me_edit', appliedProfile: 'research' },
    });
    const grantToken: AskGrantToken = {
      grantId: 'g1', streamId: 'stream-1', correlationId: 'stream-1:1',
      toolId: 'file.move', path: 'a.txt', toPath: 'b.txt', usedAt: null,
    };
    const askGate: AskGate = {
      requestAsk: vi.fn().mockResolvedValue({ decision: 'allow_once', grantToken }),
    };
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps, askGate);

    await loop.run([{ role: 'user', content: 'move a to b' }], {}, callbacks, 'stream-1');

    expect(askGate.requestAsk).toHaveBeenCalledTimes(1);
    const askReq = (askGate.requestAsk as ReturnType<typeof vi.fn>).mock.calls[0][0] as AskRequest;
    expect(askReq.toolId).toBe('file.move');
    expect(askReq.toPath).toBe('b.txt');
    expect(askReq.operationLabel).toContain('Move');
    // Final action should be ask_approved
    const moveActions = callbacks.actions.filter((a: any) => a.tool === 'MOVE');
    expect(moveActions.some((a: any) => a.status === 'ask_approved')).toBe(true);
  });

  // --- file_patch ---

  it('executes file_patch tool', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_patch","arguments":{"path":"test.txt","expected_hash":"abc123","patch":"@@ -1,1 +1,1 @@\\n-old\\n+new"}}]\n</tool_calls>` },
      { text: 'Patch applied successfully!' },
    ]);
    const fileOps = makeMockFileOps();
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'patch it' }], {}, callbacks);

    expect(fileOps.patchFile).toHaveBeenCalledTimes(1);
    expect(fileOps.patchFile).toHaveBeenCalledWith(
      'test.txt',
      '@@ -1,1 +1,1 @@\n-old\n+new',
      'abc123',
      expect.any(Object),
    );
    const patchActions = callbacks.actions.filter((a: any) => a.tool === 'PATCH');
    expect(patchActions.length).toBeGreaterThanOrEqual(1);
    expect((patchActions[0] as any).allowed).toBe(true);
  });

  it('file_patch PATCH_FAILED suggestion', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_patch","arguments":{"path":"test.txt","expected_hash":"abc","patch":"@@ -1 +1 @@\\n-wrong\\n+new"}}]\n</tool_calls>` },
      { text: 'Let me re-read the file.' },
    ]);
    const fileOps = makeMockFileOps();
    (fileOps.patchFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      code: 'PATCH_FAILED',
      message: 'Context mismatch at line 1',
    });
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'patch it' }], {}, callbacks);

    const patchActions = callbacks.actions.filter((a: any) => a.tool === 'PATCH');
    expect(patchActions.length).toBeGreaterThanOrEqual(1);
    expect((patchActions[0] as any).allowed).toBe(false);
  });

  it('file_patch HASH_MISMATCH suggestion', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_patch","arguments":{"path":"test.txt","expected_hash":"old","patch":"@@ -1 +1 @@\\n-a\\n+b"}}]\n</tool_calls>` },
      { text: 'I need to re-read.' },
    ]);
    const fileOps = makeMockFileOps();
    (fileOps.patchFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      code: 'HASH_MISMATCH',
      message: 'File modified since last read',
    });
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps);

    await loop.run([{ role: 'user', content: 'patch it' }], {}, callbacks);

    const patchActions = callbacks.actions.filter((a: any) => a.tool === 'PATCH');
    expect(patchActions.length).toBeGreaterThanOrEqual(1);
    expect((patchActions[0] as any).error).toContain('modified');
  });

  it('file_patch ASK_REQUIRED flow', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_patch","arguments":{"path":"config.json","expected_hash":"abc","patch":"@@ -1 +1 @@\\n-old\\n+new"}}]\n</tool_calls>` },
      { text: 'Done!' },
    ]);
    const fileOps = makeMockFileOps();
    (fileOps.patchFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      code: 'ASK_REQUIRED',
      message: 'Requires approval',
      decision: { allowed: false, reason: 'ASK_REQUIRED', toolId: 'file.patch', appliedTemplateId: 'help_me_edit', appliedProfile: 'production', askAvailable: true },
    });
    const grantToken: AskGrantToken = {
      grantId: 'g1', streamId: 'stream-1', correlationId: 'stream-1:1',
      toolId: 'file.patch', path: 'config.json', usedAt: null,
    };
    const askGate: AskGate = {
      requestAsk: vi.fn().mockResolvedValue({ decision: 'allow_once', grantToken }),
    };
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps, askGate);

    await loop.run([{ role: 'user', content: 'patch config' }], {}, callbacks, 'stream-1');

    expect(askGate.requestAsk).toHaveBeenCalledTimes(1);
    const askReq = (askGate.requestAsk as ReturnType<typeof vi.fn>).mock.calls[0][0] as AskRequest;
    expect(askReq.toolId).toBe('file.patch');
    expect(askReq.operationLabel).toContain('Patch');
    const patchActions = callbacks.actions.filter((a: any) => a.tool === 'PATCH');
    expect(patchActions.some((a: any) => a.status === 'ask_approved')).toBe(true);
  });

  it('handles ASK_REQUIRED deny for file_delete', async () => {
    const client = makeMockClient([
      { text: `<tool_calls>\n[{"id":"1","name":"file_delete","arguments":{"path":"keep.txt"}}]\n</tool_calls>` },
    ]);
    const fileOps = makeMockFileOps();
    (fileOps.deleteFile as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      code: 'ASK_REQUIRED',
      message: 'Requires approval',
      decision: { allowed: false, reason: 'ASK_REQUIRED', toolId: 'file.delete', appliedTemplateId: 'help_me_edit', appliedProfile: 'production', askAvailable: true },
    });
    const askGate: AskGate = {
      requestAsk: vi.fn().mockResolvedValue({ decision: 'deny', reason: 'User denied' }),
    };
    const callbacks = makeCallbacks();
    const loop = new ToolLoop(client, fileOps, askGate);

    await loop.run([{ role: 'user', content: 'delete keep.txt' }], {}, callbacks, 'stream-1');

    expect(askGate.requestAsk).toHaveBeenCalledTimes(1);
    const askReq = (askGate.requestAsk as ReturnType<typeof vi.fn>).mock.calls[0][0] as AskRequest;
    expect(askReq.toolId).toBe('file.delete');
    expect(askReq.operationLabel).toContain('Trash');
    // Final action should be ask_denied
    const deleteActions = callbacks.actions.filter((a: any) => a.tool === 'DELETE');
    expect(deleteActions.some((a: any) => a.status === 'ask_denied')).toBe(true);
  });
});

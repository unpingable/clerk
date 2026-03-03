// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import {
  parseToolCalls,
  stripToolCalls,
  buildToolSystemPrompt,
  ToolLoop,
} from '../../src/main/tool-loop';
import type { ToolLoopClient, ToolLoopFileOps, ToolLoopCallbacks } from '../../src/main/tool-loop';

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
    const text = `<tool_calls>\n[{"id":"1","name":"file_delete","arguments":{"path":"x"}}]\n</tool_calls>`;
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
    expect(prompt).toContain('<tool_calls>');
  });

  it('accepts custom project root label', () => {
    const prompt = buildToolSystemPrompt('my-project');
    expect(prompt).toContain('my-project');
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
          // Simulate streaming the text in one chunk
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
        resolvedPath: '/project/test.txt',
        decision: { allowed: true, reason: 'ok', toolId: 'file.read', appliedTemplateId: 'help_me_edit', appliedProfile: 'production' },
      }),
      writeFile: vi.fn().mockResolvedValue({
        ok: true,
        resolvedPath: '/project/new.txt',
        decision: { allowed: true, reason: 'ok', toolId: 'file.write.create', appliedTemplateId: 'help_me_edit', appliedProfile: 'production' },
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

    expect(fileOps.listDir).toHaveBeenCalledWith('.');
    expect(callbacks.actions).toHaveLength(1);
    expect((callbacks.actions[0] as any).tool).toBe('LIST');
    // Two daemon turns
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
    // Model got a second turn with the error
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

    // First call: tool executed + blocked. Second call: anti-thrash detected, short-circuits.
    expect(fileOps.readFile).toHaveBeenCalledTimes(1);
    // Two daemon turns: first with tool call, second triggers anti-thrash break
    expect(client.chatStreamStart).toHaveBeenCalledTimes(2);
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
});

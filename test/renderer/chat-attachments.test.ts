// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the api module before importing chat store
vi.mock('$lib/api', () => ({
  api: {
    chatStreamStart: vi.fn().mockResolvedValue({ streamId: 'test-stream' }),
    chatStreamStop: vi.fn(),
    chatModels: vi.fn().mockResolvedValue([]),
    commitFix: vi.fn(),
    commitRevise: vi.fn(),
    commitProceed: vi.fn(),
    askRespond: vi.fn(),
    readAbsoluteFile: vi.fn(),
  },
}));

import { api } from '$lib/api';
import * as chat from '../../src/renderer/stores/chat.svelte';

const mockApi = api as unknown as {
  readAbsoluteFile: ReturnType<typeof vi.fn>;
  chatStreamStart: ReturnType<typeof vi.fn>;
};

describe('chat attachment actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chat.clearAttachments();
    chat.clearMessages();
    // Reset streaming state (may have been left on by previous test)
    chat.state.streaming = false;
    chat.state.currentStreamId = null;
    chat.state.error = null;
  });

  it('attachFile reads via IPC and adds to pending', async () => {
    mockApi.readAbsoluteFile.mockResolvedValue({
      ok: true,
      content: 'hello',
      contentHash: 'abc',
      size: 5,
    });

    const result = await chat.attachFile('/tmp/test.txt');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attachment.name).toBe('test.txt');
      expect(result.attachment.size).toBe(5);
    }
    expect(chat.getPendingAttachments()).toHaveLength(1);
  });

  it('attachFile dedupes by path', async () => {
    mockApi.readAbsoluteFile.mockResolvedValue({
      ok: true,
      content: 'hello',
      contentHash: 'abc',
      size: 5,
    });

    await chat.attachFile('/tmp/test.txt');
    await chat.attachFile('/tmp/test.txt');
    expect(chat.getPendingAttachments()).toHaveLength(1);
    // Only one IPC call for the first attach
    expect(mockApi.readAbsoluteFile).toHaveBeenCalledTimes(1);
  });

  it('attachFile caps at 5', async () => {
    mockApi.readAbsoluteFile.mockResolvedValue({
      ok: true,
      content: 'x',
      contentHash: 'abc',
      size: 1,
    });

    for (let i = 0; i < 5; i++) {
      await chat.attachFile(`/tmp/file${i}.txt`);
    }
    expect(chat.getPendingAttachments()).toHaveLength(5);

    const result = await chat.attachFile('/tmp/file5.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/more than 5/i);
    }
    expect(chat.getPendingAttachments()).toHaveLength(5);
  });

  it('removeAttachment removes by path', async () => {
    mockApi.readAbsoluteFile.mockResolvedValue({
      ok: true,
      content: 'x',
      contentHash: 'abc',
      size: 1,
    });

    await chat.attachFile('/tmp/a.txt');
    await chat.attachFile('/tmp/b.txt');
    expect(chat.getPendingAttachments()).toHaveLength(2);

    chat.removeAttachment('/tmp/a.txt');
    expect(chat.getPendingAttachments()).toHaveLength(1);
    expect(chat.getPendingAttachments()[0].name).toBe('b.txt');
  });

  it('clearAttachments empties', async () => {
    mockApi.readAbsoluteFile.mockResolvedValue({
      ok: true,
      content: 'x',
      contentHash: 'abc',
      size: 1,
    });

    await chat.attachFile('/tmp/a.txt');
    await chat.attachFile('/tmp/b.txt');
    chat.clearAttachments();
    expect(chat.getPendingAttachments()).toHaveLength(0);
  });

  it('send() snapshots and clears pendingAttachments', async () => {
    mockApi.readAbsoluteFile.mockResolvedValue({
      ok: true,
      content: 'file data',
      contentHash: 'abc',
      size: 9,
    });

    await chat.attachFile('/tmp/test.txt');
    expect(chat.getPendingAttachments()).toHaveLength(1);

    await chat.send('analyze this');
    // Attachments should be cleared after send
    expect(chat.getPendingAttachments()).toHaveLength(0);
  });

  it('send() with attachments: message gets { name, size } metadata', async () => {
    mockApi.readAbsoluteFile.mockResolvedValue({
      ok: true,
      content: 'data',
      contentHash: 'def',
      size: 4,
    });

    await chat.attachFile('/tmp/report.csv');
    await chat.send('review');

    const msgs = chat.getMessages();
    const userMsg = msgs.find(m => m.role === 'user');
    expect(userMsg?.attachments).toEqual([{ name: 'report.csv', size: 4 }]);
  });

  it('send() allowed with attachments + empty text', async () => {
    mockApi.readAbsoluteFile.mockResolvedValue({
      ok: true,
      content: 'data',
      contentHash: 'def',
      size: 4,
    });

    await chat.attachFile('/tmp/test.txt');
    await chat.send('');

    const msgs = chat.getMessages();
    // Should have user message (even with empty text) + assistant placeholder
    expect(msgs.some(m => m.role === 'user')).toBe(true);
    expect(msgs.find(m => m.role === 'user')?.attachments).toHaveLength(1);
  });

  it('send() with no text and no attachments is a no-op', async () => {
    await chat.send('');
    expect(chat.getMessages()).toHaveLength(0);
  });

  it('attachFile propagates IPC errors', async () => {
    mockApi.readAbsoluteFile.mockResolvedValue({
      ok: false,
      error: "Folders can't be attached.",
    });

    const result = await chat.attachFile('/tmp/mydir');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/folders/i);
      expect(result.name).toBe('mydir');
    }
  });
});

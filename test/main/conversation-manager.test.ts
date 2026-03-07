// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from 'vitest';
import { ConversationManager } from '../../src/main/conversation-manager';
import { generateTitle, toPersistedMessage } from '../../src/shared/conversation-utils';
import type { ConversationManagerIO } from '../../src/main/conversation-manager';
import type { ChatMessage, ConversationData } from '../../src/shared/types';

// --- In-memory IO ---

function makeIO(): ConversationManagerIO & { files: Map<string, string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  return {
    files,
    readFileSync(p: string) {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    },
    writeFileSync(p: string, d: string) {
      files.set(p, d);
    },
    renameSync(s: string, d: string) {
      const content = files.get(s);
      if (content === undefined) throw new Error(`ENOENT: ${s}`);
      files.delete(s);
      files.set(d, content);
    },
    existsSync(p: string) {
      return files.has(p) || dirs.has(p);
    },
    mkdirSync(p: string) {
      dirs.add(p);
    },
    unlinkSync(p: string) {
      files.delete(p);
    },
  };
}

function makeConv(id: string, title: string, messageCount = 1): ConversationData {
  return {
    id,
    title,
    createdAt: 1000,
    updatedAt: 2000,
    messages: Array.from({ length: messageCount }, (_, i) => ({
      id: `msg-${i}`,
      role: 'user' as const,
      content: `Hello ${i}`,
      timestamp: 1000 + i,
    })),
  };
}

describe('ConversationManager', () => {
  let io: ReturnType<typeof makeIO>;
  let mgr: ConversationManager;

  beforeEach(() => {
    io = makeIO();
    mgr = new ConversationManager('/data', io);
  });

  it('returns empty list when no index', () => {
    const result = mgr.list();
    expect(result.conversations).toEqual([]);
    expect(result.activeId).toBeNull();
  });

  it('save + load round-trip', () => {
    const conv = makeConv('abc', 'Test Chat', 2);
    const saveResult = mgr.save(conv);
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) return;
    expect(saveResult.meta.id).toBe('abc');
    expect(saveResult.meta.messageCount).toBe(2);

    const loadResult = mgr.load('abc');
    expect(loadResult.ok).toBe(true);
    if (!loadResult.ok) return;
    expect(loadResult.conversation.id).toBe('abc');
    expect(loadResult.conversation.title).toBe('Test Chat');
    expect(loadResult.conversation.messages).toHaveLength(2);
  });

  it('list shows saved conversations', () => {
    mgr.save(makeConv('a', 'First'));
    mgr.save(makeConv('b', 'Second'));
    const { conversations } = mgr.list();
    expect(conversations).toHaveLength(2);
    expect(conversations.map(c => c.id)).toContain('a');
    expect(conversations.map(c => c.id)).toContain('b');
  });

  it('delete removes file + index entry', () => {
    mgr.save(makeConv('x', 'Delete me'));
    expect(mgr.list().conversations).toHaveLength(1);
    mgr.delete('x');
    expect(mgr.list().conversations).toHaveLength(0);
    expect(mgr.load('x').ok).toBe(false);
  });

  it('rename updates both index AND conversation file, including updatedAt', () => {
    const conv = makeConv('r', 'Old title');
    conv.updatedAt = 1000;
    mgr.save(conv);
    const result = mgr.rename('r', 'New title');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('New title');
    expect(result!.updatedAt).toBeGreaterThan(1000);

    // Index
    const { conversations } = mgr.list();
    expect(conversations[0].title).toBe('New title');
    expect(conversations[0].updatedAt).toBeGreaterThan(1000);

    // File
    const loaded = mgr.load('r');
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.conversation.title).toBe('New title');
      expect(loaded.conversation.updatedAt).toBeGreaterThan(1000);
    }
  });

  it('rename returns null for unknown id', () => {
    expect(mgr.rename('nope', 'title')).toBeNull();
  });

  it('setActive/getActiveId persistence', () => {
    mgr.save(makeConv('a1', 'A'));
    mgr.setActive('a1');
    expect(mgr.getActiveId()).toBe('a1');
    expect(mgr.list().activeId).toBe('a1');

    // New manager reads persisted index
    const mgr2 = new ConversationManager('/data', io);
    expect(mgr2.getActiveId()).toBe('a1');
  });

  it('corrupt index quarantine + recovery', () => {
    io.writeFileSync('/data/clerk-conversations.json', 'not json!!!');
    const mgr2 = new ConversationManager('/data', io);
    expect(mgr2.list().conversations).toEqual([]);
    // Corrupt file should be renamed
    const corruptFiles = [...io.files.keys()].filter(k => k.includes('.corrupt-'));
    expect(corruptFiles.length).toBe(1);
  });

  it('missing conversation file returns error', () => {
    // Manually add to index without saving file
    mgr.save(makeConv('ghost', 'Ghost'));
    io.files.delete('/data/conversations/ghost.json');
    const result = mgr.load('ghost');
    expect(result.ok).toBe(false);
  });

  it('delete clears activeId when deleting active', () => {
    mgr.save(makeConv('act', 'Active'));
    mgr.setActive('act');
    mgr.delete('act');
    expect(mgr.getActiveId()).toBeNull();
  });

  it('save updates existing index entry', () => {
    mgr.save(makeConv('upd', 'v1'));
    const updated = { ...makeConv('upd', 'v2', 3), updatedAt: 9999 };
    mgr.save(updated);
    const { conversations } = mgr.list();
    expect(conversations).toHaveLength(1);
    expect(conversations[0].title).toBe('v2');
    expect(conversations[0].messageCount).toBe(3);
  });

  it('skips malformed messages during load', () => {
    const conv = makeConv('mal', 'Malformed');
    mgr.save(conv);
    // Inject a bad message
    const filePath = '/data/conversations/mal.json';
    const raw = JSON.parse(io.readFileSync(filePath, 'utf-8'));
    raw.messages.push({ broken: true });
    raw.messages.push({ id: 'ok', role: 'user', content: 'valid', timestamp: 999 });
    io.writeFileSync(filePath, JSON.stringify(raw));

    const result = mgr.load('mal');
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Original message + the valid injected one, but not the broken one
      expect(result.conversation.messages).toHaveLength(2);
    }
  });
});

describe('generateTitle', () => {
  it('truncates at word boundary', () => {
    const long = 'This is a really long sentence that exceeds fifty characters by quite a bit';
    const title = generateTitle(long);
    expect(title.length).toBeLessThanOrEqual(50);
    expect(title).not.toMatch(/\s$/);
  });

  it('uses full text when under 50 chars', () => {
    expect(generateTitle('Short title')).toBe('Short title');
  });

  it('empty text + single attachment → filename', () => {
    expect(generateTitle('', ['notes.txt'])).toBe('notes.txt');
  });

  it('empty text + multiple attachments → N attached files', () => {
    expect(generateTitle('', ['a.txt', 'b.txt'])).toBe('2 attached files');
  });

  it('ignores [Attached file: ...] formatting blocks', () => {
    expect(generateTitle('[Attached file: x.txt] Hello world')).toBe('Hello world');
  });

  it('whitespace-only text with attachments → filename', () => {
    expect(generateTitle('   ', ['readme.md'])).toBe('readme.md');
  });

  it('returns default when no text and no attachments', () => {
    expect(generateTitle('')).toBe('New conversation');
  });
});

describe('toPersistedMessage', () => {
  it('strips streaming flag', () => {
    const msg: ChatMessage = {
      id: 'test',
      role: 'assistant',
      content: 'Hello',
      timestamp: 1000,
      streaming: true,
    };
    const persisted = toPersistedMessage(msg);
    expect(persisted).not.toHaveProperty('streaming');
    expect(persisted.id).toBe('test');
    expect(persisted.content).toBe('Hello');
  });

  it('omits empty arrays', () => {
    const msg: ChatMessage = {
      id: 'test',
      role: 'user',
      content: 'Hi',
      timestamp: 1000,
      violations: [],
      fileActions: [],
    };
    const persisted = toPersistedMessage(msg);
    expect(persisted).not.toHaveProperty('violations');
    expect(persisted).not.toHaveProperty('fileActions');
  });

  it('includes non-empty optional fields', () => {
    const msg: ChatMessage = {
      id: 'test',
      role: 'assistant',
      content: 'Done',
      timestamp: 1000,
      receipt: { receipt_id: 'r1', hash: 'h', verdict: 'pass', gate: 'g' },
      attachments: [{ name: 'f.txt', size: 100 }],
    };
    const persisted = toPersistedMessage(msg);
    expect(persisted.receipt).toBeDefined();
    expect(persisted.attachments).toHaveLength(1);
  });
});

// SPDX-License-Identifier: Apache-2.0
/**
 * ConversationManager — persists multi-conversation state.
 *
 * Index file + per-conversation JSON in `{dataDir}`.
 * Same DI pattern as SettingsManager for testability.
 */

import fs from 'node:fs';
import path from 'node:path';
import type {
  ConversationMeta,
  ConversationData,
  ConversationListResult,
  ConversationLoadResult,
  ConversationSaveResult,
  ConversationSearchHit,
  PersistedChatMessage,
} from '../shared/types.js';

// Re-export pure functions from shared
export { generateTitle, toPersistedMessage, fromPersistedMessage } from '../shared/conversation-utils.js';

// --- DI ---

export interface ConversationManagerIO {
  readFileSync(path: string, encoding: 'utf-8'): string;
  writeFileSync(path: string, data: string): void;
  renameSync(src: string, dst: string): void;
  existsSync(path: string): boolean;
  mkdirSync(path: string, opts: { recursive: boolean }): void;
  unlinkSync(path: string): void;
}

const defaultIO: ConversationManagerIO = {
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  writeFileSync: (p, d) => fs.writeFileSync(p, d),
  renameSync: (s, d) => fs.renameSync(s, d),
  existsSync: (p) => fs.existsSync(p),
  mkdirSync: (p, o) => fs.mkdirSync(p, o),
  unlinkSync: (p) => fs.unlinkSync(p),
};

// --- Index schema ---

interface IndexFile {
  schemaVersion: number;
  activeId: string | null;
  conversations: ConversationMeta[];
}

interface ConversationFile {
  schemaVersion: number;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: PersistedChatMessage[];
}

// --- Manager ---

export class ConversationManager {
  private dataDir: string;
  private io: ConversationManagerIO;
  private index: IndexFile;

  constructor(dataDir: string, io: ConversationManagerIO = defaultIO) {
    this.dataDir = dataDir;
    this.io = io;
    this.index = this.loadIndex();
  }

  private get indexPath(): string {
    return path.join(this.dataDir, 'clerk-conversations.json');
  }

  private get conversationsDir(): string {
    return path.join(this.dataDir, 'conversations');
  }

  private conversationPath(id: string): string {
    return path.join(this.conversationsDir, `${id}.json`);
  }

  private ensureDir(): void {
    if (!this.io.existsSync(this.conversationsDir)) {
      this.io.mkdirSync(this.conversationsDir, { recursive: true });
    }
  }

  // --- Index ---

  private loadIndex(): IndexFile {
    try {
      if (!this.io.existsSync(this.indexPath)) {
        return { schemaVersion: 1, activeId: null, conversations: [] };
      }
      const raw = this.io.readFileSync(this.indexPath, 'utf-8');
      const data = JSON.parse(raw) as Partial<IndexFile>;
      if (data.schemaVersion !== 1 || !Array.isArray(data.conversations)) {
        this.quarantineIndex();
        return { schemaVersion: 1, activeId: null, conversations: [] };
      }
      // Validate each meta entry
      const valid = data.conversations.filter(
        (m): m is ConversationMeta =>
          typeof m === 'object' &&
          m !== null &&
          typeof m.id === 'string' &&
          typeof m.title === 'string' &&
          typeof m.createdAt === 'number' &&
          typeof m.updatedAt === 'number',
      );
      return {
        schemaVersion: 1,
        activeId: typeof data.activeId === 'string' ? data.activeId : null,
        conversations: valid,
      };
    } catch {
      this.quarantineIndex();
      return { schemaVersion: 1, activeId: null, conversations: [] };
    }
  }

  private quarantineIndex(): void {
    try {
      if (!this.io.existsSync(this.indexPath)) return;
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      this.io.renameSync(this.indexPath, `${this.indexPath}.corrupt-${ts}`);
    } catch {
      // Best effort
    }
  }

  private persistIndex(): void {
    const dir = path.dirname(this.indexPath);
    if (!this.io.existsSync(dir)) {
      this.io.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = this.indexPath + '.tmp';
    this.io.writeFileSync(tmpPath, JSON.stringify(this.index, null, 2));
    try {
      if (this.io.existsSync(this.indexPath)) {
        this.io.unlinkSync(this.indexPath);
      }
    } catch { /* best effort */ }
    this.io.renameSync(tmpPath, this.indexPath);
  }

  // --- Public API ---

  list(): ConversationListResult {
    return {
      conversations: this.index.conversations.map(c => ({ ...c })),
      activeId: this.index.activeId,
    };
  }

  load(id: string): ConversationLoadResult {
    const filePath = this.conversationPath(id);
    try {
      if (!this.io.existsSync(filePath)) {
        return { ok: false, error: `Conversation ${id} not found.` };
      }
      const raw = this.io.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw) as Partial<ConversationFile>;
      if (!data.id || !Array.isArray(data.messages)) {
        return { ok: false, error: `Conversation ${id} is corrupt.` };
      }
      // Filter valid messages, skip malformed
      const messages: PersistedChatMessage[] = data.messages.filter(
        (m): m is PersistedChatMessage =>
          typeof m === 'object' &&
          m !== null &&
          typeof m.id === 'string' &&
          typeof m.role === 'string' &&
          typeof m.content === 'string' &&
          typeof m.timestamp === 'number',
      );
      return {
        ok: true,
        conversation: {
          id: data.id,
          title: data.title ?? 'Untitled',
          createdAt: data.createdAt ?? Date.now(),
          updatedAt: data.updatedAt ?? Date.now(),
          messages,
        },
      };
    } catch {
      return { ok: false, error: `Failed to read conversation ${id}.` };
    }
  }

  save(data: ConversationData): ConversationSaveResult {
    try {
      this.ensureDir();
      const file: ConversationFile = {
        schemaVersion: 1,
        id: data.id,
        title: data.title,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        messages: data.messages,
      };
      const filePath = this.conversationPath(data.id);
      const tmpPath = filePath + '.tmp';
      this.io.writeFileSync(tmpPath, JSON.stringify(file, null, 2));
      try {
        if (this.io.existsSync(filePath)) {
          this.io.unlinkSync(filePath);
        }
      } catch { /* best effort */ }
      this.io.renameSync(tmpPath, filePath);

      // Update index
      const meta: ConversationMeta = {
        id: data.id,
        title: data.title,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        messageCount: data.messages.length,
      };
      const idx = this.index.conversations.findIndex(c => c.id === data.id);
      if (idx >= 0) {
        this.index.conversations[idx] = meta;
      } else {
        this.index.conversations.push(meta);
      }
      this.persistIndex();
      return { ok: true, meta: { ...meta } };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  delete(id: string): boolean {
    const filePath = this.conversationPath(id);
    try {
      if (this.io.existsSync(filePath)) {
        this.io.unlinkSync(filePath);
      }
    } catch {
      // Best effort
    }
    const idx = this.index.conversations.findIndex(c => c.id === id);
    if (idx >= 0) {
      this.index.conversations.splice(idx, 1);
    }
    if (this.index.activeId === id) {
      this.index.activeId = null;
    }
    this.persistIndex();
    return true;
  }

  rename(id: string, title: string): ConversationMeta | null {
    const idx = this.index.conversations.findIndex(c => c.id === id);
    if (idx < 0) return null;

    const now = Date.now();
    this.index.conversations[idx].title = title;
    this.index.conversations[idx].updatedAt = now;

    // Also update the conversation file
    const filePath = this.conversationPath(id);
    try {
      if (this.io.existsSync(filePath)) {
        const raw = this.io.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(raw) as ConversationFile;
        data.title = title;
        data.updatedAt = now;
        const tmpPath = filePath + '.tmp';
        this.io.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
        try {
          if (this.io.existsSync(filePath)) {
            this.io.unlinkSync(filePath);
          }
        } catch { /* best effort */ }
        this.io.renameSync(tmpPath, filePath);
      }
    } catch {
      // Index update still goes through
    }

    this.persistIndex();
    return { ...this.index.conversations[idx] };
  }

  setActive(id: string | null): void {
    this.index.activeId = id;
    this.persistIndex();
  }

  getActiveId(): string | null {
    return this.index.activeId;
  }

  /**
   * Search across all conversation message content (case-insensitive).
   * Returns up to 20 hits with message snippets.
   */
  search(query: string): ConversationSearchHit[] {
    if (!query.trim()) return [];
    const lower = query.toLowerCase();
    const hits: ConversationSearchHit[] = [];
    const MAX_HITS = 20;
    const SNIPPET_LEN = 80;

    for (const meta of this.index.conversations) {
      if (hits.length >= MAX_HITS) break;

      // Check title first (cheap)
      const titleMatch = meta.title.toLowerCase().includes(lower);

      // Load conversation to search messages
      const result = this.load(meta.id);
      if (!result.ok) continue;

      for (const msg of result.conversation.messages) {
        if (hits.length >= MAX_HITS) break;
        const idx = msg.content.toLowerCase().indexOf(lower);
        if (idx === -1 && !titleMatch) continue;
        if (idx === -1) continue; // Title matched but this message didn't

        // Build snippet around match
        const start = Math.max(0, idx - 30);
        const end = Math.min(msg.content.length, idx + query.length + SNIPPET_LEN - 30);
        let snippet = msg.content.slice(start, end).replace(/\n/g, ' ');
        if (start > 0) snippet = '...' + snippet;
        if (end < msg.content.length) snippet = snippet + '...';

        hits.push({
          conversationId: meta.id,
          title: meta.title,
          snippet,
          messageRole: msg.role as 'user' | 'assistant',
          updatedAt: meta.updatedAt,
        });
      }
    }

    return hits;
  }
}

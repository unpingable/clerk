// SPDX-License-Identifier: Apache-2.0
/**
 * JSONL persistence for activity events.
 * Bounded file with rotation. Async-serialized writes.
 */

import path from 'node:path';
import type { ActivityEvent } from '../shared/activity-types.js';

const DEFAULT_MAX_BYTES = 2_000_000;   // 2MB
const DEFAULT_KEEP_BYTES = 1_500_000;  // keep 1.5MB on rotate

/** Filesystem operations — injectable for testing. */
export interface ActivityLogIO {
  appendFile(filePath: string, data: string): Promise<void>;
  readFile(filePath: string, encoding: 'utf-8'): Promise<string>;
  stat(filePath: string): Promise<{ size: number }>;
  writeFile(filePath: string, data: string): Promise<void>;
  readBytes(filePath: string, start: number, length: number): Promise<Buffer>;
  rename(src: string, dst: string): Promise<void>;
  existsSync(filePath: string): boolean;
  mkdirSync(dirPath: string, opts: { recursive: boolean }): void;
  writeFileSync(filePath: string, data: string): void;
}

export interface ActivityLogOptions {
  maxBytes?: number;
  keepBytes?: number;
}

export class ActivityLog {
  private readonly logPath: string;
  private readonly dir: string;
  private readonly maxBytes: number;
  private readonly keepBytes: number;
  private readonly io: ActivityLogIO;

  /** Async mutex — each write chains on the previous. */
  private queue: Promise<void> = Promise.resolve();

  constructor(governorDir: string, io: ActivityLogIO, opts?: ActivityLogOptions) {
    this.dir = path.join(governorDir, '.clerk');
    this.logPath = path.join(this.dir, 'activity.jsonl');
    this.maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
    this.keepBytes = opts?.keepBytes ?? DEFAULT_KEEP_BYTES;
    this.io = io;
    this.ensureDir();
  }

  private ensureDir(): void {
    this.io.mkdirSync(this.dir, { recursive: true });
    const gi = path.join(this.dir, '.gitignore');
    if (!this.io.existsSync(gi)) {
      this.io.writeFileSync(gi, '*\n');
    }
  }

  append(event: ActivityEvent): Promise<void> {
    const line = JSON.stringify(event) + '\n';
    this.queue = this.queue.then(async () => {
      await this.rotateIfNeeded();
      await this.io.appendFile(this.logPath, line);
    });
    return this.queue;
  }

  async readRecent(maxLines = 500): Promise<ActivityEvent[]> {
    let data: string;
    try {
      data = await this.io.readFile(this.logPath, 'utf-8');
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === 'ENOENT') return [];
      throw e;
    }

    const lines = data.split('\n').filter(l => l.trim().length > 0);
    const tail = lines.slice(Math.max(0, lines.length - maxLines));

    // Last-write-wins dedup by id — upserted events appear multiple times in JSONL
    const byId = new Map<string, ActivityEvent>();
    const order: string[] = [];

    for (const line of tail) {
      try {
        const ev = JSON.parse(line) as ActivityEvent;
        if (ev && typeof ev.id === 'string' && typeof ev.ts === 'string') {
          if (!byId.has(ev.id)) {
            order.push(ev.id);
          }
          byId.set(ev.id, ev); // last occurrence wins
        }
      } catch {
        // skip malformed lines
      }
    }

    return order.map(id => byId.get(id)!);

  }

  private async rotateIfNeeded(): Promise<void> {
    let st;
    try {
      st = await this.io.stat(this.logPath);
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === 'ENOENT') return;
      throw e;
    }

    if (st.size <= this.maxBytes) return;

    // Read tail portion
    const start = st.size - this.keepBytes;
    const buf = await this.io.readBytes(this.logPath, start, this.keepBytes);

    // toString replaces invalid UTF-8 sequences
    const text = buf.toString('utf-8');

    // Drop leading partial line (align to newline)
    const idx = text.indexOf('\n');
    const tail = idx === -1 ? '' : text.slice(idx + 1);

    // Atomic rewrite via tmp + rename
    const tmp = this.logPath + '.tmp';
    await this.io.writeFile(tmp, tail);
    await this.io.rename(tmp, this.logPath);
  }
}

// SPDX-License-Identifier: Apache-2.0
/**
 * JSON-RPC 2.0 client for the Governor daemon.
 * Content-Length framed JSON-RPC over child process stdio.
 *
 * Key addition over Guvnah: notification routing for chat streaming.
 * When the daemon sends a JSON-RPC notification (no `id` field) during
 * an active stream, we route it to the stream callback instead of ignoring it.
 */

import { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import type {
  HealthResponse,
  GovernorNow,
  GovernorStatus,
  GateReceipt,
  ReceiptDetail,
  PendingViolation,
  ResolutionResult,
  ModelInfo,
} from '../shared/types.js';

// ---------------------------------------------------------------------------
// Content-Length framing
// ---------------------------------------------------------------------------

/** Parse Content-Length framed messages from a stream buffer. */
export class FrameParser extends EventEmitter {
  private buffer: Buffer = Buffer.alloc(0);

  feed(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
    this.tryParse();
  }

  private tryParse(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;

      const headerStr = this.buffer.subarray(0, headerEnd).toString('utf-8');
      const match = headerStr.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Skip malformed header
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      const messageEnd = bodyStart + contentLength;

      if (this.buffer.length < messageEnd) return; // Incomplete body

      const body = this.buffer.subarray(bodyStart, messageEnd).toString('utf-8');
      this.buffer = this.buffer.subarray(messageEnd);

      try {
        this.emit('message', JSON.parse(body));
      } catch {
        this.emit('error', new Error(`Failed to parse JSON: ${body.slice(0, 100)}`));
      }
    }
  }
}

/** Encode a JSON-RPC message with Content-Length framing. */
function encodeMessage(msg: object): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf-8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf-8');
  return Buffer.concat([header, body]);
}

function daemonLog(stream: string, data: Buffer): void {
  const lines = data.toString('utf-8').split('\n').filter(Boolean);
  for (const line of lines) {
    console.error(`[daemon:${stream}] ${line}`);
  }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface Transport {
  start(): void;
  stop(): void;
  get isRunning(): boolean;
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  /** Register a callback for JSON-RPC notifications (messages without an id). */
  onNotification(cb: (method: string, params: unknown) => void): void;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class StdioTransport implements Transport {
  private process: ChildProcess | null = null;
  private parser = new FrameParser();
  private pending = new Map<number | string, PendingRequest>();
  private nextId = 1;
  private binPath: string;
  private governorDir: string;
  private mode: string;
  private timeoutMs: number;
  private notificationHandler: ((method: string, params: unknown) => void) | null = null;

  constructor(binPath: string, governorDir: string, mode: string = 'general', timeoutMs: number = 30000) {
    this.binPath = binPath;
    this.governorDir = governorDir;
    this.mode = mode;
    this.timeoutMs = timeoutMs;
  }

  start(): void {
    if (this.process) return;

    const args = [
      '--root', this.governorDir,
      'serve', '--stdio',
      '--mode', this.mode,
    ];

    console.error(`[daemon] spawn: ${this.binPath} ${args.join(' ')}`);

    this.process = spawn(this.binPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stderr?.on('data', (data: Buffer) => daemonLog('err', data));

    this.parser = new FrameParser();
    this.parser.on('message', (msg: { id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } }) => {
      // Notification — no id field, has method field
      if (msg.id === undefined && msg.method) {
        this.notificationHandler?.(msg.method, msg.params);
        return;
      }

      // Response — has id field
      if (msg.id === undefined) return;
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);

      if (msg.error) {
        pending.reject(new Error(`RPC ${msg.error.code}: ${msg.error.message}`));
      } else {
        pending.resolve(msg.result);
      }
    });

    this.process.stdout?.on('data', (data: Buffer) => this.parser.feed(data));
    this.process.on('exit', (code, signal) => {
      console.error(`[daemon] exited code=${code} signal=${signal}`);
      for (const [, req] of this.pending) {
        clearTimeout(req.timer);
        req.reject(new Error('Daemon process exited'));
      }
      this.pending.clear();
      this.process = null;
    });
  }

  stop(): void {
    if (!this.process) return;
    this.process.kill('SIGTERM');
    this.process = null;
  }

  get isRunning(): boolean {
    return this.process !== null && this.process.exitCode === null;
  }

  onNotification(cb: (method: string, params: unknown) => void): void {
    this.notificationHandler = cb;
  }

  async call<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.process?.stdin?.writable) {
      throw new Error('Daemon not running');
    }

    const id = this.nextId++;
    const request = { jsonrpc: '2.0', id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method} (${this.timeoutMs}ms)`));
      }, this.timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      });

      this.process!.stdin!.write(encodeMessage(request));
    });
  }
}

// ---------------------------------------------------------------------------
// Shape adapters
// ---------------------------------------------------------------------------

function adaptPendingViolation(raw: Record<string, unknown>): PendingViolation | null {
  if (!raw) return null;
  const violations = (raw.violations as Record<string, unknown>[]) ?? [];
  const first = violations[0] ?? {};
  const blocked = (raw.blocked_response as string) ?? '';
  return {
    violation_id: (raw.id as string) ?? '',
    anchor_id: (first.anchor_id as string) ?? '',
    description: (first.description as string) ?? '',
    severity: (first.severity as string) ?? 'error',
    content_preview: blocked.length > 200 ? blocked.slice(0, 200) + '\u2026' : blocked,
  };
}

// ---------------------------------------------------------------------------
// GovernorClient — Clerk's interface to the daemon
// ---------------------------------------------------------------------------

/** Active stream state. */
interface ActiveStream {
  streamId: string;
  onDelta: (delta: { content?: string }) => void;
  onEnd: (result: { receipt?: unknown; violations?: unknown[]; pending?: unknown }) => void;
}

export class GovernorClient {
  private transport: Transport;
  private binPath: string;
  private governorDir: string;
  private mode: string;
  private activeStreams = new Map<string, ActiveStream>();

  constructor(binPath: string, governorDir: string = '.governor', mode: string = 'general', transport?: Transport) {
    this.binPath = binPath;
    this.governorDir = governorDir;
    this.mode = mode;
    this.transport = transport ?? new StdioTransport(binPath, governorDir, mode);

    // Route notifications to active streams
    this.transport.onNotification((method, params) => {
      if (method === 'chat.delta') {
        const p = params as { stream_id?: string; content?: string };
        const streamId = p.stream_id;
        if (streamId) {
          const stream = this.activeStreams.get(streamId);
          stream?.onDelta({ content: p.content });
        } else {
          // Broadcast to all active streams (single-stream case)
          for (const stream of this.activeStreams.values()) {
            stream.onDelta({ content: (params as { content?: string }).content });
          }
        }
      }
    });
  }

  start(): void { this.transport.start(); }
  stop(): void { this.transport.stop(); }
  get isRunning(): boolean { return this.transport.isRunning; }

  setGovernorDir(dir: string): void {
    this.transport.stop();
    this.governorDir = dir;
    const newTransport = new StdioTransport(this.binPath, dir, this.mode);
    this.transport = newTransport;
    // Re-wire notification handler
    this.transport.onNotification((method, params) => {
      if (method === 'chat.delta') {
        for (const stream of this.activeStreams.values()) {
          stream.onDelta({ content: (params as { content?: string }).content });
        }
      }
    });
    this.transport.start();
  }

  // --- Health ---

  async health(): Promise<HealthResponse> {
    try {
      const hello = await this.transport.call<{
        governor: { context_id: string; mode: string; initialized: boolean };
      }>('governor.hello');
      return {
        status: hello.governor.initialized ? 'ok' : 'degraded',
        backend: { type: 'daemon', connected: true },
        governor: hello.governor,
      };
    } catch {
      return {
        status: 'error',
        backend: { type: 'daemon', connected: false },
        governor: { context_id: '', mode: '', initialized: false },
      };
    }
  }

  // --- Governor State ---

  async now(): Promise<GovernorNow> {
    return this.transport.call('governor.now');
  }

  async status(): Promise<GovernorStatus> {
    return this.transport.call('governor.status');
  }

  // --- Chat ---

  async chatSend(
    messages: Array<{ role: string; content: string }>,
    options: Record<string, unknown> = {},
  ): Promise<unknown> {
    return this.transport.call('chat.send', { messages, ...options });
  }

  async chatStreamStart(
    messages: Array<{ role: string; content: string }>,
    options: Record<string, unknown> = {},
    onDelta: (delta: { content?: string }) => void,
    onEnd: (result: { receipt?: unknown; violations?: unknown[]; pending?: unknown }) => void,
  ): Promise<string> {
    const streamId = crypto.randomUUID();

    this.activeStreams.set(streamId, { streamId, onDelta, onEnd });

    // Fire the RPC — the response comes back when streaming is done
    this.transport.call<{
      receipt?: unknown;
      violations?: unknown[];
      pending?: unknown;
    }>('chat.stream', { messages, ...options })
      .then((result) => {
        const stream = this.activeStreams.get(streamId);
        if (stream) {
          stream.onEnd(result ?? {});
          this.activeStreams.delete(streamId);
        }
      })
      .catch((err) => {
        const stream = this.activeStreams.get(streamId);
        if (stream) {
          stream.onEnd({ receipt: null, violations: [{ description: String(err) }] });
          this.activeStreams.delete(streamId);
        }
      });

    return streamId;
  }

  async chatModels(): Promise<ModelInfo[]> {
    try {
      const result = await this.transport.call<{ models: ModelInfo[] }>('chat.models');
      return result.models ?? [];
    } catch {
      return [];
    }
  }

  // --- Receipts ---

  async listReceipts(filter?: { gate?: string; verdict?: string; limit?: number }): Promise<GateReceipt[]> {
    return this.transport.call('receipts.list', filter ?? {});
  }

  async receiptDetail(receiptId: string): Promise<ReceiptDetail> {
    return this.transport.call('receipts.detail', { receipt_id: receiptId });
  }

  // --- Commit / Waive ---

  async commitPending(): Promise<PendingViolation | null> {
    const raw = await this.transport.call<Record<string, unknown> | null>('commit.pending');
    if (!raw) return null;
    return adaptPendingViolation(raw);
  }

  async commitFix(correctedText?: string): Promise<ResolutionResult> {
    return this.transport.call('commit.fix', { corrected_text: correctedText });
  }

  async commitRevise(newAnchorText?: string): Promise<ResolutionResult> {
    return this.transport.call('commit.revise', { new_anchor_text: newAnchorText });
  }

  async commitProceed(reason: string): Promise<ResolutionResult> {
    return this.transport.call('commit.proceed', { reason });
  }

  // --- Intent (constraint templates) ---

  async intentSchema(templateName: string): Promise<string> {
    const result = await this.transport.call<{ schema_id: string }>('intent.schema', { template: templateName });
    return result.schema_id;
  }

  async intentCompile(
    schemaId: string,
    templateName: string,
    values: Record<string, unknown>,
  ): Promise<{ receipt_hash?: string }> {
    return this.transport.call('intent.compile', {
      schema_id: schemaId,
      template: templateName,
      values,
    });
  }
}

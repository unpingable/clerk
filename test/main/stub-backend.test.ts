// SPDX-License-Identifier: Apache-2.0
/**
 * Stub backend smoke test — proves Clerk can wire up and handle IPC
 * with a non-Governor backend. The stub returns minimal valid responses
 * with all capabilities false except chat.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Channels } from '../../src/shared/channels';
import type { ClerkBackend, BackendCapabilities, ScopeCheckResult, StreamCallbacks } from '../../src/main/backend';
import type {
  HealthResponse,
  ModelInfo,
  GateReceipt,
  ReceiptDetail,
  PendingViolation,
  ResolutionResult,
  GovernorNow,
  GovernorStatus,
  IntentSchemaResult,
  IntentCompileResult,
} from '../../src/shared/types';

// --- Stub backend: chat-only, no governance ---

const STUB_CAPABILITIES: BackendCapabilities = {
  chat: true,
  textGating: false,
  actionGating: false,
  templateCompilation: false,
  receipts: false,
  violations: false,
  governorState: false,
};

class StubBackend implements ClerkBackend {
  isRunning = true;

  getCapabilities(): BackendCapabilities {
    return { ...STUB_CAPABILITIES };
  }

  async health(): Promise<HealthResponse> {
    return {
      status: 'ok',
      backend: { type: 'stub', connected: true },
      governor: { context_id: '', mode: '', initialized: false },
    };
  }

  async streamChat(
    _messages: Array<{ role: string; content: string }>,
    _options: Record<string, unknown>,
    callbacks: StreamCallbacks,
  ): Promise<string> {
    const streamId = 'stub-stream-1';
    // Simulate async response
    setTimeout(() => {
      callbacks.onDelta({ content: 'Hello from stub!' });
      callbacks.onEnd({ receipt: undefined, violations: [], pending: undefined });
    }, 0);
    return streamId;
  }

  async sendChat(): Promise<unknown> {
    return { role: 'assistant', content: 'stub response' };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'stub-model', name: 'Stub Model', backend: 'stub' }];
  }

  async checkScope(): Promise<ScopeCheckResult> {
    // No action gating — allow everything
    return { allowed: true, reason: 'stub backend allows all' };
  }

  async listReceipts(): Promise<GateReceipt[]> { return []; }
  async receiptDetail(): Promise<ReceiptDetail> { throw new Error('Receipts not supported'); }
  async commitPending(): Promise<PendingViolation | null> { return null; }
  async commitFix(): Promise<ResolutionResult> { throw new Error('Violations not supported'); }
  async commitRevise(): Promise<ResolutionResult> { throw new Error('Violations not supported'); }
  async commitProceed(): Promise<ResolutionResult> { throw new Error('Violations not supported'); }
  async now(): Promise<GovernorNow> { throw new Error('Governor state not supported'); }
  async status(): Promise<GovernorStatus> { throw new Error('Governor state not supported'); }
  async intentSchema(): Promise<IntentSchemaResult> { throw new Error('Template compilation not supported'); }
  async intentCompile(): Promise<IntentCompileResult> { throw new Error('Template compilation not supported'); }

  start(): void { this.isRunning = true; }
  stop(): void { this.isRunning = false; }
  restart(): void { /* no-op */ }
  setProjectDir(): void { /* no-op */ }
}

// --- Mock Electron ---

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: () => [],
  },
}));

const { ipcMain } = await import('electron');

// --- Tests ---

describe('StubBackend smoke test', () => {
  let stub: StubBackend;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = new StubBackend();
  });

  it('reports chat-only capabilities', () => {
    const caps = stub.getCapabilities();
    expect(caps.chat).toBe(true);
    expect(caps.templateCompilation).toBe(false);
    expect(caps.violations).toBe(false);
    expect(caps.receipts).toBe(false);
    expect(caps.governorState).toBe(false);
    expect(caps.actionGating).toBe(false);
    expect(caps.textGating).toBe(false);
  });

  it('health returns ok', async () => {
    const h = await stub.health();
    expect(h.status).toBe('ok');
  });

  it('listModels returns at least one model', async () => {
    const models = await stub.listModels();
    expect(models.length).toBeGreaterThan(0);
  });

  it('checkScope allows everything (no action gating)', async () => {
    const result = await stub.checkScope('file.write', { path: 'foo.txt' });
    expect(result.allowed).toBe(true);
  });

  it('commitPending returns null (no violations)', async () => {
    const pending = await stub.commitPending();
    expect(pending).toBeNull();
  });

  it('listReceipts returns empty (no receipt history)', async () => {
    const receipts = await stub.listReceipts();
    expect(receipts).toEqual([]);
  });

  it('Governor-only methods throw descriptive errors', async () => {
    await expect(stub.now()).rejects.toThrow('Governor state not supported');
    await expect(stub.status()).rejects.toThrow('Governor state not supported');
    await expect(stub.intentSchema('test')).rejects.toThrow('Template compilation not supported');
    await expect(stub.intentCompile('s1', 'test', {})).rejects.toThrow('Template compilation not supported');
    await expect(stub.commitFix()).rejects.toThrow('Violations not supported');
    await expect(stub.commitRevise()).rejects.toThrow('Violations not supported');
    await expect(stub.commitProceed('reason')).rejects.toThrow('Violations not supported');
  });

  it('streams chat with delta and end callbacks', async () => {
    const deltas: string[] = [];
    let ended = false;

    const streamId = await stub.streamChat(
      [{ role: 'user', content: 'hello' }],
      {},
      {
        onDelta: (d) => { if (d.content) deltas.push(d.content); },
        onEnd: () => { ended = true; },
      },
    );

    expect(streamId).toBe('stub-stream-1');

    // Wait for async callbacks
    await new Promise(r => setTimeout(r, 10));
    expect(deltas).toEqual(['Hello from stub!']);
    expect(ended).toBe(true);
  });

  it('can be passed to registerIpcHandlers without crashing', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc-handlers');

    // Wire stub backend into IPC handlers — no Governor, no monitor, no managers
    registerIpcHandlers(
      stub,            // backend
      null,            // monitor
      { ok: true, path: '/stub', version: '0.0.0', source: 'stub' } as any, // daemonResult
      null,            // templateManager
      null,            // fileManager
      null,            // toolLoop
      null,            // activityManager
      null,            // askGateState
      null,            // settingsManager
      null,            // conversationManager
      null,            // governorDir
      null,            // configIO
    );

    const handleCalls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const channelNames = handleCalls.map((c: unknown[]) => c[0]);

    // Core channels should be registered
    expect(channelNames).toContain(Channels.HEALTH);
    expect(channelNames).toContain(Channels.BACKEND_CAPABILITIES);
    expect(channelNames).toContain(Channels.CHAT_SEND);
    expect(channelNames).toContain(Channels.CHAT_MODELS);

    // Invoke HEALTH handler — should work with stub
    const healthHandler = handleCalls.find((c: unknown[]) => c[0] === Channels.HEALTH)![1] as () => Promise<unknown>;
    const health = await healthHandler();
    expect(health).toEqual({ status: 'ok', backend: { type: 'stub', connected: true }, governor: { context_id: '', mode: '', initialized: false } });

    // Invoke BACKEND_CAPABILITIES handler — should return stub caps
    const capsHandler = handleCalls.find((c: unknown[]) => c[0] === Channels.BACKEND_CAPABILITIES)![1] as () => Promise<unknown>;
    const capabilities = await capsHandler();
    expect(capabilities).toEqual(STUB_CAPABILITIES);

    // Invoke CHAT_MODELS handler — should return stub model
    const modelsHandler = handleCalls.find((c: unknown[]) => c[0] === Channels.CHAT_MODELS)![1] as () => Promise<unknown>;
    const models = await modelsHandler();
    expect(models).toEqual([{ id: 'stub-model', name: 'Stub Model', backend: 'stub' }]);
  });
});

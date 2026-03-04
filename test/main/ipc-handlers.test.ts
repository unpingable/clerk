// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron before importing anything that uses it
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: vi.fn(() => []),
  },
}));

import { ipcMain } from 'electron';
import { Channels } from '../../src/shared/channels';

describe('IPC handler registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers all expected channels', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc-handlers');

    const mockClient = {
      health: vi.fn(),
      setGovernorDir: vi.fn(),
      now: vi.fn(),
      status: vi.fn(),
      chatSend: vi.fn(),
      chatStreamStart: vi.fn(),
      chatModels: vi.fn(),
      listReceipts: vi.fn(),
      receiptDetail: vi.fn(),
      commitPending: vi.fn(),
      commitFix: vi.fn(),
      commitRevise: vi.fn(),
      commitProceed: vi.fn(),
    };

    const mockMonitor = {
      stop: vi.fn(),
      start: vi.fn(),
    };

    const mockTemplateManager = {
      listTemplates: vi.fn(),
      getState: vi.fn(),
      applyTemplate: vi.fn(),
    };

    const mockFileManager = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      overwriteFile: vi.fn(),
      listDir: vi.fn(),
    };

    const mockToolLoop = {
      run: vi.fn(),
      stop: vi.fn(),
    };

    const mockActivityManager = {
      getRecent: vi.fn().mockReturnValue([]),
    };

    registerIpcHandlers(mockClient as any, mockMonitor as any, { ok: true, path: '/bin/gov', version: '2.5.0', source: 'path' } as any, mockTemplateManager as any, mockFileManager as any, mockToolLoop as any, mockActivityManager as any);

    const handleCalls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const registeredChannels = handleCalls.map((c: unknown[]) => c[0]);

    // Verify all expected channels are registered
    expect(registeredChannels).toContain(Channels.HEALTH);
    expect(registeredChannels).toContain(Channels.CONNECT);
    expect(registeredChannels).toContain(Channels.NOW);
    expect(registeredChannels).toContain(Channels.STATUS);
    expect(registeredChannels).toContain(Channels.CHAT_SEND);
    expect(registeredChannels).toContain(Channels.CHAT_STREAM_START);
    expect(registeredChannels).toContain(Channels.CHAT_STREAM_STOP);
    expect(registeredChannels).toContain(Channels.CHAT_ASK_RESPOND);
    expect(registeredChannels).toContain(Channels.CHAT_MODELS);
    expect(registeredChannels).toContain(Channels.RECEIPTS_LIST);
    expect(registeredChannels).toContain(Channels.RECEIPTS_DETAIL);
    expect(registeredChannels).toContain(Channels.COMMIT_PENDING);
    expect(registeredChannels).toContain(Channels.COMMIT_FIX);
    expect(registeredChannels).toContain(Channels.COMMIT_REVISE);
    expect(registeredChannels).toContain(Channels.COMMIT_PROCEED);
    expect(registeredChannels).toContain(Channels.TEMPLATES_LIST);
    expect(registeredChannels).toContain(Channels.TEMPLATES_CURRENT);
    expect(registeredChannels).toContain(Channels.TEMPLATES_APPLY);
    expect(registeredChannels).toContain(Channels.FILES_READ);
    expect(registeredChannels).toContain(Channels.FILES_WRITE);
    expect(registeredChannels).toContain(Channels.FILES_OVERWRITE);
    expect(registeredChannels).toContain(Channels.FILES_LIST);
    expect(registeredChannels).toContain(Channels.ACTIVITY_LIST);
  });

  it('HEALTH handler delegates to client.health()', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc-handlers');

    const mockHealth = { status: 'ok', backend: { type: 'daemon', connected: true } };
    const mockClient = {
      health: vi.fn().mockResolvedValue(mockHealth),
      setGovernorDir: vi.fn(),
      now: vi.fn(),
      status: vi.fn(),
      chatSend: vi.fn(),
      chatStreamStart: vi.fn(),
      chatModels: vi.fn(),
      listReceipts: vi.fn(),
      receiptDetail: vi.fn(),
      commitPending: vi.fn(),
      commitFix: vi.fn(),
      commitRevise: vi.fn(),
      commitProceed: vi.fn(),
    };

    const mockMonitor = { stop: vi.fn(), start: vi.fn() };

    registerIpcHandlers(mockClient as any, mockMonitor as any, { ok: true, path: '/bin/gov', version: '2.5.0', source: 'path' } as any);

    const handleCalls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const healthCall = handleCalls.find((c: unknown[]) => c[0] === Channels.HEALTH);
    expect(healthCall).toBeDefined();

    const handler = healthCall![1] as (...args: unknown[]) => Promise<unknown>;
    const result = await handler();
    expect(result).toEqual(mockHealth);
    expect(mockClient.health).toHaveBeenCalled();
  });

  it('TEMPLATES_APPLY enforces confirmation in main process', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc-handlers');

    const mockTemplateManager = {
      listTemplates: vi.fn(),
      getState: vi.fn(),
      applyTemplate: vi.fn().mockResolvedValue({
        ok: false,
        requestId: 'req-1',
        error: { code: 'CONFIRM_REQUIRED', message: 'Requires confirmation' },
        state: {},
      }),
    };

    registerIpcHandlers(null, null, { ok: false, reason: 'NOT_FOUND', detail: '', tried: [] } as any, mockTemplateManager as any);

    const handleCalls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const applyCall = handleCalls.find((c: unknown[]) => c[0] === Channels.TEMPLATES_APPLY);
    expect(applyCall).toBeDefined();

    const handler = applyCall![1] as (...args: unknown[]) => Promise<unknown>;
    const result = await handler({} as any, { templateId: 'unrestricted', requestId: 'req-1' });

    expect(mockTemplateManager.applyTemplate).toHaveBeenCalledWith({
      templateId: 'unrestricted',
      requestId: 'req-1',
    });
    expect((result as any).ok).toBe(false);
    expect((result as any).error.code).toBe('CONFIRM_REQUIRED');
  });

  it('CHAT_STREAM_STOP handler is idempotent', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc-handlers');

    const mockToolLoop = {
      run: vi.fn(),
      stop: vi.fn(),
    };

    registerIpcHandlers(null, null, { ok: false, reason: 'NOT_FOUND', detail: '', tried: [] } as any, null, null, mockToolLoop as any);

    const handleCalls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const stopCall = handleCalls.find((c: unknown[]) => c[0] === Channels.CHAT_STREAM_STOP);
    expect(stopCall).toBeDefined();

    const handler = stopCall![1] as (...args: unknown[]) => Promise<unknown>;
    // Call stop twice — should not throw
    await handler({} as any, 'stream-1');
    await handler({} as any, 'stream-1');
    expect(mockToolLoop.stop).toHaveBeenCalledTimes(2);
  });

  it('FILES_OVERWRITE handler delegates to fileManager.overwriteFile', async () => {
    const { registerIpcHandlers } = await import('../../src/main/ipc-handlers');

    const mockFileManager = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      overwriteFile: vi.fn().mockResolvedValue({ ok: true, resolvedPath: '/p/f.txt', decision: {} }),
      listDir: vi.fn(),
    };

    registerIpcHandlers(null, null, { ok: false, reason: 'NOT_FOUND', detail: '', tried: [] } as any, null, mockFileManager as any);

    const handleCalls = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls;
    const overwriteCall = handleCalls.find((c: unknown[]) => c[0] === Channels.FILES_OVERWRITE);
    expect(overwriteCall).toBeDefined();

    const handler = overwriteCall![1] as (...args: unknown[]) => Promise<unknown>;
    const result = await handler({} as any, 'file.txt', 'content', 'hash123');
    expect(mockFileManager.overwriteFile).toHaveBeenCalledWith('file.txt', 'content', 'hash123');
    expect((result as any).ok).toBe(true);
  });
});

describe('makeAskGate', () => {
  it('respondToAsk mints grant token on allow_once', async () => {
    const { makeAskGate } = await import('../../src/main/ipc-handlers');

    const mockWin = { webContents: { send: vi.fn() } };
    const askGateState = makeAskGate(() => mockWin as any);

    // Start an ask
    const askPromise = askGateState.gate.requestAsk(
      {
        askId: 'ask-1',
        streamId: 'stream-1',
        correlationId: 'stream-1:1',
        toolId: 'file.write.overwrite',
        path: 'config.json',
        operationLabel: 'Replace contents of config.json',
      },
      new AbortController().signal,
    );

    // Respond with allow_once
    askGateState.respondToAsk('ask-1', 'allow_once', 'stream-1', 'stream-1:1', 'file.write.overwrite', 'config.json', 'hash123');

    const result = await askPromise;
    expect(result.decision).toBe('allow_once');
    expect(result.grantToken).toBeDefined();
    expect(result.grantToken!.toolId).toBe('file.write.overwrite');
    expect(result.grantToken!.path).toBe('config.json');
    expect(result.grantToken!.usedAt).toBeNull();
  });

  it('respondToAsk with deny resolves without grant token', async () => {
    const { makeAskGate } = await import('../../src/main/ipc-handlers');

    const mockWin = { webContents: { send: vi.fn() } };
    const askGateState = makeAskGate(() => mockWin as any);

    const askPromise = askGateState.gate.requestAsk(
      {
        askId: 'ask-2',
        streamId: 'stream-1',
        correlationId: 'stream-1:2',
        toolId: 'file.write.overwrite',
        path: 'secret.txt',
        operationLabel: 'Replace contents of secret.txt',
      },
      new AbortController().signal,
    );

    askGateState.respondToAsk('ask-2', 'deny', 'stream-1', 'stream-1:2', 'file.write.overwrite', 'secret.txt');

    const result = await askPromise;
    expect(result.decision).toBe('deny');
    expect(result.grantToken).toBeUndefined();
  });
});

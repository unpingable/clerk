// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateManager } from '../../src/main/template-manager';
import type { TemplateManagerClient, TemplateManagerIO } from '../../src/main/template-manager';
import { DEFAULT_TEMPLATE_ID } from '../../src/shared/templates';

function mockClient(overrides: Partial<TemplateManagerClient> = {}): TemplateManagerClient {
  return {
    intentSchema: vi.fn().mockResolvedValue('schema-abc'),
    intentCompile: vi.fn().mockResolvedValue({ receipt_hash: 'hash-123' }),
    isRunning: true,
    ...overrides,
  };
}

function mockIO(files: Record<string, string> = {}): TemplateManagerIO {
  const store = { ...files };
  return {
    readFileSync: vi.fn((p: string) => {
      if (store[p] === undefined) throw new Error(`ENOENT: ${p}`);
      return store[p];
    }),
    writeFileSync: vi.fn((p: string, d: string) => { store[p] = d; }),
    renameSync: vi.fn((s: string, d: string) => { store[d] = store[s]; delete store[s]; }),
    existsSync: vi.fn((p: string) => p in store),
    mkdirSync: vi.fn(),
    realpathSync: vi.fn((p: string) => p),
  };
}

describe('TemplateManager', () => {
  let client: TemplateManagerClient;
  let io: TemplateManagerIO;
  let manager: TemplateManager;

  beforeEach(() => {
    client = mockClient();
    io = mockIO();
    manager = new TemplateManager(client, '/gov', io);
  });

  describe('listTemplates', () => {
    it('returns all builtin templates', () => {
      const result = manager.listTemplates();
      expect(result.templates).toHaveLength(4);
      expect(result.defaultTemplateId).toBe('help_me_edit');
    });
  });

  describe('getState', () => {
    it('returns initial state with defaults', () => {
      const state = manager.getState();
      expect(state.defaultTemplateId).toBe('help_me_edit');
      expect(state.selectedTemplateId).toBe('help_me_edit');
      expect(state.appliedTemplateId).toBe('help_me_edit');
      expect(state.applying).toBe(false);
      expect(state.applySeq).toBe(0);
    });
  });

  describe('applyTemplate', () => {
    it('calls intentSchema + intentCompile and sets appliedTemplateId', async () => {
      const result = await manager.applyTemplate({
        templateId: 'take_the_wheel',
        requestId: 'req-1',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.templateId).toBe('take_the_wheel');
        expect(result.receiptHash).toBe('hash-123');
      }
      expect(client.intentSchema).toHaveBeenCalledWith('session_start');
      expect(client.intentCompile).toHaveBeenCalledWith(
        'schema-abc',
        'session_start',
        expect.objectContaining({
          profile: 'greenfield',
          template_id: 'take_the_wheel',
          template_version: '1.0.0',
        }),
      );
      expect(manager.getState().appliedTemplateId).toBe('take_the_wheel');
    });

    it('persists after successful apply', async () => {
      await manager.applyTemplate({ templateId: 'look_around', requestId: 'req-2' });
      expect(io.writeFileSync).toHaveBeenCalled();
      expect(io.renameSync).toHaveBeenCalled();
    });

    it('returns UNKNOWN_TEMPLATE for invalid ID', async () => {
      const result = await manager.applyTemplate({
        templateId: 'nonexistent',
        requestId: 'req-3',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN_TEMPLATE');
      }
    });

    it('returns CONFIRM_REQUIRED for unrestricted without confirmed', async () => {
      const result = await manager.applyTemplate({
        templateId: 'unrestricted',
        requestId: 'req-4',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONFIRM_REQUIRED');
      }
      // appliedTemplateId unchanged
      expect(manager.getState().appliedTemplateId).toBe('help_me_edit');
    });

    it('applies unrestricted with confirmed: true', async () => {
      const result = await manager.applyTemplate({
        templateId: 'unrestricted',
        confirmed: true,
        requestId: 'req-5',
      });

      expect(result.ok).toBe(true);
      expect(manager.getState().appliedTemplateId).toBe('unrestricted');
    });

    it('returns DAEMON_NOT_READY when client is null', async () => {
      const mgr = new TemplateManager(null, '/gov', io);
      const result = await mgr.applyTemplate({
        templateId: 'look_around',
        requestId: 'req-6',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAEMON_NOT_READY');
      }
    });

    it('returns DAEMON_NOT_READY when client is not running', async () => {
      const stoppedClient = mockClient({ isRunning: false });
      const mgr = new TemplateManager(stoppedClient, '/gov', io);
      const result = await mgr.applyTemplate({
        templateId: 'look_around',
        requestId: 'req-7',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('DAEMON_NOT_READY');
      }
    });

    it('does not change appliedTemplateId on compile failure', async () => {
      const failClient = mockClient({
        intentCompile: vi.fn().mockRejectedValue(new Error('compile boom')),
      });
      const mgr = new TemplateManager(failClient, '/gov', io);

      const result = await mgr.applyTemplate({
        templateId: 'take_the_wheel',
        requestId: 'req-8',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('COMPILE_FAILED');
      }
      expect(mgr.getState().appliedTemplateId).toBe('help_me_edit');
    });

    it('does not persist on compile failure', async () => {
      const failClient = mockClient({
        intentCompile: vi.fn().mockRejectedValue(new Error('compile boom')),
      });
      const mgr = new TemplateManager(failClient, '/gov', io);

      await mgr.applyTemplate({ templateId: 'take_the_wheel', requestId: 'req-9' });

      expect(io.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('schema caching', () => {
    it('calls intentSchema only once across multiple applies', async () => {
      await manager.applyTemplate({ templateId: 'look_around', requestId: 'req-a' });
      await manager.applyTemplate({ templateId: 'take_the_wheel', requestId: 'req-b' });

      expect(client.intentSchema).toHaveBeenCalledTimes(1);
    });

    it('retries once on schema error then fails', async () => {
      let callCount = 0;
      const schemaClient = mockClient({
        intentCompile: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount <= 2) {
            throw new Error('unknown schema mismatch');
          }
          return { receipt_hash: 'ok' };
        }),
        intentSchema: vi.fn()
          .mockResolvedValueOnce('stale-schema')
          .mockResolvedValueOnce('fresh-schema'),
      });
      const mgr = new TemplateManager(schemaClient, '/gov', io);

      // First call: compile fails with schema error → clears cache → refetches → retries compile → fails again → COMPILE_FAILED
      const result = await mgr.applyTemplate({ templateId: 'look_around', requestId: 'req-c' });
      expect(result.ok).toBe(false);
      // intentSchema called twice: once initially, once on retry
      expect(schemaClient.intentSchema).toHaveBeenCalledTimes(2);
    });

    it('succeeds on schema retry when second compile works', async () => {
      let callCount = 0;
      const schemaClient = mockClient({
        intentCompile: vi.fn().mockImplementation(async () => {
          callCount++;
          if (callCount === 1) throw new Error('unknown schema');
          return { receipt_hash: 'ok' };
        }),
        intentSchema: vi.fn()
          .mockResolvedValueOnce('stale')
          .mockResolvedValueOnce('fresh'),
      });
      const mgr = new TemplateManager(schemaClient, '/gov', io);

      const result = await mgr.applyTemplate({ templateId: 'look_around', requestId: 'req-d' });
      expect(result.ok).toBe(true);
      expect(schemaClient.intentSchema).toHaveBeenCalledTimes(2);
    });
  });

  describe('race safety', () => {
    it('discards stale apply when applySeq advances', async () => {
      // Create a slow client that lets us interleave
      let resolveFirst: ((v: { receipt_hash?: string }) => void) | undefined;
      const slowClient = mockClient({
        intentCompile: vi.fn()
          .mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }))
          .mockResolvedValueOnce({ receipt_hash: 'second-hash' }),
      });
      const mgr = new TemplateManager(slowClient, '/gov', io);

      // Start first apply (will block)
      const first = mgr.applyTemplate({ templateId: 'look_around', requestId: 'req-1' });

      // Start second apply (completes immediately)
      const second = await mgr.applyTemplate({ templateId: 'take_the_wheel', requestId: 'req-2' });

      // Now resolve the first
      resolveFirst!({ receipt_hash: 'first-hash' });
      await first;

      // Second apply won — take_the_wheel is applied
      expect(mgr.getState().appliedTemplateId).toBe('take_the_wheel');
    });
  });

  describe('loadPersistedSelection', () => {
    it('loads valid persisted template', () => {
      const data = JSON.stringify({
        schema_version: 1,
        template_id: 'take_the_wheel',
        template_version: '1.0.0',
        applied_profile: 'greenfield',
        applied_at: '2026-03-02T00:00:00Z',
        confirmed_at: null,
      });
      const fileIO = mockIO({ '/gov/clerk-template.json': data });
      const mgr = new TemplateManager(client, '/gov', fileIO);
      mgr.loadPersistedSelection();

      expect(mgr.getState().selectedTemplateId).toBe('take_the_wheel');
    });

    it('falls back to default for unknown template ID', () => {
      const data = JSON.stringify({
        schema_version: 1,
        template_id: 'deleted_template',
        template_version: '1.0.0',
        applied_profile: 'foo',
        applied_at: '2026-03-02T00:00:00Z',
        confirmed_at: null,
      });
      const fileIO = mockIO({ '/gov/clerk-template.json': data });
      const mgr = new TemplateManager(client, '/gov', fileIO);
      mgr.loadPersistedSelection();

      expect(mgr.getState().selectedTemplateId).toBe(DEFAULT_TEMPLATE_ID);
    });

    it('falls back to default for invalid JSON', () => {
      const fileIO = mockIO({ '/gov/clerk-template.json': '{broken' });
      const mgr = new TemplateManager(client, '/gov', fileIO);
      mgr.loadPersistedSelection();

      expect(mgr.getState().selectedTemplateId).toBe(DEFAULT_TEMPLATE_ID);
    });

    it('falls back when confirmation-required template lacks confirmed_at', () => {
      const data = JSON.stringify({
        schema_version: 1,
        template_id: 'unrestricted',
        template_version: '1.0.0',
        applied_profile: 'permissive',
        applied_at: '2026-03-02T00:00:00Z',
        confirmed_at: null,
      });
      const fileIO = mockIO({ '/gov/clerk-template.json': data });
      const mgr = new TemplateManager(client, '/gov', fileIO);
      mgr.loadPersistedSelection();

      expect(mgr.getState().selectedTemplateId).toBe(DEFAULT_TEMPLATE_ID);
      expect(mgr.getState().lastError?.code).toBe('CONFIRM_REQUIRED');
    });

    it('loads confirmation-required template when confirmed_at present', () => {
      const data = JSON.stringify({
        schema_version: 1,
        template_id: 'unrestricted',
        template_version: '1.0.0',
        applied_profile: 'permissive',
        applied_at: '2026-03-02T00:00:00Z',
        confirmed_at: '2026-03-02T00:00:00Z',
      });
      const fileIO = mockIO({ '/gov/clerk-template.json': data });
      const mgr = new TemplateManager(client, '/gov', fileIO);
      mgr.loadPersistedSelection();

      expect(mgr.getState().selectedTemplateId).toBe('unrestricted');
    });

    it('does nothing when no persisted file exists', () => {
      const fileIO = mockIO();
      const mgr = new TemplateManager(client, '/gov', fileIO);
      mgr.loadPersistedSelection();

      expect(mgr.getState().selectedTemplateId).toBe(DEFAULT_TEMPLATE_ID);
    });
  });

  describe('applyPersistedTemplate', () => {
    it('applies persisted selection on startup', async () => {
      const data = JSON.stringify({
        schema_version: 1,
        template_id: 'take_the_wheel',
        template_version: '1.0.0',
        applied_profile: 'greenfield',
        applied_at: '2026-03-02T00:00:00Z',
        confirmed_at: null,
      });
      const fileIO = mockIO({ '/gov/clerk-template.json': data });
      const mgr = new TemplateManager(client, '/gov', fileIO);
      mgr.loadPersistedSelection();

      const result = await mgr.applyPersistedTemplate();
      expect(result.ok).toBe(true);
      expect(mgr.getState().appliedTemplateId).toBe('take_the_wheel');
    });

    it('applies unrestricted with persisted confirmation', async () => {
      const data = JSON.stringify({
        schema_version: 1,
        template_id: 'unrestricted',
        template_version: '1.0.0',
        applied_profile: 'permissive',
        applied_at: '2026-03-02T00:00:00Z',
        confirmed_at: '2026-03-02T00:00:00Z',
      });
      const fileIO = mockIO({ '/gov/clerk-template.json': data });
      const mgr = new TemplateManager(client, '/gov', fileIO);
      mgr.loadPersistedSelection();

      const result = await mgr.applyPersistedTemplate();
      expect(result.ok).toBe(true);
      expect(mgr.getState().appliedTemplateId).toBe('unrestricted');
    });
  });
});

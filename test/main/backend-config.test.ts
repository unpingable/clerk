// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import {
  buildDaemonConf,
  validateBackendConfig,
  readDaemonConf,
  writeDaemonConf,
  probeBackend,
} from '../../src/main/backend-config';
import type { BackendConfigIO } from '../../src/main/backend-config';
import type { BackendConfig } from '../../src/shared/types';

function makeIO(files: Record<string, string> = {}): BackendConfigIO {
  const store = new Map(Object.entries(files));
  return {
    readFileSync: (p: string) => {
      const v = store.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    writeFileSync: (p: string, d: string) => { store.set(p, d); },
    renameSync: (src: string, dst: string) => {
      const v = store.get(src);
      if (v === undefined) throw new Error('ENOENT');
      store.set(dst, v);
      store.delete(src);
    },
    existsSync: (p: string) => store.has(p),
    unlinkSync: (p: string) => { store.delete(p); },
  };
}

// ---------------------------------------------------------------------------
// buildDaemonConf
// ---------------------------------------------------------------------------

describe('buildDaemonConf', () => {
  it('builds anthropic config', () => {
    const conf = buildDaemonConf({ type: 'anthropic', apiKey: 'sk-ant-test' });
    expect(conf).toContain('[backend]');
    expect(conf).toContain('type = anthropic');
    expect(conf).toContain('anthropic.api_key = sk-ant-test');
  });

  it('builds ollama config with default URL', () => {
    const conf = buildDaemonConf({ type: 'ollama' });
    expect(conf).toContain('type = ollama');
    expect(conf).toContain('ollama.url = http://localhost:11434');
  });

  it('builds ollama config with custom URL', () => {
    const conf = buildDaemonConf({ type: 'ollama', ollamaUrl: 'http://myhost:8080' });
    expect(conf).toContain('ollama.url = http://myhost:8080');
  });

  it('builds claude-code config', () => {
    const conf = buildDaemonConf({ type: 'claude-code' });
    expect(conf).toContain('type = claude-code');
    expect(conf).not.toContain('api_key');
  });

  it('builds codex config', () => {
    const conf = buildDaemonConf({ type: 'codex' });
    expect(conf).toContain('type = codex');
  });

  it('trims whitespace from API key', () => {
    const conf = buildDaemonConf({ type: 'anthropic', apiKey: '  sk-ant-test  ' });
    expect(conf).toContain('anthropic.api_key = sk-ant-test');
  });
});

// ---------------------------------------------------------------------------
// validateBackendConfig
// ---------------------------------------------------------------------------

describe('validateBackendConfig', () => {
  it('rejects missing API key for anthropic', () => {
    expect(validateBackendConfig({ type: 'anthropic' })).toContain('API key');
  });

  it('rejects empty trimmed API key for anthropic', () => {
    expect(validateBackendConfig({ type: 'anthropic', apiKey: '   ' })).toContain('API key');
  });

  it('accepts valid anthropic config', () => {
    expect(validateBackendConfig({ type: 'anthropic', apiKey: 'sk-ant-test' })).toBeNull();
  });

  it('rejects API key with newlines', () => {
    expect(validateBackendConfig({ type: 'anthropic', apiKey: 'sk-ant\ninjected' })).toContain('invalid characters');
  });

  it('rejects invalid ollama URL', () => {
    expect(validateBackendConfig({ type: 'ollama', ollamaUrl: 'not-a-url' })).toContain('not a valid URL');
  });

  it('rejects ftp:// ollama URL', () => {
    expect(validateBackendConfig({ type: 'ollama', ollamaUrl: 'ftp://localhost' })).toContain('http or https');
  });

  it('accepts valid ollama URL', () => {
    expect(validateBackendConfig({ type: 'ollama', ollamaUrl: 'http://localhost:11434' })).toBeNull();
  });

  it('accepts ollama with empty URL (defaults)', () => {
    expect(validateBackendConfig({ type: 'ollama' })).toBeNull();
  });

  it('accepts claude-code with no extra fields', () => {
    expect(validateBackendConfig({ type: 'claude-code' })).toBeNull();
  });

  it('accepts codex with no extra fields', () => {
    expect(validateBackendConfig({ type: 'codex' })).toBeNull();
  });

  it('rejects invalid type', () => {
    expect(validateBackendConfig({ type: 'invalid' as any })).toContain('Invalid backend');
  });
});

// ---------------------------------------------------------------------------
// readDaemonConf
// ---------------------------------------------------------------------------

describe('readDaemonConf', () => {
  it('returns null when file does not exist', () => {
    const io = makeIO();
    expect(readDaemonConf('/gov', io)).toBeNull();
  });

  it('parses valid anthropic config', () => {
    const io = makeIO({
      '/gov/daemon.conf': '[backend]\ntype = anthropic\nanthropic.api_key = sk-test\n',
    });
    const config = readDaemonConf('/gov', io);
    expect(config).toEqual({ type: 'anthropic', apiKey: 'sk-test' });
  });

  it('parses valid ollama config', () => {
    const io = makeIO({
      '/gov/daemon.conf': '[backend]\ntype = ollama\nollama.url = http://myhost:8080\n',
    });
    const config = readDaemonConf('/gov', io);
    expect(config).toEqual({ type: 'ollama', ollamaUrl: 'http://myhost:8080' });
  });

  it('returns null for corrupt file', () => {
    const io = makeIO({
      '/gov/daemon.conf': 'not ini at all {{{}}}',
    });
    expect(readDaemonConf('/gov', io)).toBeNull();
  });

  it('round-trips through buildDaemonConf', () => {
    const original: BackendConfig = { type: 'anthropic', apiKey: 'sk-ant-round' };
    const ini = buildDaemonConf(original);
    const io = makeIO({ '/gov/daemon.conf': ini });
    const parsed = readDaemonConf('/gov', io);
    expect(parsed).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// writeDaemonConf
// ---------------------------------------------------------------------------

describe('writeDaemonConf', () => {
  it('writes atomically via tmp + rename', () => {
    const io = makeIO();
    writeDaemonConf('/gov', { type: 'codex' }, io);
    expect(io.existsSync('/gov/daemon.conf')).toBe(true);
    expect(io.readFileSync('/gov/daemon.conf', 'utf-8')).toContain('type = codex');
    // tmp file should not remain
    expect(io.existsSync('/gov/daemon.conf.tmp')).toBe(false);
  });

  it('throws on invalid config', () => {
    const io = makeIO();
    expect(() => writeDaemonConf('/gov', { type: 'anthropic' }, io)).toThrow('API key');
  });
});

// ---------------------------------------------------------------------------
// probeBackend
// ---------------------------------------------------------------------------

describe('probeBackend', () => {
  it('returns daemon_unhealthy when no config and unhealthy', async () => {
    const client = {
      health: vi.fn().mockRejectedValue(new Error('down')),
      listModels: vi.fn(),
    };
    const io = makeIO();
    const status = await probeBackend(client, '/gov', io);
    expect(status.state).toBe('daemon_unhealthy');
  });

  it('returns missing when no config, healthy, no models', async () => {
    const client = {
      health: vi.fn().mockResolvedValue({ status: 'ok' }),
      listModels: vi.fn().mockResolvedValue([]),
    };
    const io = makeIO();
    const status = await probeBackend(client, '/gov', io);
    expect(status.state).toBe('missing');
  });

  it('returns unreachable when config exists but unhealthy', async () => {
    const client = {
      health: vi.fn().mockRejectedValue(new Error('down')),
      listModels: vi.fn(),
    };
    const io = makeIO({
      '/gov/daemon.conf': '[backend]\ntype = anthropic\nanthropic.api_key = sk-test\n',
    });
    const status = await probeBackend(client, '/gov', io);
    expect(status.state).toBe('unreachable');
    expect(status.type).toBe('anthropic');
    // apiKey should NOT be in existingConfig
    expect(status.existingConfig?.apiKey).toBeUndefined();
  });

  it('returns no_models when config, healthy, empty models', async () => {
    const client = {
      health: vi.fn().mockResolvedValue({ status: 'ok' }),
      listModels: vi.fn().mockResolvedValue([]),
    };
    const io = makeIO({
      '/gov/daemon.conf': '[backend]\ntype = ollama\n',
    });
    const status = await probeBackend(client, '/gov', io);
    expect(status.state).toBe('no_models');
    expect(status.type).toBe('ollama');
  });

  it('returns ready when config, healthy, models present', async () => {
    const client = {
      health: vi.fn().mockResolvedValue({ status: 'ok' }),
      listModels: vi.fn().mockResolvedValue([{ id: 'm1', name: 'Model 1', backend: 'anthropic' }]),
    };
    const io = makeIO({
      '/gov/daemon.conf': '[backend]\ntype = anthropic\nanthropic.api_key = sk-test\n',
    });
    const status = await probeBackend(client, '/gov', io);
    expect(status.state).toBe('ready');
    expect(status.models).toHaveLength(1);
  });

  it('returns ready when no config but models are available (auto-detect)', async () => {
    const client = {
      health: vi.fn().mockResolvedValue({ status: 'ok' }),
      listModels: vi.fn().mockResolvedValue([{ id: 'm1', name: 'Model 1', backend: 'anthropic' }]),
    };
    const io = makeIO();
    const status = await probeBackend(client, '/gov', io);
    expect(status.state).toBe('ready');
  });
});

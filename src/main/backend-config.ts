// SPDX-License-Identifier: Apache-2.0
/**
 * Backend configuration — daemon.conf generation, validation, and probing.
 *
 * The daemon reads `daemon.conf` (INI format) from $GOVERNOR_DIR.
 * Backend config is per-governor-dir, not per-user.
 *
 * DI pattern for testability (same as SettingsManager).
 */

import path from 'node:path';
import type { BackendConfig, BackendType, BackendStatus, ModelInfo } from '../shared/types.js';

// ---------------------------------------------------------------------------
// IO interface (DI)
// ---------------------------------------------------------------------------

export interface BackendConfigIO {
  writeFileSync(path: string, data: string): void;
  renameSync(src: string, dst: string): void;
  existsSync(path: string): boolean;
  unlinkSync(path: string): void;
  readFileSync(path: string, encoding: 'utf-8'): string;
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

const VALID_TYPES: ReadonlySet<string> = new Set(['anthropic', 'ollama', 'claude-code', 'codex']);

/** Reject values with embedded newlines (INI injection). */
function hasNewlines(s: string): boolean {
  return s.includes('\n') || s.includes('\r');
}

/**
 * Validate a BackendConfig. Returns an error string or null if valid.
 */
export function validateBackendConfig(config: BackendConfig): string | null {
  if (!config || !VALID_TYPES.has(config.type)) {
    return 'Invalid backend type.';
  }

  if (config.type === 'anthropic') {
    const key = config.apiKey?.trim();
    if (!key) return 'API key is required for Anthropic.';
    if (hasNewlines(key)) return 'API key contains invalid characters.';
  }

  if (config.ollamaUrl !== undefined && config.ollamaUrl !== '') {
    if (hasNewlines(config.ollamaUrl)) return 'URL contains invalid characters.';
    try {
      const url = new URL(config.ollamaUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return 'Ollama URL must use http or https.';
      }
    } catch {
      return 'Ollama URL is not a valid URL.';
    }
  }

  // Check all string values for newlines
  if (config.apiKey && hasNewlines(config.apiKey)) return 'API key contains invalid characters.';

  return null;
}

/**
 * Build a daemon.conf INI string from a BackendConfig.
 */
export function buildDaemonConf(config: BackendConfig): string {
  const lines: string[] = ['[backend]', `type = ${config.type}`];

  if (config.type === 'anthropic' && config.apiKey) {
    lines.push(`anthropic.api_key = ${config.apiKey.trim()}`);
  }

  if (config.type === 'ollama') {
    const url = config.ollamaUrl?.trim() || 'http://localhost:11434';
    lines.push(`ollama.url = ${url}`);
  }

  return lines.join('\n') + '\n';
}

/**
 * Read and parse an existing daemon.conf. Returns null if missing or corrupt.
 */
export function readDaemonConf(governorDir: string, io: BackendConfigIO): BackendConfig | null {
  const confPath = path.join(governorDir, 'daemon.conf');
  try {
    if (!io.existsSync(confPath)) return null;
    const raw = io.readFileSync(confPath, 'utf-8');
    return parseDaemonConf(raw);
  } catch {
    return null;
  }
}

/**
 * Parse INI content into a BackendConfig. Minimal parser — only reads [backend] section.
 */
function parseDaemonConf(raw: string): BackendConfig | null {
  const lines = raw.split(/\r?\n/);
  let inBackend = false;
  const kv = new Map<string, string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '[backend]') { inBackend = true; continue; }
    if (trimmed.startsWith('[')) { inBackend = false; continue; }
    if (!inBackend) continue;
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    kv.set(key, val);
  }

  const type = kv.get('type');
  if (!type || !VALID_TYPES.has(type)) return null;

  const config: BackendConfig = { type: type as BackendType };

  if (type === 'anthropic') {
    const key = kv.get('anthropic.api_key');
    if (key) config.apiKey = key;
  }

  if (type === 'ollama') {
    const url = kv.get('ollama.url');
    if (url) config.ollamaUrl = url;
  }

  return config;
}

/**
 * Write daemon.conf atomically (tmp + rename).
 * Validates before writing — throws on invalid config.
 */
export function writeDaemonConf(governorDir: string, config: BackendConfig, io: BackendConfigIO): void {
  const err = validateBackendConfig(config);
  if (err) throw new Error(err);

  const confPath = path.join(governorDir, 'daemon.conf');
  const tmpPath = confPath + '.tmp';
  const content = buildDaemonConf(config);

  io.writeFileSync(tmpPath, content);

  try {
    if (io.existsSync(confPath)) {
      io.unlinkSync(confPath);
    }
  } catch {
    // Best effort
  }

  io.renameSync(tmpPath, confPath);
}

// ---------------------------------------------------------------------------
// Canonical probe
// ---------------------------------------------------------------------------

export interface ProbeClient {
  health(): Promise<{ status: string }>;
  chatModels(): Promise<ModelInfo[]>;
}

/**
 * Probe the backend state. Used by both BACKEND_STATUS and BACKEND_CONFIGURE handlers.
 */
export async function probeBackend(
  client: ProbeClient,
  governorDir: string,
  io: BackendConfigIO,
): Promise<BackendStatus> {
  const config = readDaemonConf(governorDir, io);

  let healthy = false;
  try {
    const h = await client.health();
    healthy = h.status === 'ok';
  } catch {
    healthy = false;
  }

  // Strip apiKey from config before sending to renderer
  const safeConfig = config
    ? { type: config.type, ollamaUrl: config.ollamaUrl } as BackendConfig
    : undefined;

  if (!healthy && !config) {
    return { state: 'daemon_unhealthy', models: [], message: 'Clerk engine is not ready.' };
  }
  if (!healthy && config) {
    return {
      state: 'unreachable',
      type: config.type,
      models: [],
      message: `Couldn't reach ${config.type} backend.`,
      existingConfig: safeConfig,
    };
  }

  // Daemon healthy — check models
  let models: ModelInfo[] = [];
  try {
    models = await client.chatModels();
  } catch {
    models = [];
  }

  if (!config && models.length === 0) {
    return { state: 'missing', models: [], message: 'No backend configured.' };
  }
  if (config && models.length === 0) {
    return {
      state: 'no_models',
      type: config.type,
      models: [],
      message: 'Connected but no models available.',
      existingConfig: safeConfig,
    };
  }

  return { state: 'ready', type: config?.type, models };
}

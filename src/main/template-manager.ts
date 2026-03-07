// SPDX-License-Identifier: Apache-2.0
/**
 * TemplateManager — applies constraint templates via intent.compile.
 *
 * Safety contracts:
 * - Confirmation enforcement: requiresConfirmation templates need confirmed: true
 * - Startup confirmation: persisted confirmed_at required for confirmation templates
 * - Race safety: monotonic applySeq discards stale results
 * - Persist only on success: atomic write (tmp+rename) after compile succeeds
 * - Schema cache with invalidation: cached after first fetch, cleared on mismatch
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID, getTemplateById, getDefaultTemplate } from '../shared/templates.js';
import type { AppliedModeInfo } from '../shared/activity-types.js';
import type {
  TemplateApplyRequest,
  TemplateApplyResult,
  TemplateState,
  TemplatesListResult,
  TemplateApplyErrorCode,
  IntentSchemaResult,
  IntentCompileResult,
} from '../shared/types.js';
import type { GovernorClient } from './rpc-client.js';
import type { ActivityRecorder } from './activity-manager.js';
import { activitySummary } from './activity-summary.js';

interface PersistedTemplate {
  schema_version: number;
  template_id: string;
  template_version: string;
  applied_profile: string;
  applied_at: string;
  confirmed_at: string | null;
}

/** Subset of GovernorClient used by TemplateManager, for testability. */
export interface TemplateManagerClient {
  intentSchema(templateName: string): Promise<IntentSchemaResult>;
  intentCompile(schemaId: string, templateName: string, values: Record<string, unknown>): Promise<IntentCompileResult>;
  readonly isRunning: boolean;
}

/** Filesystem operations — injectable for testing. */
export interface TemplateManagerIO {
  readFileSync(path: string, encoding: 'utf-8'): string;
  writeFileSync(path: string, data: string): void;
  renameSync(src: string, dst: string): void;
  existsSync(path: string): boolean;
  mkdirSync(path: string, opts: { recursive: boolean }): void;
  realpathSync(path: string): string;
}

const defaultIO: TemplateManagerIO = {
  readFileSync: (p, enc) => fs.readFileSync(p, enc),
  writeFileSync: (p, d) => fs.writeFileSync(p, d),
  renameSync: (s, d) => fs.renameSync(s, d),
  existsSync: (p) => fs.existsSync(p),
  mkdirSync: (p, o) => fs.mkdirSync(p, o),
  realpathSync: (p) => fs.realpathSync(p),
};

export class TemplateManager {
  private client: TemplateManagerClient | null;
  private governorDir: string;
  private io: TemplateManagerIO;
  private recorder: ActivityRecorder | null;

  private selectedTemplateId: string = DEFAULT_TEMPLATE_ID;
  private appliedTemplateId: string = DEFAULT_TEMPLATE_ID;
  private applying = false;
  private applySeq = 0;
  private lastError?: { code: TemplateApplyErrorCode; message: string };
  private lastReceiptHash?: string;
  private lastCompileResult?: IntentCompileResult;
  private cachedSchemaId: string | null = null;

  constructor(
    client: TemplateManagerClient | null,
    governorDir: string,
    io: TemplateManagerIO = defaultIO,
    recorder: ActivityRecorder | null = null,
  ) {
    this.client = client;
    this.governorDir = governorDir;
    this.io = io;
    this.recorder = recorder;
  }

  private get persistPath(): string {
    return path.join(this.governorDir, 'clerk-template.json');
  }

  private get canonicalDir(): string {
    try {
      return this.io.realpathSync(this.governorDir);
    } catch {
      return this.governorDir;
    }
  }

  // --- Public API ---

  listTemplates(): TemplatesListResult {
    return {
      templates: [...BUILTIN_TEMPLATES],
      defaultTemplateId: DEFAULT_TEMPLATE_ID,
    };
  }

  getAppliedModeInfo(): AppliedModeInfo {
    const tmpl = getTemplateById(this.appliedTemplateId) ?? getDefaultTemplate();
    return {
      templateId: tmpl.id,
      templateName: tmpl.name,
      templateVersion: tmpl.version,
      governorProfile: tmpl.governorProfile,
    };
  }

  getState(): TemplateState {
    return {
      defaultTemplateId: DEFAULT_TEMPLATE_ID,
      selectedTemplateId: this.selectedTemplateId,
      appliedTemplateId: this.appliedTemplateId,
      applying: this.applying,
      lastError: this.lastError,
      lastReceiptHash: this.lastReceiptHash,
      applySeq: this.applySeq,
    };
  }

  async applyTemplate(req: TemplateApplyRequest): Promise<TemplateApplyResult> {
    const { templateId, confirmed, requestId } = req;

    // Validate template exists
    const template = getTemplateById(templateId);
    if (!template) {
      return this.errorResult(requestId, 'UNKNOWN_TEMPLATE', `Unknown template: ${templateId}`);
    }

    // Confirmation enforcement
    if (template.requiresConfirmation && !confirmed) {
      return this.errorResult(requestId, 'CONFIRM_REQUIRED', 'This template requires explicit confirmation.');
    }

    // Check daemon readiness
    if (!this.client || !this.client.isRunning) {
      // Still update selected so UI reflects choice
      this.selectedTemplateId = templateId;
      return this.errorResult(requestId, 'DAEMON_NOT_READY', 'Governor daemon is not running.');
    }

    // Capture previous mode for activity event
    const previousMode = this.getAppliedModeInfo();

    // Begin apply — bump seq, set applying
    this.selectedTemplateId = templateId;
    this.applying = true;
    this.lastError = undefined;
    this.applySeq++;
    const seq = this.applySeq;

    try {
      // Schema fetch (cached)
      if (!this.cachedSchemaId) {
        const schema = await this.client.intentSchema('session_start');
        this.cachedSchemaId = schema.schema_id;
      }

      // Real daemon fields — profile is the primary lever, scope/mode are optional
      const compileValues: Record<string, unknown> = {
        profile: template.governorProfile,
      };

      let result: IntentCompileResult;
      try {
        result = await this.client.intentCompile(this.cachedSchemaId, 'session_start', compileValues);
      } catch (err) {
        // Schema cache invalidation: retry once on schema mismatch
        if (isSchemaError(err)) {
          this.cachedSchemaId = null;
          const schema = await this.client.intentSchema('session_start');
          this.cachedSchemaId = schema.schema_id;
          result = await this.client.intentCompile(this.cachedSchemaId, 'session_start', compileValues);
        } else {
          throw err;
        }
      }

      // Log warnings from daemon (non-fatal)
      if (result.warnings?.length) {
        console.error(`[template-manager] compile warnings:`, result.warnings);
      }

      // Race check — if another apply happened while we were awaiting, discard
      if (seq !== this.applySeq) {
        return this.discardResult(requestId);
      }

      // Success
      this.appliedTemplateId = templateId;
      this.applying = false;
      this.lastReceiptHash = result.receipt_hash;
      this.lastCompileResult = result;

      // Persist atomically
      try {
        this.persist(template, confirmed);
      } catch (err) {
        // Persist failure is non-fatal — apply succeeded at daemon level
        console.error('[template-manager] persist failed:', err);
      }

      // Record successful mode change
      this.recordModeChange(template.name, true, undefined, previousMode);

      return {
        ok: true,
        requestId,
        templateId,
        receiptHash: result.receipt_hash,
        state: this.getState(),
      };
    } catch (err) {
      // Race check before setting error
      if (seq !== this.applySeq) {
        return this.discardResult(requestId);
      }

      this.applying = false;
      const raw = err instanceof Error ? err.message : String(err);
      const message = /timed?\s*out/i.test(raw) ? "Couldn't apply that mode in time. Try again."
        : /^RPC\s+-?\d+/i.test(raw) || /jsonrpc|method.*not\s+found/i.test(raw) ? "Couldn't apply that mode. The engine may need updating."
        : raw;
      this.lastError = { code: 'COMPILE_FAILED', message };

      // Record failed mode change
      this.recordModeChange(template.name, false, message, previousMode);

      return {
        ok: false,
        requestId,
        error: { code: 'COMPILE_FAILED', message },
        state: this.getState(),
      };
    }
  }

  /**
   * Apply persisted template on startup. Confirmation-required templates
   * are only applied if confirmed_at is present in the persisted data.
   */
  async applyPersistedTemplate(): Promise<TemplateApplyResult> {
    const template = getTemplateById(this.selectedTemplateId);
    if (!template) {
      return this.applyTemplate({
        templateId: DEFAULT_TEMPLATE_ID,
        confirmed: false,
        requestId: crypto.randomUUID(),
      });
    }

    // For confirmation-required templates, check confirmed_at from persistence
    const confirmed = template.requiresConfirmation ? this.hasPersistedConfirmation() : false;

    return this.applyTemplate({
      templateId: this.selectedTemplateId,
      confirmed,
      requestId: crypto.randomUUID(),
    });
  }

  /**
   * Load persisted template selection. Sync — called at startup before
   * any async work. Validates template ID still exists and checks
   * confirmation markers.
   */
  loadPersistedSelection(): void {
    try {
      if (!this.io.existsSync(this.persistPath)) return;

      const raw = this.io.readFileSync(this.persistPath, 'utf-8');
      const data = JSON.parse(raw) as Partial<PersistedTemplate>;

      if (data.schema_version !== 1 || typeof data.template_id !== 'string') {
        console.error('[template-manager] invalid persisted template, using default');
        return;
      }

      const template = getTemplateById(data.template_id);
      if (!template) {
        console.error(`[template-manager] persisted template "${data.template_id}" no longer exists, using default`);
        return;
      }

      // Startup confirmation enforcement
      if (template.requiresConfirmation && !data.confirmed_at) {
        console.error(`[template-manager] persisted template "${data.template_id}" requires confirmation but confirmed_at is missing, using default`);
        this.lastError = {
          code: 'CONFIRM_REQUIRED',
          message: `Template "${template.name}" requires confirmation. Reverted to default.`,
        };
        return;
      }

      this.selectedTemplateId = data.template_id;
    } catch (err) {
      console.error('[template-manager] failed to load persisted template:', err);
    }
  }

  // --- Private helpers ---

  private hasPersistedConfirmation(): boolean {
    try {
      if (!this.io.existsSync(this.persistPath)) return false;
      const raw = this.io.readFileSync(this.persistPath, 'utf-8');
      const data = JSON.parse(raw) as Partial<PersistedTemplate>;
      return !!data.confirmed_at;
    } catch {
      return false;
    }
  }

  private persist(template: { id: string; version: string; governorProfile: string; requiresConfirmation: boolean }, confirmed?: boolean): void {
    const dir = path.dirname(this.persistPath);
    if (!this.io.existsSync(dir)) {
      this.io.mkdirSync(dir, { recursive: true });
    }

    const data: PersistedTemplate = {
      schema_version: 1,
      template_id: template.id,
      template_version: template.version,
      applied_profile: template.governorProfile,
      applied_at: new Date().toISOString(),
      confirmed_at: (template.requiresConfirmation && confirmed) ? new Date().toISOString() : null,
    };

    const tmpPath = this.persistPath + '.tmp';
    this.io.writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    this.io.renameSync(tmpPath, this.persistPath);
  }

  private errorResult(
    requestId: string,
    code: TemplateApplyErrorCode,
    message: string,
  ): TemplateApplyResult {
    this.lastError = { code, message };
    return {
      ok: false,
      requestId,
      error: { code, message },
      state: this.getState(),
    };
  }

  private recordModeChange(
    templateName: string,
    allowed: boolean,
    reason?: string,
    previousMode?: AppliedModeInfo,
  ): void {
    if (!this.recorder) return;
    this.recorder.record({
      kind: 'mode_change',
      allowed,
      decisionSource: 'daemon',
      reason,
      summary: activitySummary('mode_change', undefined, allowed, { templateName }),
      details: previousMode ? { previousMode } : undefined,
    });
  }

  private discardResult(requestId: string): TemplateApplyResult {
    // Return current state — the stale apply is silently discarded
    return {
      ok: true,
      requestId,
      templateId: this.appliedTemplateId,
      state: this.getState(),
    };
  }
}

function isSchemaError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('schema') || msg.includes('unknown schema');
  }
  return false;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * ClerkBackend — the capability-based contract between Clerk and its
 * enforcement/chat backend.
 *
 * Two implementations planned:
 *   - GovernorBackend: full daemon (agent_gov via stdio RPC)
 *   - StandaloneBackend: direct LLM + nlai for text gating (future)
 *
 * The interface is shaped by what Clerk needs to adjudicate, not by
 * how any particular daemon exposes its methods.
 */

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
} from '../shared/types.js';

// --- Capability reporting ---

export interface BackendCapabilities {
  /** Can stream chat to an LLM */
  chat: boolean;
  /** Can gate text output (claims, anchors, receipts) */
  textGating: boolean;
  /** Can gate actions (scope checks for file/tool operations) */
  actionGating: boolean;
  /** Can compile constraint templates via daemon intent API */
  templateCompilation: boolean;
  /** Maintains a receipt history that can be queried */
  receipts: boolean;
  /** Supports interactive violation resolution (commit/waive) */
  violations: boolean;
  /** Exposes governor runtime state (now/status) */
  governorState: boolean;
}

// --- Scope check types ---

export interface ScopeCheckResult {
  allowed: boolean;
  reason: string;
  ask_gate_available?: boolean;
  appliedProfile?: string;
  appliedTemplateId?: string;
}

// --- Stream callback types ---

export interface StreamCallbacks {
  onDelta: (delta: { content?: string }) => void;
  onEnd: (result: {
    receipt?: unknown;
    violations?: unknown[];
    pending?: unknown;
  }) => void;
}

// --- The contract ---

export interface ClerkBackend {
  /** What this backend can do. UI uses this to show/hide/disable features. */
  getCapabilities(): BackendCapabilities;

  /** Is the backend process/connection alive? */
  health(): Promise<HealthResponse>;

  // --- Chat ---

  /** Start a streaming chat turn. Returns a stream ID for tracking. */
  streamChat(
    messages: Array<{ role: string; content: string }>,
    options: Record<string, unknown>,
    callbacks: StreamCallbacks,
  ): Promise<string>;

  /** Non-streaming chat (rarely used, kept for completeness). */
  sendChat(
    messages: Array<{ role: string; content: string }>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;

  /** List available models from the backend. */
  listModels(): Promise<ModelInfo[]>;

  // --- Action gating ---

  /**
   * Check whether a tool action is permitted under current policy.
   * The backend decides based on its own enforcement state.
   */
  checkScope(
    toolId: string,
    scope: Record<string, string>,
  ): Promise<ScopeCheckResult>;

  // --- Receipts ---

  /** List governance receipts. Returns empty if capability not available. */
  listReceipts(filter?: {
    gate?: string;
    verdict?: string;
    limit?: number;
  }): Promise<GateReceipt[]>;

  /** Get receipt details. Throws if capability not available. */
  receiptDetail(id: string): Promise<ReceiptDetail>;

  // --- Violation resolution ---

  commitPending(): Promise<PendingViolation | null>;
  commitFix(correctedText?: string): Promise<ResolutionResult>;
  commitRevise(): Promise<ResolutionResult>;
  commitProceed(reason: string): Promise<ResolutionResult>;

  // --- Governor state (governor-specific, degrades gracefully) ---

  now(): Promise<GovernorNow>;
  status(): Promise<GovernorStatus>;

  // --- Template compilation (governor-specific) ---

  intentSchema(templateName: string): Promise<IntentSchemaResult>;
  intentCompile(
    schemaId: string,
    templateName: string,
    values: Record<string, unknown>,
  ): Promise<IntentCompileResult>;

  // --- Lifecycle ---

  readonly isRunning: boolean;
  start(): void;
  stop(): void;
  restart(): void;
  setProjectDir(dir: string): void;
}

// SPDX-License-Identifier: Apache-2.0
/**
 * GovernorBackend — full daemon backend via agent_gov stdio RPC.
 *
 * Wraps GovernorClient and satisfies both ClerkBackend and the narrow
 * DI interfaces (ToolLoopClient, FileManagerClient, TemplateManagerClient).
 * All capabilities are true — Governor supports everything.
 */

import { GovernorClient } from './rpc-client.js';
import type {
  ClerkBackend,
  BackendCapabilities,
  ScopeCheckResult,
  StreamCallbacks,
} from './backend.js';
import type { ToolLoopClient } from './tool-loop.js';
import type { FileManagerClient } from './file-manager.js';
import type { TemplateManagerClient } from './template-manager.js';
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

const ALL_CAPABILITIES: BackendCapabilities = {
  chat: true,
  textGating: true,
  actionGating: true,
  templateCompilation: true,
  receipts: true,
  violations: true,
  governorState: true,
};

export class GovernorBackend
  implements ClerkBackend, ToolLoopClient, FileManagerClient, TemplateManagerClient
{
  private client: GovernorClient;

  constructor(client: GovernorClient) {
    this.client = client;
  }

  getCapabilities(): BackendCapabilities {
    return { ...ALL_CAPABILITIES };
  }

  // --- Lifecycle ---

  get isRunning(): boolean {
    return this.client.isRunning;
  }

  start(): void {
    this.client.start();
  }

  stop(): void {
    this.client.stop();
  }

  restart(): void {
    this.client.restart();
  }

  setProjectDir(dir: string): void {
    this.client.setGovernorDir(dir);
  }

  // --- Health ---

  health(): Promise<HealthResponse> {
    return this.client.health();
  }

  // --- Chat ---

  async streamChat(
    messages: Array<{ role: string; content: string }>,
    options: Record<string, unknown>,
    callbacks: StreamCallbacks,
  ): Promise<string> {
    return this.client.chatStreamStart(
      messages,
      options,
      callbacks.onDelta,
      callbacks.onEnd,
    );
  }

  /** Satisfies ToolLoopClient — same as streamChat but with positional args. */
  chatStreamStart(
    messages: Array<{ role: string; content: string }>,
    options: Record<string, unknown>,
    onDelta: (delta: { content?: string }) => void,
    onEnd: (result: {
      receipt?: unknown;
      violations?: unknown[];
      pending?: unknown;
    }) => void,
  ): Promise<string> {
    return this.client.chatStreamStart(messages, options, onDelta, onEnd);
  }

  sendChat(
    messages: Array<{ role: string; content: string }>,
    options?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.client.chatSend(messages, options);
  }

  listModels(): Promise<ModelInfo[]> {
    return this.client.chatModels();
  }

  // --- Action gating ---

  scopeCheck(
    toolId: string,
    scope: Record<string, string>,
  ): Promise<ScopeCheckResult> {
    return this.client.scopeCheck(toolId, scope);
  }

  /** Alias for ClerkBackend interface. */
  checkScope(
    toolId: string,
    scope: Record<string, string>,
  ): Promise<ScopeCheckResult> {
    return this.client.scopeCheck(toolId, scope);
  }

  // --- Receipts ---

  listReceipts(filter?: {
    gate?: string;
    verdict?: string;
    limit?: number;
  }): Promise<GateReceipt[]> {
    return this.client.listReceipts(filter);
  }

  receiptDetail(id: string): Promise<ReceiptDetail> {
    return this.client.receiptDetail(id);
  }

  // --- Violation resolution ---

  commitPending(): Promise<PendingViolation | null> {
    return this.client.commitPending();
  }

  commitFix(correctedText?: string): Promise<ResolutionResult> {
    return this.client.commitFix(correctedText);
  }

  commitRevise(): Promise<ResolutionResult> {
    return this.client.commitRevise();
  }

  commitProceed(reason: string): Promise<ResolutionResult> {
    return this.client.commitProceed(reason);
  }

  // --- Governor state ---

  now(): Promise<GovernorNow> {
    return this.client.now();
  }

  status(): Promise<GovernorStatus> {
    return this.client.status();
  }

  // --- Template compilation ---

  intentSchema(templateName: string): Promise<IntentSchemaResult> {
    return this.client.intentSchema(templateName);
  }

  intentCompile(
    schemaId: string,
    templateName: string,
    values: Record<string, unknown>,
  ): Promise<IntentCompileResult> {
    return this.client.intentCompile(schemaId, templateName, values);
  }
}

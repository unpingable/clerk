// SPDX-License-Identifier: Apache-2.0
/** Types shared between main process and renderer. */

// --- Health ---

export interface BackendInfo {
  type: string;
  connected: boolean;
}

export interface GovernorInfo {
  context_id: string;
  mode: string;
  initialized: boolean;
}

export interface HealthResponse {
  status: string;
  backend: BackendInfo;
  governor: GovernorInfo;
}

// --- Chat ---

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  streaming?: boolean;
  receipt?: ReceiptRef | null;
  violations?: ViolationRef[];
}

export interface ReceiptRef {
  receipt_id: string;
  hash: string;
  verdict: string;
  gate: string;
}

export interface ViolationRef {
  violation_id: string;
  anchor_id: string;
  description: string;
  severity: string;
}

export interface ChatStreamDelta {
  streamId: string;
  delta: {
    content?: string;
  };
}

export interface ChatStreamEnd {
  streamId: string;
  result: {
    receipt?: ReceiptRef | null;
    violations?: ViolationRef[];
    pending?: PendingViolation | null;
  };
}

export interface ModelInfo {
  id: string;
  name: string;
  backend: string;
}

// --- Governor State ---

export interface GovernorNow {
  pill: string;
  sentence: string;
  regime?: string;
  suggested_action?: string;
}

export interface GovernorStatus {
  mode: string;
  envelope: string;
  context_id: string;
  facts_count: number;
  decisions_count: number;
  [key: string]: unknown;
}

// --- Gate Receipts ---

export interface GateReceipt {
  receipt_id: string;
  schema_version: string;
  timestamp: string;
  gate: string;
  verdict: string;
  subject_hash: string;
  evidence_hash: string;
  policy_hash: string;
}

export interface ReceiptDetail {
  receipt: GateReceipt;
  evidence: unknown;
}

// --- Commit / Waive ---

export interface PendingViolation {
  violation_id: string;
  anchor_id: string;
  description: string;
  severity: string;
  content_preview: string;
}

export interface ResolutionResult {
  success: boolean;
  action: string;
  message: string;
}

// --- Daemon Resolver ---

export interface DaemonStatusOk {
  ok: true;
  path: string;
  version: string;
  source: 'env' | 'bundled' | 'path';
}

export interface DaemonStatusErr {
  ok: false;
  reason: 'NOT_FOUND' | 'NOT_EXECUTABLE' | 'BAD_BINARY' | 'SPAWN_FAILED';
  detail: string;
  tried: string[];
}

export type DaemonStatus = DaemonStatusOk | DaemonStatusErr;

// --- Constraint Templates ---

export type CapabilityLevel = 'allow' | 'ask' | 'deny';
export type CapabilityKey = 'read' | 'write' | 'execute' | 'network' | 'destructive';
export type CapabilityMap = Record<CapabilityKey, CapabilityLevel>;
export type TemplateOrigin = 'builtin' | 'user';

export interface ConstraintTemplate {
  id: string;
  name: string;
  version: string;
  origin: TemplateOrigin;
  description: string;
  requiresConfirmation: boolean;
  capabilities: CapabilityMap;
  governorProfile: string;
}

export type TemplateApplyErrorCode =
  | 'CONFIRM_REQUIRED'
  | 'UNKNOWN_TEMPLATE'
  | 'DAEMON_NOT_READY'
  | 'COMPILE_FAILED'
  | 'PERSIST_FAILED';

export interface TemplateApplyRequest {
  templateId: string;
  confirmed?: boolean;
  requestId: string;
}

export type TemplateApplyResult =
  | { ok: true;  requestId: string; templateId: string; receiptHash?: string; state: TemplateState }
  | { ok: false; requestId: string; error: { code: TemplateApplyErrorCode; message: string }; state: TemplateState };

export interface TemplateState {
  defaultTemplateId: string;
  selectedTemplateId: string;
  appliedTemplateId: string;
  applying: boolean;
  lastError?: { code: TemplateApplyErrorCode; message: string };
  lastReceiptHash?: string;
  applySeq: number;
}

export interface TemplatesListResult {
  templates: ConstraintTemplate[];
  defaultTemplateId: string;
}

// --- Preload API shape ---

export interface ClerkAPI {
  // Connection
  health(): Promise<HealthResponse>;
  connect(dirOrUrl: string): Promise<void>;

  // Chat
  chatSend(messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>): Promise<unknown>;
  chatStreamStart(messages: Array<{ role: string; content: string }>, options?: Record<string, unknown>): Promise<{ streamId: string }>;
  onChatDelta(cb: (data: ChatStreamDelta) => void): void;
  onChatEnd(cb: (data: ChatStreamEnd) => void): void;
  offChatDelta(): void;
  offChatEnd(): void;
  chatModels(): Promise<ModelInfo[]>;

  // Governor
  now(): Promise<GovernorNow>;
  status(): Promise<GovernorStatus>;

  // Receipts
  receiptsList(filter?: { gate?: string; verdict?: string; limit?: number }): Promise<GateReceipt[]>;
  receiptsDetail(id: string): Promise<ReceiptDetail>;

  // Commit / waive
  commitPending(): Promise<PendingViolation | null>;
  commitFix(correctedText?: string): Promise<ResolutionResult>;
  commitRevise(): Promise<ResolutionResult>;
  commitProceed(reason: string): Promise<ResolutionResult>;

  // Daemon resolver
  daemonStatus(): Promise<DaemonStatus>;

  // Templates
  templatesList(): Promise<TemplatesListResult>;
  templatesCurrent(): Promise<TemplateState>;
  templatesApply(req: TemplateApplyRequest): Promise<TemplateApplyResult>;

  // Connection state events
  onConnectionState(cb: (state: string) => void): void;
  offConnectionState(): void;
}

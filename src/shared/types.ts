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
  fileActions?: FileAction[];
  attachments?: Array<{ name: string; size: number }>;
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
    fileActions?: FileAction[];
    stoppedByUser?: boolean;
  };
}

// --- Ask (interactive approval) ---

export interface AskRequest {
  askId: string;
  streamId: string;
  correlationId: string;
  toolId: string;
  path: string;
  toPath?: string;
  operationLabel: string;
  contentSize?: number;
  contentPreview?: string;
  expectedHash?: string;
}

export type AskDecision = 'allow_once' | 'deny';

export interface AskResponse {
  askId: string;
  decision: AskDecision;
}

export interface AskGrantToken {
  grantId: string;
  streamId: string;
  correlationId: string;
  toolId: string;
  path: string;
  toPath?: string;
  expectedHash?: string;
  usedAt: string | null;
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

// --- Intent (daemon compile contract) ---

export interface IntentSchemaField {
  field_id: string;
  widget: string;
  label: string;
  options?: Array<{ value: string; label: string; confidence?: number }>;
  range?: [number, number];
  default?: unknown;
  required: boolean;
  help_text?: string;
}

export interface IntentSchemaResult {
  schema_id: string;
  template_name: string;
  mode: string;
  policy: string;
  fields: IntentSchemaField[];
  escape_enabled: boolean;
}

export interface ConstraintBlock {
  constraints: Array<{
    id: string;
    kind: string;
    severity: string;
    description: string;
    [key: string]: unknown;
  }>;
  content_hash: string;
  compiled_at: string;
  intent: string;
  scope: string[];
  mode: string;
  envelope: string;
  profile: string;
  exploratory_warning: boolean;
  [key: string]: unknown;
}

export interface IntentCompileResult {
  intent_profile: string;
  intent_scope: string[] | null;
  intent_deny: string[] | null;
  intent_timebox_minutes: number | null;
  constraint_block: ConstraintBlock | null;
  selected_branch: string | null;
  warnings: string[];
  receipt_hash: string;
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

// --- File Operations ---

export type FileErrorCode =
  | 'PATH_DENIED'
  | 'BLOCKED'
  | 'NOT_FOUND'
  | 'FILE_EXISTS'
  | 'DEST_EXISTS'
  | 'NOT_A_DIRECTORY'
  | 'DAEMON_NOT_READY'
  | 'IO_ERROR'
  | 'CONTENT_TOO_LARGE'
  | 'PATH_TOO_LONG'
  | 'BINARY_FILE'
  | 'HASH_MISMATCH'
  | 'INVALID_PATCH'
  | 'PATCH_FAILED'
  | 'ASK_REQUIRED';

export type FileActionStatus =
  | 'allowed'
  | 'blocked'
  | 'ask_pending'
  | 'ask_approved'
  | 'ask_denied';

export interface ScopeDecision {
  allowed: boolean;
  reason: string;
  toolId: string;
  appliedTemplateId: string;
  appliedProfile: string;
  askAvailable?: boolean;
}

export interface FileReadResult {
  ok: true;
  content: string;
  contentHash: string;
  truncated: boolean;
  hashCoversFullFile: boolean;
  resolvedPath: string;
  decision: ScopeDecision;
}

export interface FileWriteResult {
  ok: true;
  resolvedPath: string;
  decision: ScopeDecision;
}

export type FileErrorResult = {
  ok: false;
  code: FileErrorCode;
  message: string;
  decision?: ScopeDecision;
};

export interface DirEntry {
  name: string;
  type: 'file' | 'directory' | 'other';
  size: number;
}

export interface FileListResult {
  ok: true;
  entries: DirEntry[];
  truncated: boolean;
  resolvedPath: string;
  decision: ScopeDecision;
}

export interface FileOverwriteResult {
  ok: true;
  resolvedPath: string;
  decision: ScopeDecision;
}

export interface FileMkdirResult {
  ok: true;
  resolvedPath: string;
  decision: ScopeDecision;
}

export interface FileCopyResult {
  ok: true;
  resolvedSrc: string;
  resolvedDest: string;
  decision: ScopeDecision;
}

export interface FileMoveResult {
  ok: true;
  resolvedSrc: string;
  resolvedDest: string;
  decision: ScopeDecision;
}

export interface FileDeleteResult {
  ok: true;
  resolvedPath: string;
  trashPath: string;
  decision: ScopeDecision;
}

export interface FileFindEntry {
  path: string;
  type: 'file' | 'directory';
}

export interface FileFindResult {
  ok: true;
  entries: FileFindEntry[];
  truncated: boolean;
  decision: ScopeDecision;
}

export interface FileGrepMatch {
  file: string;
  line: number;
  preview: string;
}

export interface FileGrepResult {
  ok: true;
  matches: FileGrepMatch[];
  matchCount: number;
  fileCount: number;
  truncated: boolean;
  decision: ScopeDecision;
}

export type FileReadResponse = FileReadResult | FileErrorResult;
export type FileWriteResponse = FileWriteResult | FileErrorResult;
export type FileOverwriteResponse = FileOverwriteResult | FileErrorResult;
export type FileListResponse = FileListResult | FileErrorResult;
export type FileMkdirResponse = FileMkdirResult | FileErrorResult;
export type FileCopyResponse = FileCopyResult | FileErrorResult;
export type FileMoveResponse = FileMoveResult | FileErrorResult;
export type FileDeleteResponse = FileDeleteResult | FileErrorResult;
export interface FilePatchResult {
  ok: true;
  newHash: string;
  appliedHunks: number;
  resolvedPath: string;
  decision: ScopeDecision;
}

export type FilePatchResponse = FilePatchResult | FileErrorResult;
export type FileFindResponse = FileFindResult | FileErrorResult;
export type FileGrepResponse = FileGrepResult | FileErrorResult;

// --- File Attachments (drag-and-drop) ---

export interface FileAttachment {
  name: string;        // basename
  path: string;        // absolute path (pending state only, not persisted on messages)
  size: number;        // bytes
  content: string;     // UTF-8 (held until send, then cleared)
  contentHash: string;
}

export type AttachFileResult =
  | { ok: true; attachment: FileAttachment }
  | { ok: false; name: string; error: string };

export type DroppedFileReadResponse =
  | { ok: true; content: string; contentHash: string; size: number }
  | { ok: false; error: string };

// --- File Actions (tool loop) ---

export interface FileAction {
  tool: string;
  path: string;
  toPath?: string;
  allowed: boolean;
  profile: string;
  error?: string;
  summary?: string;
  status?: FileActionStatus;
}

export interface ChatFileActionEvent {
  streamId: string;
  action: FileAction;
}

// --- Activity Feed ---

export type { ActivityKind, ActivityDecisionSource, ActivityFilter, AppliedModeInfo, ActivityEvent } from './activity-types.js';

// --- Backend Config ---

export type BackendType = 'anthropic' | 'ollama' | 'claude-code' | 'codex';

export interface BackendConfig {
  type: BackendType;
  apiKey?: string;
  ollamaUrl?: string;
}

export type BackendState = 'daemon_unhealthy' | 'missing' | 'unreachable' | 'no_models' | 'ready';

export interface BackendStatus {
  state: BackendState;
  type?: BackendType;
  models: ModelInfo[];
  message?: string;
  existingConfig?: BackendConfig;
}

export type BackendConfigureResult =
  | { ok: true; status: BackendStatus }
  | { ok: false; error: { code: string; message: string } };

// --- Conversations ---

export interface PersistedChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  receipt?: ReceiptRef;
  violations?: ViolationRef[];
  fileActions?: FileAction[];
  attachments?: Array<{ name: string; size: number }>;
}

export interface ConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ConversationData {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: PersistedChatMessage[];
}

export type ConversationListResult = {
  conversations: ConversationMeta[];
  activeId: string | null;
};

export type ConversationLoadResult =
  | { ok: true; conversation: ConversationData }
  | { ok: false; error: string };

export type ConversationSaveResult =
  | { ok: true; meta: ConversationMeta }
  | { ok: false; error: string };

export interface ConversationSearchHit {
  conversationId: string;
  title: string;
  /** Snippet of matching message content */
  snippet: string;
  messageRole: 'user' | 'assistant';
  updatedAt: number;
}

// --- Backend capabilities ---

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

// --- Settings ---

export type ClerkTheme = 'dark' | 'light';

export interface ClerkSettings {
  friendlyMode: boolean;
  theme: ClerkTheme;
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

  // File attachments (drag-and-drop)
  readAbsoluteFile(absolutePath: string): Promise<DroppedFileReadResponse>;

  // File operations
  fileRead(relativePath: string): Promise<FileReadResponse>;
  fileWrite(relativePath: string, content: string): Promise<FileWriteResponse>;
  fileOverwrite(relativePath: string, content: string, expectedHash: string): Promise<FileOverwriteResponse>;
  fileList(relativePath: string): Promise<FileListResponse>;
  fileMkdir(relativePath: string): Promise<FileMkdirResponse>;
  fileCopy(srcRelative: string, destRelative: string): Promise<FileCopyResponse>;
  fileMove(srcRelative: string, destRelative: string): Promise<FileMoveResponse>;
  fileDelete(relativePath: string): Promise<FileDeleteResponse>;
  fileFind(basePath: string, pattern?: string): Promise<FileFindResponse>;
  fileGrep(query: string, basePath?: string): Promise<FileGrepResponse>;
  filePatch(relativePath: string, patch: string, expectedHash: string): Promise<FilePatchResponse>;

  // Chat stream control
  chatStreamStop(streamId: string): Promise<void>;

  // Ask (interactive approval)
  onAskRequest(cb: (data: AskRequest) => void): void;
  offAskRequest(): void;
  askRespond(askId: string, decision: AskDecision): Promise<void>;

  // File action events (tool loop)
  onFileAction(cb: (data: ChatFileActionEvent) => void): void;
  offFileAction(): void;

  // Activity feed
  activityList(limit?: number): Promise<{ events: import('./activity-types.js').ActivityEvent[] }>;
  onActivityEvent(cb: (event: import('./activity-types.js').ActivityEvent) => void): void;
  offActivityEvent(): void;

  // Backend capabilities
  backendCapabilities(): Promise<BackendCapabilities>;

  // Backend config
  backendStatus(): Promise<BackendStatus>;
  backendConfigure(config: BackendConfig): Promise<BackendConfigureResult>;

  // Settings
  settingsGetAll(): Promise<ClerkSettings>;
  settingsSet(partial: Partial<ClerkSettings>): Promise<ClerkSettings>;

  // Shell / dialogs
  showSaveDialog(options: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
  saveFile(filePath: string, content: string): Promise<{ ok: boolean; error?: string }>;

  // Conversations
  conversationList(): Promise<ConversationListResult>;
  conversationLoad(id: string): Promise<ConversationLoadResult>;
  conversationSave(data: ConversationData): Promise<ConversationSaveResult>;
  conversationDelete(id: string): Promise<boolean>;
  conversationRename(id: string, title: string): Promise<ConversationMeta | null>;
  conversationSetActive(id: string | null): Promise<void>;
  conversationSearch(query: string): Promise<ConversationSearchHit[]>;

  // Connection state events
  onConnectionState(cb: (state: string) => void): void;
  offConnectionState(): void;
}

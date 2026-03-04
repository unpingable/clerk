// SPDX-License-Identifier: Apache-2.0
/**
 * Chat state store — messages, streaming, violations, ask flow, stop.
 * Svelte 5 runes mode. Must be .svelte.ts.
 */

import { api } from '$lib/api';
import type { ChatMessage, ChatStreamDelta, ChatStreamEnd, ChatFileActionEvent, ModelInfo, PendingViolation, AskRequest } from '$shared/types';

// --- State ---

let messages = $state<ChatMessage[]>([]);
let streaming = $state(false);
let currentStreamId = $state<string | null>(null);
let pendingViolation = $state<PendingViolation | null>(null);
let selectedModel = $state('');
let availableModels = $state<ModelInfo[]>([]);
let error = $state<string | null>(null);
let pendingAsk = $state<AskRequest | null>(null);
const stoppedStreams = new Set<string>();

// --- Derived ---

const canSend = $derived(!streaming && !pendingViolation);

// --- Getters (for components) ---

export function getMessages(): ChatMessage[] { return messages; }
export function isStreaming(): boolean { return streaming; }
export function getCanSend(): boolean { return canSend; }
export function getPendingViolation(): PendingViolation | null { return pendingViolation; }
export function getSelectedModel(): string { return selectedModel; }
export function getAvailableModels(): ModelInfo[] { return availableModels; }
export function getError(): string | null { return error; }
export function getPendingAsk(): AskRequest | null { return pendingAsk; }

// --- Actions ---

let nextMsgId = 1;
function msgId(): string {
  return `msg-${nextMsgId++}`;
}

export async function send(content: string): Promise<void> {
  if (!canSend || !content.trim()) return;

  error = null;

  // Add user message
  messages.push({
    id: msgId(),
    role: 'user',
    content: content.trim(),
    timestamp: Date.now(),
  });

  streaming = true;

  try {
    // Start streaming
    const { streamId } = await api.chatStreamStart(
      messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content })),
      selectedModel ? { model: selectedModel } : {},
    );
    currentStreamId = streamId;

    // Add placeholder assistant message
    messages.push({
      id: msgId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
    });
  } catch (err) {
    streaming = false;
    error = String(err);
  }
}

export function onDelta(data: ChatStreamDelta): void {
  if (data.streamId !== currentStreamId || stoppedStreams.has(data.streamId)) return;
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && last.streaming) {
    last.content += data.delta.content ?? '';
  }
}

export function onEnd(data: ChatStreamEnd): void {
  if (data.streamId !== currentStreamId) return;
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant') {
    last.streaming = false;
    last.receipt = data.result.receipt ?? null;
    last.violations = data.result.violations ?? [];
    if (data.result.fileActions) {
      last.fileActions = data.result.fileActions;
    }
    if (data.result.pending) {
      pendingViolation = data.result.pending;
    }
  }
  if (data.streamId) stoppedStreams.delete(data.streamId);
  streaming = false;
  currentStreamId = null;
  pendingAsk = null;
}

export function onFileAction(data: ChatFileActionEvent): void {
  if (data.streamId !== currentStreamId || stoppedStreams.has(data.streamId)) return;
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant') {
    if (!last.fileActions) last.fileActions = [];
    last.fileActions.push(data.action);
  }
}

export function onAskRequest(data: AskRequest): void {
  if (data.streamId !== currentStreamId || stoppedStreams.has(data.streamId)) return;
  pendingAsk = data;
}

export async function respondToAsk(decision: 'allow_once' | 'deny'): Promise<void> {
  if (!pendingAsk) return;
  const ask = pendingAsk;
  pendingAsk = null;
  try {
    await api.askRespond(ask.askId, decision);
  } catch (err) {
    error = String(err);
  }
}

export async function stopStreaming(): Promise<void> {
  if (!streaming || !currentStreamId) return;
  stoppedStreams.add(currentStreamId);
  try {
    await api.chatStreamStop(currentStreamId);
  } catch {
    // Best effort
  }
}

export async function resolveViolation(action: 'fix' | 'revise' | 'proceed', param?: string): Promise<void> {
  if (!pendingViolation) return;

  try {
    switch (action) {
      case 'fix':
        await api.commitFix(param);
        break;
      case 'revise':
        await api.commitRevise();
        break;
      case 'proceed':
        await api.commitProceed(param ?? 'User approved');
        break;
    }
    pendingViolation = null;
  } catch (err) {
    error = String(err);
  }
}

export function setModel(model: string): void {
  selectedModel = model;
}

export async function loadModels(): Promise<void> {
  try {
    availableModels = await api.chatModels();
    if (availableModels.length > 0 && !selectedModel) {
      selectedModel = availableModels[0].id;
    }
  } catch {
    availableModels = [];
  }
}

export function clearError(): void {
  error = null;
}

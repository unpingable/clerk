// SPDX-License-Identifier: Apache-2.0
/**
 * Chat state store — messages, streaming, violations, ask flow, stop.
 * Svelte 5 runes mode. Must be .svelte.ts.
 *
 * Components read from the exported `state` object (proxy-tracked property
 * access) rather than getter functions, so Svelte's reactivity system
 * reliably tracks cross-module dependencies.
 */

import { api } from '$lib/api';
import type { ChatMessage, ChatStreamDelta, ChatStreamEnd, ChatFileActionEvent, ModelInfo, PendingViolation, AskRequest } from '$shared/types';

// --- State ---

let messages = $state<ChatMessage[]>([]);
const stoppedStreams = new Set<string>();

/**
 * Exported reactive state object.  Components read properties directly
 * (e.g. `chat.state.streaming`) which ensures Svelte's proxy tracks the
 * dependency — unlike getter functions which can snapshot the value.
 */
export const state = $state({
  streaming: false,
  currentStreamId: null as string | null,
  pendingViolation: null as PendingViolation | null,
  selectedModel: '',
  availableModels: [] as ModelInfo[],
  error: null as string | null,
  pendingAsk: null as AskRequest | null,
});

// --- Derived ---

const canSend = $derived(!state.streaming && !state.pendingViolation);

// --- Getters (for components) ---

export function getMessages(): ChatMessage[] { return messages; }
export function getCanSend(): boolean { return canSend; }

// --- Actions ---

let nextMsgId = 1;
function msgId(): string {
  return `msg-${nextMsgId++}`;
}

export async function send(content: string): Promise<void> {
  if (!canSend || !content.trim()) return;

  state.error = null;

  // Add user message
  messages.push({
    id: msgId(),
    role: 'user',
    content: content.trim(),
    timestamp: Date.now(),
  });

  state.streaming = true;

  try {
    // Start streaming
    const { streamId } = await api.chatStreamStart(
      messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content })),
      state.selectedModel ? { model: state.selectedModel } : {},
    );
    state.currentStreamId = streamId;

    // Add placeholder assistant message
    messages.push({
      id: msgId(),
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      streaming: true,
    });
  } catch (err) {
    state.streaming = false;
    state.error = String(err);
  }
}

export function onDelta(data: ChatStreamDelta): void {
  if (data.streamId !== state.currentStreamId || stoppedStreams.has(data.streamId)) return;
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant' && last.streaming) {
    last.content += data.delta.content ?? '';
  }
}

export function onEnd(data: ChatStreamEnd): void {
  if (data.streamId !== state.currentStreamId) return;
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant') {
    last.streaming = false;
    last.receipt = data.result.receipt ?? null;
    last.violations = data.result.violations ?? [];
    if (data.result.fileActions) {
      last.fileActions = data.result.fileActions;
    }
    if (data.result.pending) {
      state.pendingViolation = data.result.pending;
    }
  }
  if (data.streamId) stoppedStreams.delete(data.streamId);
  state.streaming = false;
  state.currentStreamId = null;
  state.pendingAsk = null;
}

export function onFileAction(data: ChatFileActionEvent): void {
  if (data.streamId !== state.currentStreamId || stoppedStreams.has(data.streamId)) return;
  const last = messages[messages.length - 1];
  if (last?.role === 'assistant') {
    if (!last.fileActions) last.fileActions = [];
    last.fileActions.push(data.action);
  }
}

export function onAskRequest(data: AskRequest): void {
  if (data.streamId !== state.currentStreamId || stoppedStreams.has(data.streamId)) return;
  state.pendingAsk = data;
}

export async function respondToAsk(decision: 'allow_once' | 'deny'): Promise<void> {
  if (!state.pendingAsk) return;
  const ask = state.pendingAsk;
  state.pendingAsk = null;
  try {
    await api.askRespond(ask.askId, decision);
  } catch (err) {
    state.error = String(err);
  }
}

export async function stopStreaming(): Promise<void> {
  if (!state.streaming || !state.currentStreamId) return;
  stoppedStreams.add(state.currentStreamId);
  try {
    await api.chatStreamStop(state.currentStreamId);
  } catch {
    // Best effort
  }
}

export async function resolveViolation(action: 'fix' | 'revise' | 'proceed', param?: string): Promise<void> {
  if (!state.pendingViolation) return;

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
    state.pendingViolation = null;
  } catch (err) {
    state.error = String(err);
  }
}

export function setModel(model: string): void {
  state.selectedModel = model;
}

export async function loadModels(): Promise<void> {
  try {
    state.availableModels = await api.chatModels();
    if (state.availableModels.length > 0 && !state.selectedModel) {
      state.selectedModel = state.availableModels[0].id;
    }
  } catch {
    state.availableModels = [];
  }
}

export function clearError(): void {
  state.error = null;
}

export function clearMessages(): void {
  messages.length = 0;
  state.error = null;
  state.pendingViolation = null;
  state.pendingAsk = null;
}

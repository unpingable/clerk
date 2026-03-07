// SPDX-License-Identifier: Apache-2.0
/**
 * Pure functions for conversation persistence — shared between main + renderer.
 * No Node APIs, no runes.
 */

import type { ChatMessage, PersistedChatMessage } from './types.js';

export function generateTitle(
  userText: string,
  attachmentNames?: string[],
): string {
  // Strip any [Attached file: ...] blocks
  const cleaned = userText.replace(/\[Attached file:.*?\]/g, '').trim();

  if (cleaned.length > 0) {
    if (cleaned.length <= 50) return cleaned;
    const truncated = cleaned.slice(0, 50);
    const lastSpace = truncated.lastIndexOf(' ');
    return lastSpace > 10 ? truncated.slice(0, lastSpace) : truncated;
  }

  if (attachmentNames && attachmentNames.length > 0) {
    if (attachmentNames.length === 1) return attachmentNames[0];
    return `${attachmentNames.length} attached files`;
  }

  return 'New conversation';
}

export function toPersistedMessage(msg: ChatMessage): PersistedChatMessage {
  const persisted: PersistedChatMessage = {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
  };
  if (msg.receipt) persisted.receipt = msg.receipt;
  if (msg.violations && msg.violations.length > 0) persisted.violations = msg.violations;
  if (msg.fileActions && msg.fileActions.length > 0) persisted.fileActions = msg.fileActions;
  if (msg.attachments && msg.attachments.length > 0) persisted.attachments = msg.attachments;
  return persisted;
}

export function fromPersistedMessage(msg: PersistedChatMessage): ChatMessage {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
    receipt: msg.receipt ?? null,
    violations: msg.violations ?? [],
    fileActions: msg.fileActions ?? [],
    attachments: msg.attachments,
  };
}

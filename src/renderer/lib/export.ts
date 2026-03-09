// SPDX-License-Identifier: Apache-2.0
/**
 * Export a conversation to markdown format via native save dialog.
 */

import { api } from '$lib/api';
import type { ChatMessage } from '$shared/types';

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

/**
 * Convert messages to a readable markdown document.
 */
export function conversationToMarkdown(
  title: string,
  messages: ChatMessage[],
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`*Exported from Clerk on ${new Date().toLocaleDateString()}*`);
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const msg of messages) {
    const role = msg.role === 'user' ? 'You' : 'Clerk';
    const time = formatTimestamp(msg.timestamp);
    lines.push(`### ${role} — ${time}`);
    lines.push('');

    if (msg.content) {
      lines.push(msg.content);
      lines.push('');
    }

    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        lines.push(`📎 *${att.name}*`);
      }
      lines.push('');
    }

    if (msg.fileActions?.length) {
      for (const action of msg.fileActions) {
        const status = action.allowed ? '✓' : '✗';
        const summary = action.summary || `${action.tool} ${action.path}`;
        lines.push(`> ${status} ${summary}`);
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Export the current conversation via native save dialog.
 * Returns true if saved, false if cancelled or errored.
 */
export async function exportConversation(
  title: string,
  messages: ChatMessage[],
): Promise<boolean> {
  if (messages.length === 0) return false;

  const safeTitle = title.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'conversation';
  const defaultName = `${safeTitle}.md`;

  const filePath = await api.showSaveDialog({
    title: 'Export Conversation',
    defaultPath: defaultName,
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Text', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (!filePath) return false;

  const content = conversationToMarkdown(title, messages);
  const result = await api.saveFile(filePath, content);
  return result.ok;
}

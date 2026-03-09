// SPDX-License-Identifier: Apache-2.0
/**
 * In-conversation search — find text matches across messages.
 */

import type { ChatMessage } from '$shared/types';

export interface SearchMatch {
  /** Index into the messages array */
  messageIndex: number;
  /** The message id (for keying) */
  messageId: string;
}

/**
 * Find all messages whose content contains the query (case-insensitive).
 */
export function findMatches(messages: ChatMessage[], query: string): SearchMatch[] {
  if (!query.trim()) return [];
  const lower = query.toLowerCase();
  const matches: SearchMatch[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.content.toLowerCase().includes(lower)) {
      matches.push({ messageIndex: i, messageId: msg.id });
    }
  }
  return matches;
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wrap matching text in <mark> tags for highlighting.
 * Input `html` is already sanitized markdown output, so we only highlight
 * within text nodes (not inside HTML tags).
 */
export function highlightHtml(html: string, query: string): string {
  if (!query.trim()) return html;
  // Split on HTML tags to only modify text between tags
  const parts = html.split(/(<[^>]+>)/);
  const re = new RegExp(`(${escapeRegex(query)})`, 'gi');
  return parts
    .map((part, i) => {
      // Odd indices are tags — don't touch
      if (part.startsWith('<')) return part;
      return part.replace(re, '<mark class="search-highlight">$1</mark>');
    })
    .join('');
}

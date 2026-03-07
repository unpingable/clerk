// SPDX-License-Identifier: Apache-2.0
/**
 * Normalize assistant content before it enters the chat transcript.
 * Strips the outer <tool_calls>...</tool_calls> XML envelope that the
 * tool loop uses internally — users should never see raw tool call markup.
 */

const OPEN = '<tool_calls>';
const CLOSE = '</tool_calls>';

/**
 * Strip a trailing `<tool_calls>...</tool_calls>` block from assistant text.
 * Only removes the last occurrence (there should be at most one per turn).
 * Preserves all text before the block.
 */
export function normalizeAssistantContent(text: string): string {
  const lastOpen = text.lastIndexOf(OPEN);
  if (lastOpen === -1) return text;

  const close = text.indexOf(CLOSE, lastOpen);
  if (close === -1) return text; // Unclosed tag — leave as-is

  // Everything before the <tool_calls> block, trimmed
  const before = text.slice(0, lastOpen).trimEnd();
  // Everything after </tool_calls> (shouldn't exist per protocol, but safe)
  const after = text.slice(close + CLOSE.length).trimStart();

  return after ? `${before}\n${after}` : before;
}

/**
 * Streaming-safe variant: also strips a trailing unclosed `<tool_calls>...`
 * block that's still being received (close tag hasn't arrived yet).
 * Use this for live display; use `normalizeAssistantContent` for finalization.
 */
export function normalizeStreamingContent(text: string): string {
  const lastOpen = text.lastIndexOf(OPEN);
  if (lastOpen === -1) return text;

  const close = text.indexOf(CLOSE, lastOpen);
  if (close !== -1) {
    // Complete block — same as finalized
    const before = text.slice(0, lastOpen).trimEnd();
    const after = text.slice(close + CLOSE.length).trimStart();
    return after ? `${before}\n${after}` : before;
  }

  // Unclosed — strip everything from <tool_calls> onward (still streaming in)
  return text.slice(0, lastOpen).trimEnd();
}

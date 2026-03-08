// SPDX-License-Identifier: Apache-2.0
/**
 * File attachment helpers — formatting, sizing, basename extraction.
 * Pure functions, fully testable.
 */

import type { FileAttachment } from '$shared/types';

/**
 * Format attachment content blocks + user text into one message string.
 * Delimiter format:
 *   [Attached file: name.txt | 1.2 KB]
 *   <content>
 *   [/Attached file]
 */
export function formatAttachmentContext(
  attachments: FileAttachment[],
  userText: string,
): string {
  const blocks: string[] = [];

  for (const att of attachments) {
    const sizeLabel = formatAttachmentSize(att.size);
    blocks.push(
      `[Attached file: ${att.name} | ${sizeLabel}]\n${att.content}\n[/Attached file]`,
    );
  }

  const fileSection = blocks.join('\n\n');
  const trimmed = userText.trim();

  if (!trimmed) return fileSection;
  return `${fileSection}\n\n${trimmed}`;
}

/** Format file size for display (e.g. "1.2 KB", "340 B"). */
export function formatAttachmentSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return kb >= 10 ? `${Math.round(kb)} KB` : `${kb.toFixed(1)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
}

/** Format total size summary (e.g. "3 files · 412 KB"). */
export function formatAttachmentSummary(
  attachments: Array<{ size: number }>,
): string {
  const total = attachments.reduce((sum, a) => sum + a.size, 0);
  const count = attachments.length;
  const sizeLabel = formatAttachmentSize(total);
  return `${count} file${count === 1 ? '' : 's'} · ${sizeLabel}`;
}

/** Extract basename from an absolute path (Unix or Windows). */
export function baseName(absolutePath: string): string {
  // Handle both / and \ separators
  const lastSlash = Math.max(
    absolutePath.lastIndexOf('/'),
    absolutePath.lastIndexOf('\\'),
  );
  return lastSlash === -1 ? absolutePath : absolutePath.slice(lastSlash + 1);
}

// SPDX-License-Identifier: Apache-2.0
/**
 * Pure unified diff parser + applier.
 *
 * Parses unified diff format (as produced by git diff / LLM output) and
 * applies hunks against an original string. No filesystem access — pure
 * string-in, string-out.
 *
 * Safety: caps on patch size, hunk count, changed lines, and line length
 * prevent memory/CPU abuse from adversarial diffs.
 *
 * Error taxonomy:
 *   kind='invalid' — patch is structurally bad (parse failure, caps exceeded,
 *                     wrong-file headers). Maps to INVALID_PATCH.
 *   kind='failed'  — valid unified diff that doesn't match the target content
 *                     (context mismatch, position overflow). Maps to PATCH_FAILED.
 */

import path from 'node:path';

// ---------------------------------------------------------------------------
// Caps
// ---------------------------------------------------------------------------

export const MAX_PATCH_SIZE = 100 * 1024;   // 100KB
export const MAX_HUNKS = 50;
export const MAX_CHANGED_LINES = 2000;
export const MAX_LINE_LENGTH = 10_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PatchErrorKind = 'invalid' | 'failed';

export type PatchResult =
  | { ok: true; result: string; appliedHunks: number }
  | { ok: false; kind: PatchErrorKind; reason: string };

interface HunkHeader {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

interface HunkLine {
  type: 'context' | 'remove' | 'add';
  content: string;
}

interface Hunk {
  header: HunkHeader;
  lines: HunkLine[];
  noNewlineAtEnd: boolean;
}

interface ParseResult {
  ok: true;
  hunks: Hunk[];
  headerNames: string[];  // basenames extracted from ---/+++ lines
}

interface ParseError {
  ok: false;
  reason: string;
}

// ---------------------------------------------------------------------------
// EOL detection
// ---------------------------------------------------------------------------

/** Detect dominant line ending in a string. */
export function detectEOL(text: string): '\r\n' | '\n' {
  let crlf = 0;
  let lf = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      if (i > 0 && text[i - 1] === '\r') {
        crlf++;
      } else {
        lf++;
      }
    }
  }
  return crlf > lf ? '\r\n' : '\n';
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Extract the filename from a --- or +++ header line.
 * Handles: "--- a/path/to/file.txt", "--- /dev/null", "+++ b/file.txt"
 * Returns the basename, or null if the line is /dev/null.
 */
function extractHeaderName(line: string): string | null {
  // Strip prefix (--- or +++)
  const rest = line.replace(/^[-+]{3}\s+/, '');
  if (rest === '/dev/null') return null;
  // Strip a/ or b/ prefix (git diff convention)
  const stripped = rest.replace(/^[ab]\//, '');
  return path.basename(stripped);
}

function parseHunks(patchText: string): ParseResult | ParseError {
  const rawLines = patchText.split('\n');
  // Remove trailing empty line from final newline
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }

  const hunks: Hunk[] = [];
  const headerNames: string[] = [];
  let i = 0;
  let totalChanged = 0;

  // Skip prologue: diff --git, index, ---, +++, new file mode, etc.
  while (i < rawLines.length) {
    const line = rawLines[i];
    if (HUNK_RE.test(line)) break;
    // Known prologue prefixes — skip silently, but extract --- / +++ names
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      const name = extractHeaderName(line);
      if (name !== null) headerNames.push(name);
      i++;
      continue;
    }
    if (
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('new file mode') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('similarity index') ||
      line.startsWith('rename from') ||
      line.startsWith('rename to') ||
      line.startsWith('Binary files')
    ) {
      i++;
      continue;
    }
    // Unknown non-hunk line outside a hunk = error
    if (hunks.length === 0 && line.trim() !== '') {
      return { ok: false, reason: `Unexpected line before first hunk at line ${i + 1}: not a valid unified diff.` };
    }
    i++;
  }

  if (i >= rawLines.length) {
    return { ok: false, reason: 'No hunks found in patch.' };
  }

  while (i < rawLines.length) {
    const headerLine = rawLines[i];
    const m = HUNK_RE.exec(headerLine);
    if (!m) {
      return { ok: false, reason: `Expected hunk header at line ${i + 1}, got: "${clampStr(headerLine, 80)}"` };
    }

    if (hunks.length >= MAX_HUNKS) {
      return { ok: false, reason: `Too many hunks (limit ${MAX_HUNKS}).` };
    }

    const header: HunkHeader = {
      oldStart: parseInt(m[1], 10),
      oldCount: m[2] !== undefined ? parseInt(m[2], 10) : 1,
      newStart: parseInt(m[3], 10),
      newCount: m[4] !== undefined ? parseInt(m[4], 10) : 1,
    };

    i++;
    const lines: HunkLine[] = [];
    let noNewlineAtEnd = false;
    let oldSeen = 0;
    let newSeen = 0;

    while (i < rawLines.length) {
      const line = rawLines[i];

      // Next hunk header
      if (HUNK_RE.test(line)) break;

      // No-newline-at-end metadata
      if (line === '\\ No newline at end of file') {
        noNewlineAtEnd = true;
        i++;
        continue;
      }

      // Check line length cap
      if (line.length > MAX_LINE_LENGTH) {
        return { ok: false, reason: `Line ${i + 1} exceeds maximum length (${MAX_LINE_LENGTH}).` };
      }

      if (line.startsWith('-')) {
        lines.push({ type: 'remove', content: line.slice(1) });
        oldSeen++;
        totalChanged++;
      } else if (line.startsWith('+')) {
        lines.push({ type: 'add', content: line.slice(1) });
        newSeen++;
        totalChanged++;
      } else if (line.startsWith(' ')) {
        lines.push({ type: 'context', content: line.slice(1) });
        oldSeen++;
        newSeen++;
      } else {
        // Unprefixed line inside hunk — treat as context (LLM slop tolerance)
        lines.push({ type: 'context', content: line });
        oldSeen++;
        newSeen++;
      }

      if (totalChanged > MAX_CHANGED_LINES) {
        return { ok: false, reason: `Too many changed lines (limit ${MAX_CHANGED_LINES}).` };
      }

      i++;
    }

    // Validate hunk header counts
    if (oldSeen !== header.oldCount) {
      return { ok: false, reason: `Hunk at line ${header.oldStart}: expected ${header.oldCount} old lines, got ${oldSeen}.` };
    }
    if (newSeen !== header.newCount) {
      return { ok: false, reason: `Hunk at line ${header.newStart}: expected ${header.newCount} new lines, got ${newSeen}.` };
    }

    hunks.push({ header, lines, noNewlineAtEnd });
  }

  // Validate monotonic ordering
  for (let h = 1; h < hunks.length; h++) {
    const prev = hunks[h - 1];
    const curr = hunks[h];
    const prevEnd = prev.header.oldStart + prev.header.oldCount;
    if (curr.header.oldStart < prevEnd) {
      return { ok: false, reason: `Hunks overlap or are out of order: hunk ${h + 1} starts at line ${curr.header.oldStart} but previous hunk extends to line ${prevEnd}.` };
    }
  }

  return { ok: true, hunks, headerNames };
}

// ---------------------------------------------------------------------------
// Applier
// ---------------------------------------------------------------------------

/** Strip trailing \r for CRLF-tolerant comparison. */
function stripCR(s: string): string {
  return s.endsWith('\r') ? s.slice(0, -1) : s;
}

/**
 * Apply a unified diff patch to an original string.
 *
 * @param original  — the file content to patch
 * @param patch     — unified diff text (may include prologue)
 * @param targetBasename — if provided, ---/+++ headers must name this file or be absent
 */
export function applyUnifiedPatch(original: string, patch: string, targetBasename?: string): PatchResult {
  // Validate patch size — structural: invalid
  if (patch.length === 0) {
    return { ok: false, kind: 'invalid', reason: 'Patch is empty.' };
  }
  if (Buffer.byteLength(patch, 'utf-8') > MAX_PATCH_SIZE) {
    return { ok: false, kind: 'invalid', reason: `Patch exceeds maximum size (${MAX_PATCH_SIZE} bytes).` };
  }

  // Parse hunks — structural: invalid
  const parseResult = parseHunks(patch);
  if (!parseResult.ok) {
    return { ok: false, kind: 'invalid', reason: parseResult.reason };
  }

  const { hunks, headerNames } = parseResult;
  if (hunks.length === 0) {
    return { ok: false, kind: 'invalid', reason: 'No hunks found in patch.' };
  }

  // Validate ---/+++ headers match target if present — structural: invalid
  if (targetBasename && headerNames.length > 0) {
    for (const name of headerNames) {
      if (name !== targetBasename) {
        return {
          ok: false,
          kind: 'invalid',
          reason: `Patch header names "${name}" but target file is "${targetBasename}". This looks like a diff for a different file.`,
        };
      }
    }
  }

  // Detect EOL style of original
  const eol = detectEOL(original);

  // Split original into lines, preserving content
  const endsWithNewline = original.endsWith('\n') || original.endsWith('\r\n');
  const origLines = original.split('\n');
  // Remove trailing empty element from final newline
  if (origLines.length > 0 && origLines[origLines.length - 1] === '') {
    origLines.pop();
  }
  // Strip trailing \r from CRLF lines for comparison
  const normalizedOrigLines = origLines.map(l => stripCR(l));

  // Apply hunks sequentially with offset tracking — content mismatch: failed
  let offset = 0;
  const resultLines = [...normalizedOrigLines];

  for (let h = 0; h < hunks.length; h++) {
    const hunk = hunks[h];
    const startIdx = hunk.header.oldStart - 1 + offset; // 0-based

    // Match context + remove lines at the expected position
    let pos = startIdx;

    for (const line of hunk.lines) {
      if (line.type === 'context' || line.type === 'remove') {
        if (pos >= resultLines.length) {
          return {
            ok: false,
            kind: 'failed',
            reason: `Hunk ${h + 1}: expected line at position ${pos + 1} but file only has ${resultLines.length} lines.`,
          };
        }
        const expected = stripCR(line.content);
        const actual = resultLines[pos];
        if (actual !== expected) {
          return {
            ok: false,
            kind: 'failed',
            reason: `Hunk ${h + 1}: mismatch at line ${pos + 1}. Expected "${clampStr(expected, 200)}" but found "${clampStr(actual, 200)}".`,
          };
        }
        pos++;
      }
    }

    // Build replacement lines for this hunk
    const newLines: string[] = [];
    for (const line of hunk.lines) {
      if (line.type === 'context') {
        newLines.push(stripCR(line.content));
      } else if (line.type === 'add') {
        newLines.push(stripCR(line.content));
      }
      // 'remove' lines are dropped
    }

    // Splice: remove oldCount lines at startIdx, insert newLines
    const removeCount = hunk.header.oldCount;
    resultLines.splice(startIdx, removeCount, ...newLines);
    offset += (hunk.header.newCount - hunk.header.oldCount);
  }

  // Reconstruct with proper EOL
  let result = resultLines.join(eol);

  // Handle trailing newline
  const lastHunk = hunks[hunks.length - 1];
  if (lastHunk.noNewlineAtEnd) {
    // Last hunk explicitly says no newline at end
  } else if (endsWithNewline) {
    result += eol;
  }

  return { ok: true, result, appliedHunks: hunks.length };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp a string for safe error display, escaping control chars. */
function clampStr(s: string, maxLen: number): string {
  let safe = s.replace(/[\x00-\x1f\x7f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
  if (safe.length > maxLen) {
    safe = safe.slice(0, maxLen) + '...';
  }
  return safe;
}

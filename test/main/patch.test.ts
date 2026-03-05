// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { applyUnifiedPatch, detectEOL, MAX_PATCH_SIZE, MAX_HUNKS, MAX_CHANGED_LINES, MAX_LINE_LENGTH } from '../../src/main/patch';

describe('applyUnifiedPatch', () => {
  // --- Core apply ---

  it('single hunk: add a line', () => {
    const original = 'line1\nline2\nline3\n';
    const patch = [
      '@@ -1,3 +1,4 @@',
      ' line1',
      ' line2',
      '+inserted',
      ' line3',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe('line1\nline2\ninserted\nline3\n');
      expect(result.appliedHunks).toBe(1);
    }
  });

  it('single hunk: remove a line', () => {
    const original = 'line1\nline2\nline3\n';
    const patch = [
      '@@ -1,3 +1,2 @@',
      ' line1',
      '-line2',
      ' line3',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe('line1\nline3\n');
    }
  });

  it('single hunk: change a line', () => {
    const original = 'line1\nline2\nline3\n';
    const patch = [
      '@@ -1,3 +1,3 @@',
      ' line1',
      '-line2',
      '+LINE_TWO',
      ' line3',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe('line1\nLINE_TWO\nline3\n');
    }
  });

  it('multi-hunk with offset adjustment', () => {
    const original = 'a\nb\nc\nd\ne\nf\ng\n';
    const patch = [
      '@@ -1,3 +1,4 @@',
      ' a',
      ' b',
      '+x',
      ' c',
      '@@ -5,3 +6,3 @@',
      ' e',
      '-f',
      '+F',
      ' g',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe('a\nb\nx\nc\nd\ne\nF\ng\n');
      expect(result.appliedHunks).toBe(2);
    }
  });

  it('append at EOF', () => {
    const original = 'line1\nline2\n';
    const patch = [
      '@@ -1,2 +1,3 @@',
      ' line1',
      ' line2',
      '+line3',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe('line1\nline2\nline3\n');
    }
  });

  it('delete multiple lines', () => {
    const original = 'a\nb\nc\nd\ne\n';
    const patch = [
      '@@ -2,3 +2,1 @@',
      '-b',
      '-c',
      '-d',
      '+B',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe('a\nB\ne\n');
    }
  });

  it('mixed adds and removes in single hunk', () => {
    const original = 'import a\nimport b\nimport c\n\ncode\n';
    const patch = [
      '@@ -1,5 +1,5 @@',
      '-import a',
      '-import b',
      '-import c',
      '+import x',
      '+import y',
      '+import z',
      ' ',
      ' code',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe('import x\nimport y\nimport z\n\ncode\n');
    }
  });

  // --- EOL / encoding ---

  it('CRLF file + LF diff succeeds via normalization', () => {
    const original = 'line1\r\nline2\r\nline3\r\n';
    const patch = [
      '@@ -1,3 +1,3 @@',
      ' line1',
      '-line2',
      '+LINE_TWO',
      ' line3',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe('line1\r\nLINE_TWO\r\nline3\r\n');
    }
  });

  it('preserves EOL style in output (CRLF file stays CRLF)', () => {
    const original = 'a\r\nb\r\n';
    const patch = [
      '@@ -1,2 +1,3 @@',
      ' a',
      '+x',
      ' b',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // All lines should use CRLF
      expect(result.result).toBe('a\r\nx\r\nb\r\n');
    }
  });

  it('handles \\ No newline at end of file', () => {
    const original = 'line1\nline2';
    const patch = [
      '@@ -1,2 +1,2 @@',
      ' line1',
      '-line2',
      '\\ No newline at end of file',
      '+line2_modified',
      '\\ No newline at end of file',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Should not have trailing newline
      expect(result.result).toBe('line1\nline2_modified');
    }
  });

  it('hash stability: no-op-ish patch preserves trailing newline', () => {
    const original = 'line1\nline2\n';
    const patch = [
      '@@ -1,2 +1,2 @@',
      ' line1',
      '-line2',
      '+line2',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe('line1\nline2\n');
    }
  });

  // --- Validation ---

  it('exact context required — mismatch fails with kind=failed', () => {
    const original = 'aaa\nbbb\nccc\n';
    const patch = [
      '@@ -1,3 +1,3 @@',
      ' aaa',
      '-wrong_context',
      '+new',
      ' ccc',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('failed');
      expect(result.reason).toContain('mismatch');
    }
  });

  it('empty patch → kind=invalid', () => {
    const result = applyUnifiedPatch('file content', '');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('invalid');
      expect(result.reason).toContain('empty');
    }
  });

  it('oversized patch (>100KB) → kind=invalid', () => {
    const bigPatch = '@@ -1,1 +1,1 @@\n' + 'x'.repeat(MAX_PATCH_SIZE + 1);
    const result = applyUnifiedPatch('original', bigPatch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('invalid');
      expect(result.reason).toContain('maximum size');
    }
  });

  it('too many hunks (>50) → kind=invalid', () => {
    const lines: string[] = [];
    const origLines: string[] = [];
    for (let i = 0; i < MAX_HUNKS + 1; i++) {
      origLines.push(`line${i}`);
      const start = i + 1;
      lines.push(`@@ -${start},1 +${start},1 @@`);
      lines.push(`-line${i}`);
      lines.push(`+LINE${i}`);
    }
    const result = applyUnifiedPatch(origLines.join('\n') + '\n', lines.join('\n'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('invalid');
      expect(result.reason).toContain('Too many hunks');
    }
  });

  it('too many changed lines (>2000) → kind=invalid', () => {
    const adds: string[] = [];
    for (let i = 0; i < MAX_CHANGED_LINES + 1; i++) {
      adds.push(`+added_line_${i}`);
    }
    const patch = `@@ -1,1 +1,${MAX_CHANGED_LINES + 2} @@\n line1\n${adds.join('\n')}`;
    const result = applyUnifiedPatch('line1\n', patch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('invalid');
      expect(result.reason).toContain('Too many changed lines');
    }
  });

  it('line > MAX_LINE_LENGTH → kind=invalid', () => {
    const longLine = 'x'.repeat(MAX_LINE_LENGTH + 1);
    const patch = `@@ -1,1 +1,1 @@\n-short\n+${longLine}`;
    const result = applyUnifiedPatch('short\n', patch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('invalid');
      expect(result.reason).toContain('maximum length');
    }
  });

  it('overlapping hunks → kind=invalid', () => {
    const original = 'a\nb\nc\nd\ne\n';
    const patch = [
      '@@ -1,3 +1,3 @@',
      ' a',
      '-b',
      '+B',
      ' c',
      '@@ -2,3 +2,3 @@', // overlaps with first hunk
      ' b',
      '-c',
      '+C',
      ' d',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('invalid');
      expect(result.reason).toContain('overlap');
    }
  });

  it('hunk header count mismatch → kind=invalid', () => {
    const original = 'a\nb\nc\n';
    const patch = [
      '@@ -1,2 +1,2 @@', // claims 2 old lines but only has 1
      '-a',
      '+A',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('invalid');
      expect(result.reason).toContain('expected');
    }
  });

  it('diff --git / index prologue ignored', () => {
    const original = 'line1\nline2\n';
    const patch = [
      'diff --git a/file.txt b/file.txt',
      'index abc123..def456 100644',
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,2 +1,2 @@',
      ' line1',
      '-line2',
      '+LINE2',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe('line1\nLINE2\n');
    }
  });

  it('file without trailing newline', () => {
    const original = 'line1\nline2';
    const patch = [
      '@@ -1,2 +1,2 @@',
      ' line1',
      '-line2',
      '+LINE2',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Original had no trailing newline, result shouldn't either
      expect(result.result).toBe('line1\nLINE2');
    }
  });

  it('hunk with only count=1 (no comma)', () => {
    const original = 'only\n';
    const patch = [
      '@@ -1 +1 @@',
      '-only',
      '+ONLY',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toBe('ONLY\n');
    }
  });

  // --- Header validation (targetBasename) ---

  it('---/+++ headers matching target basename succeed', () => {
    const original = 'line1\nline2\n';
    const patch = [
      '--- a/file.txt',
      '+++ b/file.txt',
      '@@ -1,2 +1,2 @@',
      ' line1',
      '-line2',
      '+LINE2',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch, 'file.txt');
    expect(result.ok).toBe(true);
  });

  it('---/+++ headers naming different file → kind=invalid', () => {
    const original = 'line1\nline2\n';
    const patch = [
      '--- a/other.txt',
      '+++ b/other.txt',
      '@@ -1,2 +1,2 @@',
      ' line1',
      '-line2',
      '+LINE2',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch, 'file.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('invalid');
      expect(result.reason).toContain('other.txt');
      expect(result.reason).toContain('file.txt');
    }
  });

  it('paranoid: wrong-file headers with matching content → refused', () => {
    // The hunks DO match the target content, but headers name a different file.
    // Must be rejected as INVALID_PATCH, not silently applied.
    const original = 'aaa\nbbb\nccc\n';
    const patch = [
      '--- a/not-the-target.txt',
      '+++ b/not-the-target.txt',
      '@@ -1,3 +1,3 @@',
      ' aaa',
      '-bbb',
      '+BBB',
      ' ccc',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch, 'target.txt');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('invalid');
      expect(result.reason).toContain('not-the-target.txt');
      expect(result.reason).toContain('target.txt');
    }
  });

  it('no headers + targetBasename → succeeds (headers optional)', () => {
    const original = 'line1\nline2\n';
    const patch = [
      '@@ -1,2 +1,2 @@',
      ' line1',
      '-line2',
      '+LINE2',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch, 'file.txt');
    expect(result.ok).toBe(true);
  });

  it('/dev/null in headers is not validated against target', () => {
    // --- /dev/null is used for new files, should not fail basename check
    const original = 'line1\n';
    const patch = [
      '--- /dev/null',
      '+++ b/file.txt',
      '@@ -1,1 +1,2 @@',
      ' line1',
      '+line2',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch, 'file.txt');
    expect(result.ok).toBe(true);
  });

  // --- CRLF byte-level preservation ---

  it('CRLF file: added lines use \\r\\n, not \\n (byte-level)', () => {
    const original = 'alpha\r\nbeta\r\ngamma\r\n';
    const patch = [
      '@@ -1,3 +1,4 @@',
      ' alpha',
      ' beta',
      '+inserted',
      ' gamma',
    ].join('\n');
    const result = applyUnifiedPatch(original, patch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Every line separator must be \r\n, not \n
      expect(result.result).toBe('alpha\r\nbeta\r\ninserted\r\ngamma\r\n');
      // Byte-level: no bare \n without preceding \r
      const bytes = Buffer.from(result.result, 'utf-8');
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0x0a) { // \n
          expect(i > 0 && bytes[i - 1] === 0x0d).toBe(true); // must be preceded by \r
        }
      }
    }
  });
});

describe('detectEOL', () => {
  it('detects LF', () => {
    expect(detectEOL('a\nb\nc\n')).toBe('\n');
  });

  it('detects CRLF', () => {
    expect(detectEOL('a\r\nb\r\nc\r\n')).toBe('\r\n');
  });

  it('mixed — CRLF dominant', () => {
    expect(detectEOL('a\r\nb\r\nc\n')).toBe('\r\n');
  });

  it('empty string defaults to LF', () => {
    expect(detectEOL('')).toBe('\n');
  });
});

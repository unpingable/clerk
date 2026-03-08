// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import {
  formatAttachmentContext,
  formatAttachmentSize,
  formatAttachmentSummary,
  baseName,
} from '../../src/renderer/lib/attachments';
import type { FileAttachment } from '../../src/shared/types';

function makeAttachment(overrides: Partial<FileAttachment> = {}): FileAttachment {
  return {
    name: 'test.txt',
    path: '/tmp/test.txt',
    size: 100,
    content: 'file content',
    contentHash: 'abc123',
    ...overrides,
  };
}

describe('formatAttachmentContext', () => {
  it('produces correct delimiters for single file', () => {
    const att = makeAttachment({ name: 'notes.txt', size: 1230, content: 'hello world' });
    const result = formatAttachmentContext([att], 'What is this?');
    expect(result).toContain('[Attached file: notes.txt | 1.2 KB]');
    expect(result).toContain('hello world');
    expect(result).toContain('[/Attached file]');
    expect(result).toContain('What is this?');
  });

  it('handles multiple files in order', () => {
    const a = makeAttachment({ name: 'a.txt', size: 100, content: 'aaa' });
    const b = makeAttachment({ name: 'b.txt', size: 200, content: 'bbb' });
    const result = formatAttachmentContext([a, b], 'review these');
    const aPos = result.indexOf('a.txt');
    const bPos = result.indexOf('b.txt');
    expect(aPos).toBeLessThan(bPos);
    expect(result).toContain('review these');
  });

  it('handles user text with trailing whitespace', () => {
    const att = makeAttachment();
    const result = formatAttachmentContext([att], '  hello  \n  ');
    // User text should be trimmed
    expect(result).toMatch(/hello$/);
  });

  it('handles empty text (attachments only)', () => {
    const att = makeAttachment({ name: 'data.csv', content: 'x,y\n1,2' });
    const result = formatAttachmentContext([att], '');
    expect(result).toContain('[Attached file: data.csv');
    expect(result).toContain('x,y\n1,2');
    // Should not have trailing blank lines after the closing tag
    expect(result).toMatch(/\[\/Attached file\]$/);
  });

  it('newline hygiene — no doubled blanks between files and text', () => {
    const att = makeAttachment();
    const result = formatAttachmentContext([att], 'hello');
    // Should not have 3+ consecutive newlines
    expect(result).not.toMatch(/\n{3,}/);
  });
});

describe('formatAttachmentSize', () => {
  it('formats bytes', () => {
    expect(formatAttachmentSize(340)).toBe('340 B');
  });

  it('formats small KB with one decimal', () => {
    expect(formatAttachmentSize(1536)).toBe('1.5 KB');
  });

  it('formats large KB as integer', () => {
    expect(formatAttachmentSize(15 * 1024)).toBe('15 KB');
  });

  it('formats MB', () => {
    expect(formatAttachmentSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
  });
});

describe('formatAttachmentSummary', () => {
  it('formats single file', () => {
    expect(formatAttachmentSummary([{ size: 1024 }])).toBe('1 file · 1.0 KB');
  });

  it('formats multiple files with total', () => {
    const result = formatAttachmentSummary([
      { size: 200 },
      { size: 100 },
      { size: 112 },
    ]);
    expect(result).toBe('3 files · 412 B');
  });
});

describe('baseName', () => {
  it('extracts filename from Unix path', () => {
    expect(baseName('/home/user/docs/file.txt')).toBe('file.txt');
  });

  it('extracts filename from Windows path', () => {
    expect(baseName('C:\\Users\\user\\docs\\file.txt')).toBe('file.txt');
  });

  it('handles bare filename', () => {
    expect(baseName('file.txt')).toBe('file.txt');
  });
});

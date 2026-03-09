// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { findMatches, highlightHtml } from '../../src/renderer/lib/search';
import type { ChatMessage } from '../../src/shared/types';

function msg(id: string, content: string, role: 'user' | 'assistant' = 'user'): ChatMessage {
  return { id, role, content, timestamp: Date.now() };
}

describe('findMatches', () => {
  it('returns empty for empty query', () => {
    expect(findMatches([msg('1', 'hello')], '')).toEqual([]);
    expect(findMatches([msg('1', 'hello')], '   ')).toEqual([]);
  });

  it('finds exact matches', () => {
    const messages = [
      msg('1', 'Hello world'),
      msg('2', 'Goodbye world'),
      msg('3', 'Nothing here'),
    ];
    const matches = findMatches(messages, 'world');
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({ messageIndex: 0, messageId: '1' });
    expect(matches[1]).toEqual({ messageIndex: 1, messageId: '2' });
  });

  it('is case-insensitive', () => {
    const messages = [msg('1', 'Hello World')];
    expect(findMatches(messages, 'hello')).toHaveLength(1);
    expect(findMatches(messages, 'WORLD')).toHaveLength(1);
  });

  it('returns empty for no matches', () => {
    expect(findMatches([msg('1', 'hello')], 'xyz')).toEqual([]);
  });

  it('matches both user and assistant messages', () => {
    const messages = [
      msg('1', 'user says test', 'user'),
      msg('2', 'assistant says test', 'assistant'),
    ];
    expect(findMatches(messages, 'test')).toHaveLength(2);
  });
});

describe('highlightHtml', () => {
  it('returns html unchanged for empty query', () => {
    expect(highlightHtml('<p>hello</p>', '')).toBe('<p>hello</p>');
  });

  it('wraps matches in <mark> tags', () => {
    const result = highlightHtml('hello world', 'world');
    expect(result).toContain('<mark class="search-highlight">world</mark>');
  });

  it('is case-insensitive', () => {
    const result = highlightHtml('Hello World', 'hello');
    expect(result).toContain('<mark class="search-highlight">Hello</mark>');
  });

  it('highlights multiple occurrences', () => {
    const result = highlightHtml('foo bar foo', 'foo');
    const marks = result.match(/<mark/g);
    expect(marks).toHaveLength(2);
  });

  it('does not modify HTML tags', () => {
    const result = highlightHtml('<a href="class">class text</a>', 'class');
    // Should not modify the href attribute
    expect(result).toContain('href="class"');
    // Should highlight the text content
    expect(result).toContain('<mark class="search-highlight">class</mark> text');
  });

  it('escapes regex special chars in query', () => {
    const result = highlightHtml('price is $10.00', '$10.00');
    expect(result).toContain('<mark class="search-highlight">$10.00</mark>');
  });
});

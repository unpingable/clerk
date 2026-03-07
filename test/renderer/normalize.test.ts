// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { normalizeAssistantContent, normalizeStreamingContent } from '../../src/renderer/lib/normalize';

describe('normalizeAssistantContent', () => {
  it('returns plain text unchanged', () => {
    expect(normalizeAssistantContent('Hello world')).toBe('Hello world');
  });

  it('returns empty string unchanged', () => {
    expect(normalizeAssistantContent('')).toBe('');
  });

  it('strips trailing tool_calls block', () => {
    const input = 'Some response text\n<tool_calls>[{"tool":"file_read","args":{"path":"x"}}]</tool_calls>';
    expect(normalizeAssistantContent(input)).toBe('Some response text');
  });

  it('strips tool_calls block with leading whitespace', () => {
    const input = 'Answer here\n\n<tool_calls>[{"tool":"file_list","args":{"path":"."}}]</tool_calls>';
    expect(normalizeAssistantContent(input)).toBe('Answer here');
  });

  it('preserves text when only open tag present (unclosed)', () => {
    const input = 'Hello <tool_calls> something';
    expect(normalizeAssistantContent(input)).toBe('Hello <tool_calls> something');
  });

  it('strips only the last tool_calls block', () => {
    // Unlikely but defensive — if content mentions <tool_calls> literally
    const input = 'I used <tool_calls> earlier\n<tool_calls>[{"tool":"file_read"}]</tool_calls>';
    expect(normalizeAssistantContent(input)).toBe('I used <tool_calls> earlier');
  });

  it('handles tool_calls block with no preceding text', () => {
    const input = '<tool_calls>[{"tool":"file_list","args":{"path":"."}}]</tool_calls>';
    expect(normalizeAssistantContent(input)).toBe('');
  });

  it('handles multiline tool_calls content', () => {
    const input = 'Let me check.\n<tool_calls>[\n  {"tool": "file_read", "args": {"path": "x"}}\n]</tool_calls>';
    expect(normalizeAssistantContent(input)).toBe('Let me check.');
  });

  it('does not strip partial tags', () => {
    const input = 'This has <tool_calls but no close';
    expect(normalizeAssistantContent(input)).toBe('This has <tool_calls but no close');
  });

  it('handles text after close tag (edge case)', () => {
    const input = 'Before\n<tool_calls>[...]</tool_calls>\nAfter';
    expect(normalizeAssistantContent(input)).toBe('Before\nAfter');
  });
});

describe('normalizeStreamingContent', () => {
  it('returns plain text unchanged', () => {
    expect(normalizeStreamingContent('Hello world')).toBe('Hello world');
  });

  it('strips complete tool_calls block (same as finalized)', () => {
    const input = 'Response\n<tool_calls>[{"tool":"file_read"}]</tool_calls>';
    expect(normalizeStreamingContent(input)).toBe('Response');
  });

  it('strips unclosed tool_calls block (mid-stream)', () => {
    const input = 'Let me check that.\n<tool_calls>[{"tool":"file_re';
    expect(normalizeStreamingContent(input)).toBe('Let me check that.');
  });

  it('strips unclosed tool_calls with just the open tag', () => {
    const input = 'Looking into it.\n<tool_calls>';
    expect(normalizeStreamingContent(input)).toBe('Looking into it.');
  });

  it('handles unclosed block with no preceding text', () => {
    const input = '<tool_calls>[{"tool":"file_list"';
    expect(normalizeStreamingContent(input)).toBe('');
  });

  it('returns empty string unchanged', () => {
    expect(normalizeStreamingContent('')).toBe('');
  });
});

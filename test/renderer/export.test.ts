// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { conversationToMarkdown } from '../../src/renderer/lib/export';
import type { ChatMessage } from '../../src/shared/types';

function msg(overrides: Partial<ChatMessage> & { role: 'user' | 'assistant' }): ChatMessage {
  return {
    id: 'msg-1',
    content: '',
    timestamp: 1709251200000,
    ...overrides,
  };
}

describe('conversationToMarkdown', () => {
  it('includes title and export header', () => {
    const md = conversationToMarkdown('My Chat', [
      msg({ role: 'user', content: 'Hello' }),
    ]);
    expect(md).toContain('# My Chat');
    expect(md).toContain('Exported from Clerk');
  });

  it('formats user messages with "You" role', () => {
    const md = conversationToMarkdown('Test', [
      msg({ role: 'user', content: 'Hello world' }),
    ]);
    expect(md).toContain('### You');
    expect(md).toContain('Hello world');
  });

  it('formats assistant messages with "Clerk" role', () => {
    const md = conversationToMarkdown('Test', [
      msg({ role: 'assistant', content: 'I can help' }),
    ]);
    expect(md).toContain('### Clerk');
    expect(md).toContain('I can help');
  });

  it('includes attachments', () => {
    const md = conversationToMarkdown('Test', [
      msg({
        role: 'user',
        content: 'Check this',
        attachments: [{ name: 'notes.txt', size: 100 }],
      }),
    ]);
    expect(md).toContain('notes.txt');
  });

  it('includes file actions with status', () => {
    const md = conversationToMarkdown('Test', [
      msg({
        role: 'assistant',
        content: 'Done',
        fileActions: [
          { tool: 'file_read', path: 'src/app.ts', allowed: true, profile: 'production', summary: 'Read src/app.ts' },
        ],
      }),
    ]);
    expect(md).toContain('✓ Read src/app.ts');
  });

  it('shows blocked file actions', () => {
    const md = conversationToMarkdown('Test', [
      msg({
        role: 'assistant',
        content: 'Blocked',
        fileActions: [
          { tool: 'file_write_create', path: '/etc/passwd', allowed: false, profile: 'strict', summary: 'Write /etc/passwd' },
        ],
      }),
    ]);
    expect(md).toContain('✗ Write /etc/passwd');
  });

  it('handles empty messages gracefully', () => {
    const md = conversationToMarkdown('Empty', []);
    expect(md).toContain('# Empty');
  });

  it('preserves message content formatting', () => {
    const md = conversationToMarkdown('Test', [
      msg({
        role: 'assistant',
        content: '```js\nconsole.log("hi");\n```',
      }),
    ]);
    expect(md).toContain('```js');
    expect(md).toContain('console.log("hi");');
  });
});

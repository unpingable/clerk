// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../../src/renderer/lib/markdown';

describe('renderMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(renderMarkdown('')).toBe('');
  });

  it('wraps plain text in paragraph', () => {
    const html = renderMarkdown('Hello world');
    expect(html).toContain('<p>Hello world</p>');
  });

  it('renders headings', () => {
    const html = renderMarkdown('# Title\n## Subtitle');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<h2>Subtitle</h2>');
  });

  it('renders bold and italic', () => {
    const html = renderMarkdown('This is **bold** and *italic*');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders unordered lists', () => {
    const html = renderMarkdown('- one\n- two\n- three');
    expect(html).toContain('<ul>');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<li>two</li>');
  });

  it('renders ordered lists', () => {
    const html = renderMarkdown('1. first\n2. second');
    expect(html).toContain('<ol>');
    expect(html).toContain('<li>first</li>');
  });

  it('renders inline code', () => {
    const html = renderMarkdown('Use `npm install` to install');
    expect(html).toContain('<code>npm install</code>');
  });

  it('renders fenced code blocks with copy button', () => {
    const html = renderMarkdown('```js\nconsole.log("hi");\n```');
    expect(html).toContain('class="code-block"');
    expect(html).toContain('class="code-copy"');
    expect(html).toContain('class="language-js"');
    expect(html).toContain('console.log(&quot;hi&quot;);');
  });

  it('renders code blocks without language', () => {
    const html = renderMarkdown('```\nplain code\n```');
    expect(html).toContain('class="code-block"');
    expect(html).not.toContain('class="code-lang"');
    expect(html).toContain('plain code');
  });

  it('renders links with safe href', () => {
    const html = renderMarkdown('[click here](https://example.com)');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('strips javascript: href from links', () => {
    const html = renderMarkdown('[evil](javascript:alert(1))');
    expect(html).not.toContain('href');
    expect(html).toContain('evil');
  });

  it('allows mailto: links', () => {
    const html = renderMarkdown('[email](mailto:test@example.com)');
    expect(html).toContain('href="mailto:test@example.com"');
  });

  it('escapes raw HTML tags', () => {
    const html = renderMarkdown('Try <script>alert(1)</script> this');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders blockquotes', () => {
    const html = renderMarkdown('> This is a quote');
    expect(html).toContain('<blockquote>');
    expect(html).toContain('This is a quote');
  });

  it('renders horizontal rules', () => {
    const html = renderMarkdown('above\n\n---\n\nbelow');
    expect(html).toContain('<hr>');
  });

  it('renders GFM tables', () => {
    const html = renderMarkdown('| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<table>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>1</td>');
  });

  it('renders images as links', () => {
    const html = renderMarkdown('![alt text](https://example.com/img.png)');
    expect(html).not.toContain('<img');
    expect(html).toContain('alt text');
    expect(html).toContain('href="https://example.com/img.png"');
  });

  it('escapes HTML entities in code blocks', () => {
    const html = renderMarkdown('```\n<div class="foo">bar</div>\n```');
    expect(html).toContain('&lt;div');
    expect(html).not.toContain('<div class="foo">');
  });

  it('handles complex markdown with mixed elements', () => {
    const source = `# Getting Started

Here's how to install:

\`\`\`bash
npm install clerk
\`\`\`

Then use it:

1. Run \`npm start\`
2. Open the **app**
3. Type a message

> It's that simple.`;

    const html = renderMarkdown(source);
    expect(html).toContain('<h1>');
    expect(html).toContain('class="code-block"');
    expect(html).toContain('<ol>');
    expect(html).toContain('<code>npm start</code>');
    expect(html).toContain('<strong>app</strong>');
    expect(html).toContain('<blockquote>');
  });
});

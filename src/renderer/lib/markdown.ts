// SPDX-License-Identifier: Apache-2.0
/**
 * Markdown rendering for assistant messages.
 *
 * Uses `marked` with a locked-down renderer:
 * - No raw HTML passthrough (all HTML tags escaped)
 * - Links open in external browser (target="_blank", rel="noopener")
 * - Sanitized href (only http/https/mailto)
 * - Code blocks get syntax highlighting via highlight.js + copy button
 */

import { Marked } from 'marked';
import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import sql from 'highlight.js/lib/languages/sql';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';

// Register languages
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('shell', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('diff', diff);

const ALLOWED_HREF = /^(https?:|mailto:)/i;

/** Escape HTML entities */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const marked = new Marked();

marked.use({
  renderer: {
    // Links: only allow safe protocols, open externally
    link({ href, text }) {
      if (!href || !ALLOWED_HREF.test(href)) {
        return typeof text === 'string' ? text : String(text);
      }
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },

    // Images: render as links (no image loading in chat)
    image({ href, text }) {
      const label = text || href || 'image';
      if (!href || !ALLOWED_HREF.test(href)) return esc(String(label));
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(String(label))}</a>`;
    },

    // Fenced code blocks with language tag + copy button hook
    code({ text, lang }) {
      const langClass = lang ? ` class="language-${esc(lang)}"` : '';
      const langLabel = lang ? `<span class="code-lang">${esc(lang)}</span>` : '';
      return `<div class="code-block">${langLabel}<button class="code-copy" title="Copy">Copy</button><pre><code${langClass}>${esc(text)}</code></pre></div>`;
    },

    // Inline code
    codespan({ text }) {
      return `<code>${esc(text)}</code>`;
    },

    // Block-level HTML: escape it (no raw HTML allowed)
    html({ text }) {
      return esc(text);
    },
  },
  gfm: true,
  breaks: false,
});

/**
 * Render markdown string to sanitized HTML.
 * Only intended for assistant messages — user messages stay plain text.
 */
export function renderMarkdown(source: string): string {
  if (!source) return '';
  const result = marked.parse(source);
  // marked.parse returns string in synchronous mode (no async option set)
  return result as string;
}

/**
 * Enhance code blocks inside a container element:
 * - Syntax highlighting via highlight.js
 * - Copy-button click handlers
 *
 * Call this after mounting/updating the DOM with rendered markdown.
 */
export function enhanceCodeBlocks(container: HTMLElement): void {
  const blocks = container.querySelectorAll<HTMLElement>('.code-block');
  for (const block of blocks) {
    // Avoid double-processing
    if (block.dataset.enhanced) continue;
    block.dataset.enhanced = '1';

    // Syntax highlight
    const codeEl = block.querySelector('code');
    if (codeEl) {
      hljs.highlightElement(codeEl);
    }

    // Copy button
    const btn = block.querySelector<HTMLButtonElement>('.code-copy');
    if (btn) {
      btn.addEventListener('click', () => {
        if (!codeEl) return;
        navigator.clipboard.writeText(codeEl.textContent ?? '').then(
          () => {
            btn.textContent = 'Copied!';
            setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
          },
          () => { /* clipboard write failed — ignore silently */ },
        );
      });
    }
  }
}

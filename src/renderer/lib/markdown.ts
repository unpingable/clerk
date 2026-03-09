// SPDX-License-Identifier: Apache-2.0
/**
 * Markdown rendering for assistant messages.
 *
 * Uses `marked` with a locked-down renderer:
 * - No raw HTML passthrough (all HTML tags escaped)
 * - Links open in external browser (target="_blank", rel="noopener")
 * - Sanitized href (only http/https/mailto)
 * - Code blocks get a copy button via post-processing
 */

import { Marked } from 'marked';

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
 * Attach copy-button click handlers to code blocks inside a container element.
 * Call this after mounting/updating the DOM with rendered markdown.
 */
export function attachCopyHandlers(container: HTMLElement): void {
  const buttons = container.querySelectorAll<HTMLButtonElement>('.code-copy');
  for (const btn of buttons) {
    // Avoid double-binding
    if (btn.dataset.bound) continue;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      const codeEl = btn.closest('.code-block')?.querySelector('code');
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

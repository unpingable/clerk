<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Single chat message bubble with optional receipt strip. -->
<script lang="ts">
  import type { ChatMessage } from '$shared/types';
  import { formatTimestamp } from '$lib/format';
  import { normalizeStreamingContent } from '$lib/normalize';
  import { renderMarkdown, enhanceCodeBlocks } from '$lib/markdown';
  import { highlightHtml } from '$lib/search';
  import ReceiptStrip from './ReceiptStrip.svelte';
  import FileActionStrip from './FileActionStrip.svelte';

  let { message, searchQuery = '' }: { message: ChatMessage; searchQuery?: string } = $props();

  const isUser = $derived(message.role === 'user');
  const isStreaming = $derived(message.streaming ?? false);
  // Strip <tool_calls> envelope during streaming (raw content still accumulates for tool parsing).
  // Finalized messages are already normalized by the chat store's onEnd handler.
  const displayContent = $derived(
    isStreaming ? normalizeStreamingContent(message.content) : message.content,
  );

  // Render markdown for all assistant messages (including streaming).
  // marked handles partial/unclosed markdown gracefully.
  const baseHtml = $derived(
    !isUser ? renderMarkdown(displayContent) : '',
  );

  // Apply search highlighting (if active)
  const renderedHtml = $derived(
    baseHtml && searchQuery ? highlightHtml(baseHtml, searchQuery) : baseHtml,
  );

  // For user messages: highlight plain text by wrapping matches in <mark>
  const userHtml = $derived(
    isUser && searchQuery ? highlightHtml(
      displayContent.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      searchQuery,
    ) : '',
  );

  let contentEl: HTMLElement | undefined = $state();

  // Enhance code blocks (syntax highlighting + copy) after markdown renders.
  // Only run on finalized messages — re-highlighting on every streaming delta is wasteful
  // and causes flicker.
  $effect(() => {
    if (contentEl && renderedHtml && !isStreaming) {
      enhanceCodeBlocks(contentEl);
    }
  });

  let copyLabel = $state('Copy');

  function copyMessage() {
    navigator.clipboard.writeText(message.content).then(
      () => { copyLabel = 'Copied!'; setTimeout(() => { copyLabel = 'Copy'; }, 1500); },
      () => {},
    );
  }
</script>

<div class="message" class:user={isUser} class:assistant={!isUser}>
  <div class="bubble">
    <div class="bubble-header">
      <span class="role">{isUser ? 'You' : 'Clerk'}</span>
      {#if !isStreaming && displayContent}
        <button class="copy-msg" title={copyLabel} onclick={copyMessage}>{copyLabel}</button>
      {/if}
    </div>
    {#if isUser}
      <div class="content plain">
        {#if userHtml}
          {@html userHtml}
        {:else}
          {displayContent}
        {/if}
      </div>
    {:else}
      <div class="content markdown" bind:this={contentEl}>
        {@html renderedHtml}{#if isStreaming}<span class="cursor">&#9608;</span>{/if}
      </div>
    {/if}
    {#if message.attachments?.length}
      <div class="msg-attachments">
        {#each message.attachments as att}
          <span class="att-chip">{att.name}</span>
        {/each}
      </div>
    {/if}
    {#if message.fileActions?.length}
      {#each message.fileActions as action}
        <FileActionStrip {action} />
      {/each}
    {/if}
    {#if message.receipt}
      <ReceiptStrip receipt={message.receipt} />
    {/if}
    <div class="meta">
      <span class="time">{formatTimestamp(message.timestamp)}</span>
    </div>
  </div>
</div>

<style>
  .message {
    display: flex;
    padding: 0 var(--sp-md);
    margin-bottom: var(--sp-sm);
  }
  .message.user {
    justify-content: flex-end;
  }
  .message.assistant {
    justify-content: flex-start;
  }
  .bubble {
    max-width: 80%;
    padding: var(--sp-sm) var(--sp-md);
    border-radius: var(--radius-md);
    line-height: 1.5;
  }
  .user .bubble {
    background: var(--clerk-user-bg);
    border: 1px solid var(--clerk-user-border);
  }
  .assistant .bubble {
    background: var(--clerk-assistant-bg);
    border: 1px solid var(--clerk-assistant-border);
  }
  .bubble-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2px;
  }
  .role {
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--clerk-text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .copy-msg {
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
    background: none;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
    opacity: 0;
    transition: opacity 0.15s;
  }
  .bubble:hover .copy-msg {
    opacity: 1;
  }
  .copy-msg:hover {
    color: var(--clerk-text);
    background: color-mix(in srgb, var(--clerk-surface) 50%, transparent);
  }
  .content.plain {
    font-size: var(--font-size-md);
    color: var(--clerk-text);
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* ---- Markdown content ---- */
  .content.markdown {
    font-size: var(--font-size-md);
    color: var(--clerk-text);
    word-break: break-word;
  }
  /* Paragraphs */
  .content.markdown :global(p) {
    margin: 0 0 0.6em;
  }
  .content.markdown :global(p:last-child) {
    margin-bottom: 0;
  }
  /* Headings */
  .content.markdown :global(h1),
  .content.markdown :global(h2),
  .content.markdown :global(h3),
  .content.markdown :global(h4) {
    margin: 0.8em 0 0.4em;
    font-weight: 600;
    color: var(--clerk-text);
    line-height: 1.3;
  }
  .content.markdown :global(h1:first-child),
  .content.markdown :global(h2:first-child),
  .content.markdown :global(h3:first-child) {
    margin-top: 0;
  }
  .content.markdown :global(h1) { font-size: 1.3em; }
  .content.markdown :global(h2) { font-size: 1.15em; }
  .content.markdown :global(h3) { font-size: 1.05em; }
  .content.markdown :global(h4) { font-size: 1em; }
  /* Lists */
  .content.markdown :global(ul),
  .content.markdown :global(ol) {
    margin: 0.4em 0 0.6em;
    padding-left: 1.5em;
  }
  .content.markdown :global(li) {
    margin-bottom: 0.2em;
  }
  .content.markdown :global(li > p) {
    margin-bottom: 0.3em;
  }
  /* Inline code */
  .content.markdown :global(code) {
    font-family: var(--font-mono);
    font-size: 0.88em;
    padding: 0.15em 0.35em;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--clerk-surface) 60%, var(--clerk-bg));
  }
  /* Code blocks */
  .content.markdown :global(.code-block) {
    position: relative;
    margin: 0.6em 0;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--clerk-bg) 80%, #000);
    border: 1px solid var(--clerk-border);
    overflow: hidden;
  }
  .content.markdown :global(.code-block pre) {
    margin: 0;
    padding: 0.8em 1em;
    overflow-x: auto;
  }
  .content.markdown :global(.code-block code) {
    padding: 0;
    background: none;
    font-size: var(--font-size-sm);
    line-height: 1.5;
  }
  .content.markdown :global(.code-lang) {
    display: inline-block;
    padding: 2px 8px;
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
    background: color-mix(in srgb, var(--clerk-border) 40%, transparent);
    border-bottom-right-radius: var(--radius-sm);
  }
  .content.markdown :global(.code-copy) {
    position: absolute;
    top: 4px;
    right: 4px;
    padding: 2px 8px;
    font-size: var(--font-size-xs);
    font-family: var(--font-sans);
    color: var(--clerk-text-muted);
    background: color-mix(in srgb, var(--clerk-surface) 50%, transparent);
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
  }
  .content.markdown :global(.code-block:hover .code-copy) {
    opacity: 1;
  }
  .content.markdown :global(.code-copy:hover) {
    background: var(--clerk-surface-hover);
    color: var(--clerk-text);
  }
  /* Blockquotes */
  .content.markdown :global(blockquote) {
    margin: 0.4em 0 0.6em;
    padding: 0.3em 0 0.3em 0.8em;
    border-left: 3px solid var(--clerk-accent);
    color: var(--clerk-text-secondary);
  }
  .content.markdown :global(blockquote p) {
    margin-bottom: 0.3em;
  }
  /* Horizontal rules */
  .content.markdown :global(hr) {
    margin: 0.8em 0;
    border: none;
    border-top: 1px solid var(--clerk-border);
  }
  /* Tables (GFM) */
  .content.markdown :global(table) {
    border-collapse: collapse;
    margin: 0.6em 0;
    font-size: var(--font-size-sm);
    width: 100%;
  }
  .content.markdown :global(th),
  .content.markdown :global(td) {
    padding: 0.3em 0.6em;
    border: 1px solid var(--clerk-border);
    text-align: left;
  }
  .content.markdown :global(th) {
    background: color-mix(in srgb, var(--clerk-surface) 40%, var(--clerk-bg));
    font-weight: 600;
  }
  /* Strong / emphasis */
  .content.markdown :global(strong) {
    font-weight: 600;
  }
  /* Links */
  .content.markdown :global(a) {
    color: var(--clerk-accent);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--clerk-accent) 40%, transparent);
  }
  .content.markdown :global(a:hover) {
    color: var(--clerk-accent-hover);
    text-decoration-color: var(--clerk-accent-hover);
  }

  /* Search highlights */
  .content :global(.search-highlight) {
    background: color-mix(in srgb, var(--clerk-warn) 40%, transparent);
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }
  .cursor {
    animation: blink 1s step-end infinite;
    color: var(--clerk-accent);
  }
  @keyframes blink {
    50% { opacity: 0; }
  }
  .msg-attachments {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 6px;
  }
  .att-chip {
    display: inline-block;
    padding: 2px 8px;
    background: color-mix(in srgb, var(--clerk-accent) 12%, var(--clerk-bg));
    border-radius: var(--radius-sm);
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
  }
  .meta {
    margin-top: 4px;
  }
  .time {
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
  }
</style>

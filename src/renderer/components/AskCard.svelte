<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Inline confirmation card for ASK_REQUIRED operations. -->
<script lang="ts">
  import type { AskRequest } from '$shared/types';

  let { ask, onRespond }: {
    ask: AskRequest;
    onRespond: (decision: 'allow_once' | 'deny') => void;
  } = $props();

  let expanded = $state(false);

  const sizeLabel = $derived(
    ask.contentSize != null
      ? ask.contentSize < 1024
        ? `${ask.contentSize} bytes`
        : `${(ask.contentSize / 1024).toFixed(1)} KB`
      : null
  );
</script>

<div class="ask-card">
  <div class="header">
    <span class="icon">?</span>
    <span class="title">Approval Required</span>
  </div>
  <div class="body">
    <div class="operation">{ask.operationLabel}</div>
    <div class="path">{ask.path}</div>
    {#if sizeLabel}
      <div class="meta">{sizeLabel}</div>
    {/if}
    {#if ask.contentPreview}
      <button
        class="preview-toggle"
        onclick={() => expanded = !expanded}
      >
        {expanded ? 'Hide preview' : 'Show preview'}
      </button>
      {#if expanded}
        <pre class="preview">{ask.contentPreview}{ask.contentPreview.length >= 200 ? '...' : ''}</pre>
      {/if}
    {/if}
  </div>
  <div class="actions">
    <button class="btn allow" onclick={() => onRespond('allow_once')}>Allow Once</button>
    <button class="btn deny" onclick={() => onRespond('deny')}>Deny</button>
  </div>
</div>

<style>
  .ask-card {
    border: 2px solid var(--clerk-warn, #e8a838);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--clerk-warn, #e8a838) 8%, var(--clerk-bg));
    padding: var(--sp-md);
    margin: var(--sp-sm) var(--sp-md);
  }
  .header {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    margin-bottom: var(--sp-sm);
  }
  .icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--clerk-warn, #e8a838);
    color: white;
    font-weight: 700;
    font-size: 13px;
  }
  .title {
    font-weight: 600;
    color: var(--clerk-text);
    font-size: var(--font-size-md);
  }
  .body {
    margin-bottom: var(--sp-md);
    font-size: var(--font-size-sm);
    color: var(--clerk-text-secondary);
  }
  .operation {
    font-weight: 500;
    color: var(--clerk-text);
    margin-bottom: 2px;
  }
  .path {
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
  }
  .meta {
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
    margin-top: 4px;
  }
  .preview-toggle {
    background: none;
    color: var(--clerk-accent);
    font-size: var(--font-size-xs);
    padding: 2px 0;
    margin-top: 4px;
    cursor: pointer;
  }
  .preview-toggle:hover {
    text-decoration: underline;
  }
  .preview {
    margin-top: 4px;
    padding: var(--sp-sm);
    background: var(--clerk-bg-secondary);
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    overflow-x: auto;
    max-height: 200px;
    overflow-y: auto;
    white-space: pre-wrap;
    word-break: break-all;
    color: var(--clerk-text);
  }
  .actions {
    display: flex;
    gap: var(--sp-sm);
  }
  .btn {
    padding: 6px 16px;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    font-weight: 500;
    cursor: pointer;
  }
  .allow {
    background: var(--clerk-warn, #e8a838);
    color: white;
  }
  .allow:hover {
    filter: brightness(0.9);
  }
  .deny {
    background: var(--clerk-bg-secondary);
    color: var(--clerk-text-muted);
    border: 1px solid var(--clerk-border);
  }
  .deny:hover {
    color: var(--clerk-text);
  }
</style>

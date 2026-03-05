<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Blocking violation display with Fix/Revise/Proceed actions. -->
<script lang="ts">
  import type { PendingViolation } from '$shared/types';
  import * as chat from '../stores/chat.svelte';
  import { settings } from '../stores/settings.svelte';

  let { violation }: { violation: PendingViolation } = $props();

  const friendly = $derived(settings.friendlyMode);
  const titleText = $derived(friendly ? "Clerk wasn't sure about this" : 'Violation');
  const reviseLabel = $derived(friendly ? 'Revise Rule' : 'Revise Anchor');

  async function fix() {
    await chat.resolveViolation('fix');
  }

  async function revise() {
    await chat.resolveViolation('revise');
  }

  async function proceed() {
    await chat.resolveViolation('proceed');
  }
</script>

<div class="card">
  <div class="header">
    <span class="icon">&#9888;</span>
    <span class="title">{titleText}</span>
    <span class="severity">{violation.severity}</span>
  </div>

  <p class="description">{violation.description}</p>

  {#if violation.content_preview}
    <pre class="preview">{violation.content_preview}</pre>
  {/if}

  <div class="actions">
    <button class="btn btn-fix" onclick={fix}>Fix</button>
    <button class="btn btn-revise" onclick={revise}>{reviseLabel}</button>
    <button class="btn btn-proceed" onclick={proceed}>Proceed</button>
  </div>
</div>

<style>
  .card {
    background: color-mix(in srgb, var(--clerk-warn) 8%, var(--clerk-bg));
    border: 1px solid var(--clerk-warn);
    border-radius: var(--radius-md);
    padding: var(--sp-md);
    margin: var(--sp-sm) 0;
  }
  .header {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    margin-bottom: var(--sp-sm);
  }
  .icon {
    font-size: var(--font-size-lg);
    color: var(--clerk-warn);
  }
  .title {
    font-weight: 600;
    color: var(--clerk-warn);
  }
  .severity {
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
    margin-left: auto;
    text-transform: uppercase;
  }
  .description {
    color: var(--clerk-text);
    font-size: var(--font-size-sm);
    margin-bottom: var(--sp-sm);
  }
  .preview {
    background: var(--clerk-bg);
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-sm);
    padding: var(--sp-sm);
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
    white-space: pre-wrap;
    word-break: break-word;
    margin-bottom: var(--sp-md);
    max-height: 100px;
    overflow-y: auto;
  }
  .actions {
    display: flex;
    gap: var(--sp-sm);
  }
  .btn {
    padding: 6px 14px;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    font-weight: 500;
  }
  .btn-fix {
    background: var(--clerk-pass);
    color: #111;
  }
  .btn-fix:hover { opacity: 0.9; }
  .btn-revise {
    background: var(--clerk-surface);
    color: var(--clerk-text);
    border: 1px solid var(--clerk-border);
  }
  .btn-revise:hover { background: var(--clerk-surface-hover); }
  .btn-proceed {
    background: var(--clerk-surface);
    color: var(--clerk-warn);
    border: 1px solid var(--clerk-warn);
  }
  .btn-proceed:hover { background: var(--clerk-surface-hover); }
</style>

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Constraint mode selector — the "trust dial". -->
<script lang="ts">
  import * as tmpl from '../stores/template.svelte';
  import type { CapabilityKey, CapabilityLevel } from '$shared/types';

  const templates = $derived(tmpl.getTemplates());
  const selected = $derived(tmpl.getSelectedTemplateId());
  const applied = $derived(tmpl.getAppliedTemplateId());
  const applying = $derived(tmpl.isApplying());
  const isConfirming = $derived(tmpl.getIsConfirming());
  const confirmingTemplate = $derived(tmpl.getConfirmingTemplate());
  const lastError = $derived(tmpl.getLastError());

  const CAPABILITY_KEYS: CapabilityKey[] = ['read', 'write', 'execute', 'network', 'destructive'];

  function levelClass(level: CapabilityLevel): string {
    return `level-${level}`;
  }

  function onChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    tmpl.requestTemplate(target.value);
  }
</script>

{#if templates.length > 0}
  <div class="template-picker">
    <select
      class="picker"
      class:mismatch={selected !== applied && !applying}
      value={selected}
      disabled={applying}
      onchange={onChange}
    >
      {#each templates as template}
        <option value={template.id}>{template.name}</option>
      {/each}
    </select>
    {#if applying}
      <span class="status applying">Applying...</span>
    {:else if lastError}
      <span class="status error" title={lastError.message}>!</span>
    {/if}
  </div>
{/if}

{#if isConfirming && confirmingTemplate}
  <div class="overlay" role="dialog" aria-label="Confirm template change">
    <div class="confirm-card">
      <h3 class="confirm-title">{confirmingTemplate.name}</h3>
      <p class="confirm-desc">{confirmingTemplate.description}</p>
      <ul class="capability-list">
        {#each CAPABILITY_KEYS as key}
          <li class="capability-item">
            <span class="cap-name">{tmpl.getCapabilityLabel(key)}</span>
            <span class="cap-level {levelClass(confirmingTemplate.capabilities[key])}">
              {tmpl.getLevelLabel(confirmingTemplate.capabilities[key])}
            </span>
          </li>
        {/each}
      </ul>
      <div class="confirm-actions">
        <button class="btn btn-cancel" onclick={tmpl.cancelConfirmation}>Cancel</button>
        <button class="btn btn-confirm" onclick={tmpl.confirmTemplate}>Confirm</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .template-picker {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .picker {
    background: var(--clerk-surface);
    color: var(--clerk-text);
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    font-size: var(--font-size-xs);
    font-family: var(--font-sans);
    cursor: pointer;
  }
  .picker:focus {
    outline: 2px solid var(--clerk-accent);
    outline-offset: 1px;
  }
  .picker:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  .picker.mismatch {
    border-color: var(--clerk-warn);
  }
  .status {
    font-size: var(--font-size-xs);
  }
  .status.applying {
    color: var(--clerk-text-muted);
  }
  .status.error {
    color: var(--clerk-block);
    font-weight: bold;
    cursor: help;
  }

  /* Confirmation overlay */
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }
  .confirm-card {
    background: var(--clerk-bg-secondary, #1e1e1e);
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-md, 8px);
    padding: var(--sp-md, 16px);
    max-width: 360px;
    width: 90%;
  }
  .confirm-title {
    margin: 0 0 8px;
    font-size: var(--font-size-md, 16px);
    color: var(--clerk-text);
  }
  .confirm-desc {
    margin: 0 0 12px;
    font-size: var(--font-size-sm, 14px);
    color: var(--clerk-text-muted);
  }
  .capability-list {
    list-style: none;
    padding: 0;
    margin: 0 0 16px;
  }
  .capability-item {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    font-size: var(--font-size-xs, 12px);
    border-bottom: 1px solid var(--clerk-border);
  }
  .capability-item:last-child {
    border-bottom: none;
  }
  .cap-name {
    color: var(--clerk-text);
  }
  .cap-level {
    font-weight: 500;
  }
  .level-allow {
    color: var(--clerk-pass);
  }
  .level-ask {
    color: var(--clerk-warn);
  }
  .level-deny {
    color: var(--clerk-block);
  }
  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .btn {
    padding: 6px 16px;
    border-radius: var(--radius-sm, 4px);
    border: 1px solid var(--clerk-border);
    font-size: var(--font-size-sm, 14px);
    font-family: var(--font-sans);
    cursor: pointer;
  }
  .btn-cancel {
    background: transparent;
    color: var(--clerk-text);
  }
  .btn-confirm {
    background: var(--clerk-block);
    color: white;
    border-color: var(--clerk-block);
  }
  .btn-confirm:hover {
    opacity: 0.9;
  }
</style>

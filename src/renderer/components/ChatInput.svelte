<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Chat input textarea with send/stop button. -->
<script lang="ts">
  import * as chat from '../stores/chat.svelte';
  import { formatAttachmentSize, formatAttachmentSummary } from '$lib/attachments';

  let inputValue = $state('');
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let attachErrors = $state<Array<{ name: string; error: string; id: number }>>([]);
  let nextErrorId = 0;

  const streaming = $derived(chat.state.streaming);
  const canSend = $derived(chat.getCanSend());
  const attachments = $derived(chat.getPendingAttachments());
  const hasContent = $derived(inputValue.trim().length > 0 || attachments.length > 0);

  function addAttachError(name: string, error: string) {
    const id = nextErrorId++;
    attachErrors.push({ name, error, id });
    setTimeout(() => {
      attachErrors = attachErrors.filter(e => e.id !== id);
    }, 4000);
  }

  async function handleSend() {
    if (!canSend || !hasContent) return;
    const content = inputValue;
    inputValue = '';
    await chat.send(content);
    textareaEl?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && streaming) {
      e.preventDefault();
      chat.stopStreaming();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    // Cmd/Ctrl+Enter as alternative send
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleFocusEvent() {
    textareaEl?.focus();
  }

  function handlePrefillEvent(e: Event) {
    const { text } = (e as CustomEvent<{ text: string }>).detail;
    inputValue = text;
    textareaEl?.focus();
    requestAnimationFrame(() => {
      if (textareaEl) {
        textareaEl.selectionStart = textareaEl.selectionEnd = textareaEl.value.length;
      }
    });
  }

  function handleAttachErrorEvent(e: Event) {
    const { name, error } = (e as CustomEvent<{ name: string; error: string }>).detail;
    addAttachError(name, error);
  }

  $effect(() => {
    window.addEventListener('clerk:focus-input', handleFocusEvent);
    window.addEventListener('clerk:prefill-input', handlePrefillEvent);
    window.addEventListener('clerk:attach-error', handleAttachErrorEvent);
    return () => {
      window.removeEventListener('clerk:focus-input', handleFocusEvent);
      window.removeEventListener('clerk:prefill-input', handlePrefillEvent);
      window.removeEventListener('clerk:attach-error', handleAttachErrorEvent);
    };
  });
</script>

<div class="input-wrap">
{#if attachments.length > 0}
  <div class="attachments">
    <div class="chip-row">
      {#each attachments as att (att.path)}
        <span class="chip">
          {att.name}
          <span class="chip-size">({formatAttachmentSize(att.size)})</span>
          <button type="button" class="chip-remove" onclick={() => chat.removeAttachment(att.path)}>×</button>
        </span>
      {/each}
    </div>
    <div class="attach-footer">
      <span class="attach-summary">{formatAttachmentSummary(attachments)}</span>
      <span class="attach-hint">· Attached files will be included with your next message.</span>
      {#if attachments.length >= 2}
        <button type="button" class="clear-all" onclick={() => chat.clearAttachments()}>Clear</button>
      {/if}
    </div>
  </div>
{/if}
{#if attachErrors.length > 0}
  <div class="attach-errors">
    {#each attachErrors as err (err.id)}
      <div class="attach-error">{err.name}: {err.error}</div>
    {/each}
  </div>
{/if}
<div class="input-bar">
  <textarea
    bind:this={textareaEl}
    bind:value={inputValue}
    onkeydown={handleKeydown}
    placeholder={streaming ? 'Clerk is thinking...' : 'Ask Clerk to do something...'}
    disabled={!canSend}
    rows="1"
    class="input"
  ></textarea>
  {#if streaming}
    <button
      class="stop-btn"
      onclick={() => chat.stopStreaming()}
      title="Stop (Escape)"
    >
      Stop
    </button>
  {:else}
    <button
      class="send-btn"
      onclick={handleSend}
      disabled={!canSend || !hasContent}
      title="Send (Enter)"
    >
      Send
    </button>
  {/if}
</div>
</div>

<style>
  .input-wrap {
    border-top: 1px solid var(--clerk-border);
    background: var(--clerk-bg-secondary);
  }
  .attachments {
    padding: var(--sp-sm) var(--sp-md) 0;
  }
  .chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    background: var(--clerk-bg);
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    color: var(--clerk-text);
  }
  .chip-size {
    color: var(--clerk-text-muted);
    font-size: var(--font-size-xs);
  }
  .chip-remove {
    background: none;
    border: none;
    color: var(--clerk-text-muted);
    cursor: pointer;
    padding: 0 2px;
    font-size: var(--font-size-md);
    line-height: 1;
  }
  .chip-remove:hover {
    color: var(--clerk-text);
  }
  .attach-footer {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 4px;
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
  }
  .attach-summary {
    font-weight: 500;
  }
  .clear-all {
    background: none;
    border: none;
    color: var(--clerk-text-muted);
    font-size: var(--font-size-xs);
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
  }
  .clear-all:hover {
    color: var(--clerk-text);
  }
  .attach-errors {
    padding: 4px var(--sp-md) 0;
  }
  .attach-error {
    font-size: var(--font-size-xs);
    color: var(--clerk-block, #e05252);
    padding: 2px 0;
  }
  .input-bar {
    display: flex;
    align-items: flex-end;
    gap: var(--sp-sm);
    padding: var(--sp-md);
  }
  .input {
    flex: 1;
    resize: none;
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-md);
    background: var(--clerk-bg);
    color: var(--clerk-text);
    padding: 10px 14px;
    font-family: var(--font-sans);
    font-size: var(--font-size-md);
    line-height: 1.4;
    min-height: 42px;
    max-height: 150px;
    overflow-y: auto;
  }
  .input:focus {
    outline: none;
    border-color: var(--clerk-accent);
  }
  .input::placeholder {
    color: var(--clerk-text-muted);
  }
  .input:disabled {
    opacity: 0.5;
  }
  .send-btn {
    padding: 10px 20px;
    background: var(--clerk-accent);
    color: white;
    border-radius: var(--radius-md);
    font-size: var(--font-size-md);
    font-weight: 500;
    white-space: nowrap;
  }
  .send-btn:hover:not(:disabled) {
    background: var(--clerk-accent-hover);
  }
  .send-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .stop-btn {
    padding: 10px 20px;
    background: var(--clerk-block, #e05252);
    color: white;
    border-radius: var(--radius-md);
    font-size: var(--font-size-md);
    font-weight: 500;
    white-space: nowrap;
  }
  .stop-btn:hover {
    filter: brightness(0.9);
  }
</style>

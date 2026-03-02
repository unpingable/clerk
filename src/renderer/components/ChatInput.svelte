<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Chat input textarea with send button. -->
<script lang="ts">
  import * as chat from '../stores/chat.svelte';

  let inputValue = $state('');
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  const canSend = $derived(chat.getCanSend());
  const streaming = $derived(chat.isStreaming());

  async function handleSend() {
    if (!canSend || !inputValue.trim()) return;
    const content = inputValue;
    inputValue = '';
    await chat.send(content);
    textareaEl?.focus();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }
</script>

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
  <button
    class="send-btn"
    onclick={handleSend}
    disabled={!canSend || !inputValue.trim()}
    title="Send (Enter)"
  >
    Send
  </button>
</div>

<style>
  .input-bar {
    display: flex;
    align-items: flex-end;
    gap: var(--sp-sm);
    padding: var(--sp-md);
    border-top: 1px solid var(--clerk-border);
    background: var(--clerk-bg-secondary);
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
</style>

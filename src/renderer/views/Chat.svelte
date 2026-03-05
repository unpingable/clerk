<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Chat panel — the Day 1 only view. -->
<script lang="ts">
  import * as chat from '../stores/chat.svelte';
  import ChatMessage from '../components/ChatMessage.svelte';
  import ChatInput from '../components/ChatInput.svelte';
  import ViolationCard from '../components/ViolationCard.svelte';
  import AskCard from '../components/AskCard.svelte';

  const messages = $derived(chat.getMessages());

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && chat.state.error && !chat.state.streaming && !chat.state.pendingAsk) {
      chat.clearError();
    }
  }

  let scrollEl: HTMLDivElement | undefined = $state();

  // Auto-scroll to bottom when messages change
  $effect(() => {
    // Touch messages to subscribe
    messages.length;
    if (scrollEl) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="chat">
  <div class="messages" bind:this={scrollEl}>
    {#if messages.length === 0}
      <div class="empty">
        <h2>Welcome to Clerk</h2>
        <p>
          I'm your desktop assistant. Tell me what you need help with &mdash;
          organizing files, writing documents, searching for information,
          or managing your project.
        </p>
        <p>
          Everything I do is tracked in the Activity panel, so you can
          always see what happened and why.
        </p>
        <p class="settings-hint">
          Prefer technical terms? You can switch in &#9881; Settings.
        </p>
        <p class="hint">What would you like help with?</p>
      </div>
    {:else}
      {#each messages as message (message.id)}
        <ChatMessage {message} />
      {/each}
    {/if}

    {#if chat.state.pendingAsk}
      <div class="ask-wrap">
        <AskCard ask={chat.state.pendingAsk} onRespond={(d) => chat.respondToAsk(d)} />
      </div>
    {/if}

    {#if chat.state.pendingViolation}
      <div class="violation-wrap">
        <ViolationCard violation={chat.state.pendingViolation} />
      </div>
    {/if}

    {#if chat.state.error}
      <div class="error">
        <span>Error: {chat.state.error}</span>
        <button onclick={() => chat.clearError()}>Dismiss</button>
      </div>
    {/if}
  </div>

  {#key chat.state.streaming}
    <ChatInput />
  {/key}
</div>

<style>
  .chat {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }
  .messages {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-md) 0;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    text-align: center;
    padding: var(--sp-xl);
    color: var(--clerk-text-secondary);
  }
  .empty h2 {
    font-size: var(--font-size-xl);
    color: var(--clerk-text);
    margin-bottom: var(--sp-md);
  }
  .empty p {
    max-width: 460px;
    line-height: 1.6;
    margin-bottom: var(--sp-sm);
  }
  .settings-hint {
    font-size: var(--font-size-sm);
    color: var(--clerk-text-muted);
  }
  .hint {
    color: var(--clerk-text-muted);
    font-style: italic;
  }
  .ask-wrap {
    padding: 0 var(--sp-md);
  }
  .violation-wrap {
    padding: 0 var(--sp-md);
  }
  .error {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    margin: var(--sp-sm) var(--sp-md);
    padding: var(--sp-sm) var(--sp-md);
    background: color-mix(in srgb, var(--clerk-block) 12%, var(--clerk-bg));
    border: 1px solid var(--clerk-block);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
    color: var(--clerk-block);
  }
  .error button {
    margin-left: auto;
    background: none;
    color: var(--clerk-text-muted);
    font-size: var(--font-size-xs);
    padding: 2px 8px;
    border-radius: var(--radius-sm);
  }
  .error button:hover {
    color: var(--clerk-text);
  }
</style>

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Single chat message bubble with optional receipt strip. -->
<script lang="ts">
  import type { ChatMessage } from '$shared/types';
  import { formatTimestamp } from '$lib/format';
  import ReceiptStrip from './ReceiptStrip.svelte';
  import FileActionStrip from './FileActionStrip.svelte';

  let { message }: { message: ChatMessage } = $props();

  const isUser = $derived(message.role === 'user');
  const isStreaming = $derived(message.streaming ?? false);
</script>

<div class="message" class:user={isUser} class:assistant={!isUser}>
  <div class="bubble">
    <div class="role">{isUser ? 'You' : 'Clerk'}</div>
    <div class="content">
      {message.content}{#if isStreaming}<span class="cursor">&#9608;</span>{/if}
    </div>
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
  .role {
    font-size: var(--font-size-xs);
    font-weight: 600;
    color: var(--clerk-text-secondary);
    margin-bottom: 2px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .content {
    font-size: var(--font-size-md);
    color: var(--clerk-text);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .cursor {
    animation: blink 1s step-end infinite;
    color: var(--clerk-accent);
  }
  @keyframes blink {
    50% { opacity: 0; }
  }
  .meta {
    margin-top: 4px;
  }
  .time {
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
  }
</style>

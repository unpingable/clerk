<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Chat panel — the Day 1 only view. -->
<script lang="ts">
  import * as chat from '../stores/chat.svelte';
  import ChatMessage from '../components/ChatMessage.svelte';
  import ChatInput from '../components/ChatInput.svelte';
  import ViolationCard from '../components/ViolationCard.svelte';
  import AskCard from '../components/AskCard.svelte';
  import SearchBar from '../components/SearchBar.svelte';
  import { classifyChatError } from '$lib/jargon';
  import { findMatches } from '$lib/search';
  import { settings } from '../stores/settings.svelte';

  const errorInfo = $derived(
    chat.state.error ? classifyChatError(chat.state.error, settings.friendlyMode) : null,
  );

  const messages = $derived(chat.getMessages());

  // --- Search state ---
  let searchOpen = $state(false);
  let searchQuery = $state('');
  let currentMatchIdx = $state(0);

  const searchMatches = $derived(findMatches(messages, searchQuery));

  // Clamp current match index when matches change
  $effect(() => {
    if (currentMatchIdx >= searchMatches.length) {
      currentMatchIdx = Math.max(0, searchMatches.length - 1);
    }
  });

  // Scroll to current match
  $effect(() => {
    if (searchMatches.length > 0 && scrollEl) {
      const match = searchMatches[currentMatchIdx];
      if (match) {
        const el = scrollEl.querySelector(`[data-msg-id="${match.messageId}"]`);
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  });

  function openSearch() {
    searchOpen = true;
    searchQuery = '';
    currentMatchIdx = 0;
  }

  function closeSearch() {
    searchOpen = false;
    searchQuery = '';
  }

  function nextMatch() {
    if (searchMatches.length === 0) return;
    currentMatchIdx = (currentMatchIdx + 1) % searchMatches.length;
  }

  function prevMatch() {
    if (searchMatches.length === 0) return;
    currentMatchIdx = (currentMatchIdx - 1 + searchMatches.length) % searchMatches.length;
  }

  function handleKeydown(e: KeyboardEvent) {
    // Ctrl+F: open search
    if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
      e.preventDefault();
      openSearch();
      return;
    }
    if (e.key === 'Escape') {
      if (searchOpen) {
        e.preventDefault();
        closeSearch();
        return;
      }
      if (chat.state.error && !chat.state.streaming && !chat.state.pendingAsk) {
        chat.clearError();
      }
    }
  }

  let scrollEl: HTMLDivElement | undefined = $state();
  let showScrollBtn = $state(false);
  let dragging = $state(false);
  let dragCounter = 0;

  function handleScroll() {
    if (!scrollEl) return;
    const distFromBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight;
    showScrollBtn = distFromBottom > 100;
  }

  function scrollToBottom() {
    if (scrollEl) {
      scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
    }
  }

  function hasFiles(e: DragEvent): boolean {
    return e.dataTransfer?.types?.includes('Files') ?? false;
  }

  function handleDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragCounter++;
    dragging = true;
  }

  function handleDragOver(e: DragEvent) {
    if (!hasFiles(e)) return;
    e.preventDefault();
  }

  function handleDragLeave(e: DragEvent) {
    if (!hasFiles(e)) return;
    dragCounter--;
    if (dragCounter <= 0) {
      dragging = false;
      dragCounter = 0;
    }
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    dragCounter = 0;

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      // webkitRelativePath or path from Electron's File object
      const filePath = (file as any).path as string | undefined;
      if (!filePath) continue;

      const result = await chat.attachFile(filePath);
      if (!result.ok) {
        window.dispatchEvent(new CustomEvent('clerk:attach-error', {
          detail: { name: result.name, error: result.error },
        }));
      }
    }
  }

  // Auto-scroll to bottom when messages change (only when not searching)
  $effect(() => {
    messages.length;
    if (scrollEl && !searchOpen) {
      scrollEl.scrollTop = scrollEl.scrollHeight;
    }
  });

  // Listen for search-messages event from command palette
  $effect(() => {
    function handleSearchMessages() { openSearch(); }
    window.addEventListener('clerk:search-messages', handleSearchMessages);
    return () => window.removeEventListener('clerk:search-messages', handleSearchMessages);
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="chat"
  ondragenter={handleDragEnter}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  {#if searchOpen}
    <SearchBar
      query={searchQuery}
      matchCount={searchMatches.length}
      currentMatch={currentMatchIdx}
      onClose={closeSearch}
      onNext={nextMatch}
      onPrev={prevMatch}
      onQueryChange={(q) => { searchQuery = q; currentMatchIdx = 0; }}
    />
  {/if}

  <div class="messages" bind:this={scrollEl} onscroll={handleScroll}>
    {#if messages.length === 0}
      <div class="empty">
        <h2>Welcome to Clerk</h2>
        <p>
          I'm your desktop assistant. Tell me what you need help with &mdash;
          organizing files, writing documents, searching for information,
          or managing your project.
        </p>
        <p>
          Everything I do is tracked &mdash; click Details in the status bar
          to see what happened and why.
        </p>
        <p class="settings-hint">
          Prefer technical terms? You can switch in &#9881; Settings.
        </p>
        <p class="hint">What would you like help with?</p>
      </div>
    {:else}
      {#each messages as message (message.id)}
        <div data-msg-id={message.id}>
          <ChatMessage {message} searchQuery={searchOpen ? searchQuery : ''} />
        </div>
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

    {#if errorInfo}
      <div class="error-card" class:warning={errorInfo.severity === 'warning'} class:fatal={errorInfo.severity === 'fatal'}>
        <div class="error-icon">
          {#if errorInfo.severity === 'warning'}&#9888;{:else}&#10007;{/if}
        </div>
        <div class="error-body">
          <div class="error-message">{errorInfo.message}</div>
          <div class="error-hint">{errorInfo.hint}</div>
        </div>
        <div class="error-actions">
          {#if errorInfo.retryable && chat.state.lastFailedMessage}
            <button class="error-retry" onclick={() => chat.retry()}>Retry</button>
          {/if}
          <button class="error-dismiss" onclick={() => chat.clearError()}>Dismiss</button>
        </div>
      </div>
    {/if}
  </div>

  {#if showScrollBtn && messages.length > 0}
    <button class="scroll-bottom" onclick={scrollToBottom} title="Scroll to bottom">&#8595;</button>
  {/if}

  {#key chat.state.streaming}
    <ChatInput />
  {/key}

  {#if dragging}
    <div class="drop-overlay">Drop files to attach</div>
  {/if}
</div>

<style>
  .chat {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    position: relative;
  }
  .drop-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--clerk-bg) 85%, var(--clerk-accent));
    border: 2px dashed var(--clerk-accent);
    border-radius: var(--radius-md);
    font-size: var(--font-size-lg, 18px);
    color: var(--clerk-accent);
    z-index: 10;
    pointer-events: none;
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
  .error-card {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-sm);
    margin: var(--sp-sm) var(--sp-md);
    padding: var(--sp-sm) var(--sp-md);
    background: color-mix(in srgb, var(--clerk-block) 10%, var(--clerk-bg));
    border: 1px solid color-mix(in srgb, var(--clerk-block) 40%, var(--clerk-border));
    border-left: 3px solid var(--clerk-block);
    border-radius: var(--radius-md);
    font-size: var(--font-size-sm);
  }
  .error-card.warning {
    background: color-mix(in srgb, var(--clerk-warn) 8%, var(--clerk-bg));
    border-color: color-mix(in srgb, var(--clerk-warn) 30%, var(--clerk-border));
    border-left-color: var(--clerk-warn);
  }
  .error-card.fatal {
    background: color-mix(in srgb, var(--clerk-block) 14%, var(--clerk-bg));
    border-left-width: 4px;
  }
  .error-icon {
    font-size: var(--font-size-lg);
    line-height: 1;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .error-card .error-icon {
    color: var(--clerk-block);
  }
  .error-card.warning .error-icon {
    color: var(--clerk-warn);
  }
  .error-body {
    flex: 1;
    min-width: 0;
  }
  .error-message {
    color: var(--clerk-text);
    font-weight: 500;
    line-height: 1.4;
  }
  .error-hint {
    color: var(--clerk-text-secondary);
    font-size: var(--font-size-xs);
    line-height: 1.4;
    margin-top: 2px;
  }
  .error-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
    align-self: center;
  }
  .error-retry {
    background: color-mix(in srgb, var(--clerk-accent) 15%, var(--clerk-bg));
    color: var(--clerk-accent);
    font-size: var(--font-size-xs);
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    font-weight: 500;
  }
  .error-retry:hover {
    background: color-mix(in srgb, var(--clerk-accent) 25%, var(--clerk-bg));
  }
  .error-dismiss {
    background: none;
    color: var(--clerk-text-muted);
    font-size: var(--font-size-xs);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
  }
  .error-dismiss:hover {
    color: var(--clerk-text);
  }
  .scroll-bottom {
    position: absolute;
    bottom: 70px;
    right: var(--sp-md);
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--clerk-surface);
    border: 1px solid var(--clerk-border);
    color: var(--clerk-text-muted);
    font-size: var(--font-size-md);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    z-index: 5;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    transition: background 0.15s, color 0.15s;
  }
  .scroll-bottom:hover {
    background: var(--clerk-surface-hover);
    color: var(--clerk-text);
  }
</style>

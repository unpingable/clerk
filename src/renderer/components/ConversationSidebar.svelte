<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Sidebar: conversation list, new chat, inline rename, delete. -->
<script lang="ts">
  import * as chat from '../stores/chat.svelte';

  let editingId = $state<string | null>(null);
  let editValue = $state('');
  let editInput: HTMLInputElement | undefined = $state();

  let deletePendingId = $state<string | null>(null);
  let deleteTimer: ReturnType<typeof setTimeout> | undefined;

  const list = $derived(chat.getConversationList());
  const activeId = $derived(chat.getConversationId());
  const streaming = $derived(chat.state.streaming);

  const sorted = $derived(
    [...list].sort((a, b) => b.updatedAt - a.updatedAt)
  );

  function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
    return new Date(ts).toLocaleDateString();
  }

  function handleNew() {
    if (streaming) return;
    chat.newConversation();
  }

  function handleSwitch(id: string) {
    if (streaming || id === activeId) return;
    chat.switchConversation(id);
  }

  function startRename(id: string, title: string) {
    if (streaming && id === activeId) return;
    editingId = id;
    editValue = title;
    // Focus on next tick
    setTimeout(() => editInput?.focus(), 0);
  }

  function commitRename() {
    if (editingId && editValue.trim()) {
      chat.renameConversation(editingId, editValue.trim());
    }
    editingId = null;
  }

  function cancelRename() {
    editingId = null;
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  }

  function handleDelete(id: string) {
    if (streaming && id === activeId) return;

    if (deletePendingId === id) {
      clearTimeout(deleteTimer);
      deletePendingId = null;
      chat.deleteConversation(id);
    } else {
      deletePendingId = id;
      deleteTimer = setTimeout(() => { deletePendingId = null; }, 2000);
    }
  }
</script>

<div class="sidebar">
  <button
    type="button"
    class="new-btn"
    disabled={streaming}
    onclick={handleNew}
  >+ New Chat</button>

  <div class="list">
    {#each sorted as conv (conv.id)}
      <div
        class="item"
        class:active={conv.id === activeId}
        data-conv-id={conv.id}
      >
        {#if editingId === conv.id}
          <input
            bind:this={editInput}
            bind:value={editValue}
            class="rename-input"
            type="text"
            spellcheck="false"
            onblur={commitRename}
            onkeydown={handleRenameKeydown}
          />
        {:else}
          <button
            type="button"
            class="item-main"
            disabled={streaming && conv.id !== activeId}
            onclick={() => handleSwitch(conv.id)}
            ondblclick={() => startRename(conv.id, conv.title)}
          >
            <span class="item-title">{conv.title || 'Untitled'}</span>
            <span class="item-time">{relativeTime(conv.updatedAt)}</span>
          </button>
        {/if}
        <button
          type="button"
          class="item-delete"
          class:confirm={deletePendingId === conv.id}
          disabled={streaming && conv.id === activeId}
          onclick={(e: MouseEvent) => { e.stopPropagation(); handleDelete(conv.id); }}
          title={deletePendingId === conv.id ? 'Click again to delete' : 'Delete'}
        >{deletePendingId === conv.id ? '!' : '\u00D7'}</button>
      </div>
    {/each}
  </div>
</div>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--clerk-bg-secondary);
    border-right: 1px solid var(--clerk-border);
  }
  .new-btn {
    margin: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--clerk-surface);
    color: var(--clerk-text);
    font-size: var(--font-size-sm);
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
  }
  .new-btn:hover:not(:disabled) {
    background: var(--clerk-accent);
    color: white;
  }
  .new-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .list {
    flex: 1;
    overflow-y: auto;
    padding: 0 var(--sp-xs);
  }
  .item {
    display: flex;
    align-items: stretch;
    border-radius: var(--radius-sm);
    margin-bottom: 1px;
  }
  .item.active {
    background: var(--clerk-surface);
    border-left: 2px solid var(--clerk-accent);
  }
  .item-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--sp-xs) var(--sp-sm);
    background: none;
    text-align: left;
    cursor: pointer;
    min-width: 0;
    border: none;
    color: var(--clerk-text);
  }
  .item-main:hover:not(:disabled) {
    background: var(--clerk-surface);
  }
  .item-main:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .item-title {
    font-size: var(--font-size-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .item-time {
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
  }
  .item-delete {
    align-self: center;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    color: var(--clerk-text-muted);
    font-size: var(--font-size-sm);
    cursor: pointer;
    border-radius: var(--radius-sm);
    opacity: 0;
    margin-right: var(--sp-xs);
  }
  .item:hover .item-delete,
  .item-delete.confirm {
    opacity: 1;
  }
  .item-delete:hover {
    color: var(--clerk-block);
    background: color-mix(in srgb, var(--clerk-block) 12%, transparent);
  }
  .item-delete.confirm {
    color: var(--clerk-block);
    font-weight: bold;
  }
  .item-delete:disabled {
    opacity: 0;
    cursor: default;
  }
  .rename-input {
    flex: 1;
    padding: var(--sp-xs) var(--sp-sm);
    background: var(--clerk-bg);
    color: var(--clerk-text);
    font-size: var(--font-size-sm);
    border: 1px solid var(--clerk-accent);
    border-radius: var(--radius-sm);
    outline: none;
    margin: 1px;
  }
</style>

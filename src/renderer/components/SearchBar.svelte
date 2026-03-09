<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- In-conversation search bar (Ctrl+F). Highlights matches, navigate with Enter/Shift+Enter. -->
<script lang="ts">
  import { tick } from 'svelte';

  interface Props {
    onClose: () => void;
    /** Current search query, bound to parent */
    query: string;
    matchCount: number;
    currentMatch: number;
    onNext: () => void;
    onPrev: () => void;
    onQueryChange: (q: string) => void;
  }

  let { onClose, query, matchCount, currentMatch, onNext, onPrev, onQueryChange }: Props = $props();

  let inputEl: HTMLInputElement | undefined = $state();

  $effect(() => {
    tick().then(() => inputEl?.focus());
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
      return;
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="search-bar" onkeydown={handleKeydown}>
  <input
    bind:this={inputEl}
    type="text"
    class="search-input"
    placeholder="Search messages..."
    value={query}
    oninput={(e) => onQueryChange((e.target as HTMLInputElement).value)}
    spellcheck="false"
    autocomplete="off"
  />
  <span class="search-count">
    {#if query && matchCount > 0}
      {currentMatch + 1} of {matchCount}
    {:else if query}
      No results
    {/if}
  </span>
  <button class="search-nav" title="Previous (Shift+Enter)" onclick={onPrev} disabled={matchCount === 0}>&#9650;</button>
  <button class="search-nav" title="Next (Enter)" onclick={onNext} disabled={matchCount === 0}>&#9660;</button>
  <button class="search-close" title="Close (Esc)" onclick={onClose}>&#10005;</button>
</div>

<style>
  .search-bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px var(--sp-md);
    background: var(--clerk-bg-secondary);
    border-bottom: 1px solid var(--clerk-border);
  }
  .search-input {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-sm);
    background: var(--clerk-bg);
    color: var(--clerk-text);
    font-size: var(--font-size-sm);
    font-family: var(--font-sans);
    outline: none;
    min-width: 0;
  }
  .search-input:focus {
    border-color: var(--clerk-accent);
  }
  .search-count {
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
    white-space: nowrap;
    min-width: 60px;
    text-align: center;
  }
  .search-nav {
    background: none;
    color: var(--clerk-text-muted);
    font-size: 10px;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    line-height: 1;
  }
  .search-nav:hover:not(:disabled) {
    color: var(--clerk-text);
    background: var(--clerk-surface);
  }
  .search-nav:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .search-close {
    background: none;
    color: var(--clerk-text-muted);
    font-size: var(--font-size-sm);
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    line-height: 1;
  }
  .search-close:hover {
    color: var(--clerk-text);
    background: var(--clerk-surface);
  }
</style>

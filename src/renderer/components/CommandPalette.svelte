<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Command palette: Cmd/Ctrl+P to search and execute actions. -->
<script lang="ts">
  import { tick } from 'svelte';
  import { buildCommands, filterCommands, groupCommands } from '../lib/commands';
  import type { CommandAction, CommandContext } from '../lib/commands';
  import * as chat from '../stores/chat.svelte';
  import * as tmpl from '../stores/template.svelte';
  import * as activity from '../stores/activity.svelte';
  import { settings, setFriendlyMode, setTheme } from '../stores/settings.svelte';
  import type { ActivityFilter } from '$shared/types';

  interface Props {
    detailsOpen: boolean;
  }
  let { detailsOpen }: Props = $props();

  let open = $state(false);
  let query = $state('');
  let selectedIndex = $state(0);
  let inputEl: HTMLInputElement | undefined = $state();

  const isMac = navigator.platform.includes('Mac');
  const modKeyLabel = isMac ? 'Cmd' as const : 'Ctrl' as const;

  const ctx = $derived<CommandContext>({
    streaming: chat.state.streaming,
    friendlyMode: settings.friendlyMode,
    theme: settings.theme,
    detailsOpen,
    appliedTemplateId: tmpl.getAppliedTemplateId(),
    modKeyLabel,
    templates: tmpl.getTemplates().map(t => ({ id: t.id, name: t.name })),
  });

  const commands = $derived(buildCommands(ctx));
  const filtered = $derived(filterCommands(commands, query));
  const grouped = $derived(groupCommands(filtered));
  const selectedCommand = $derived(filtered[selectedIndex]);

  // Reset selection when query changes
  $effect(() => {
    query;
    selectedIndex = 0;
  });

  // Scroll selected item into view
  $effect(() => {
    if (!open) return;
    const idx = selectedIndex;
    tick().then(() => {
      const el = document.querySelector(`[data-palette-index="${idx}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    });
  });

  // Listen for open event
  $effect(() => {
    function handleOpen() {
      open = true;
      query = '';
      selectedIndex = 0;
      tick().then(() => inputEl?.focus());
    }
    window.addEventListener('clerk:open-palette', handleOpen);
    return () => window.removeEventListener('clerk:open-palette', handleOpen);
  });

  function getFlatIndex(gi: number, ci: number): number {
    let idx = 0;
    for (let g = 0; g < gi; g++) idx += grouped[g].commands.length;
    return idx + ci;
  }

  function executeAction(action: CommandAction) {
    open = false;
    if (action.type === 'prefill') {
      window.dispatchEvent(new CustomEvent('clerk:prefill-input', { detail: { text: action.text } }));
      return;
    }
    const id = action.actionId;
    if (id === 'clear-chat') { chat.clearMessages(); return; }
    if (id === 'stop-streaming') { chat.stopStreaming(); return; }
    if (id === 'toggle-friendly') { setFriendlyMode(!settings.friendlyMode); return; }
    if (id === 'toggle-theme') { setTheme(settings.theme === 'dark' ? 'light' : 'dark'); return; }
    if (id === 'focus-chat') { window.dispatchEvent(new CustomEvent('clerk:focus-input')); return; }
    if (id === 'toggle-details') { window.dispatchEvent(new CustomEvent('clerk:toggle-details')); return; }
    if (id === 'change-backend') { window.dispatchEvent(new CustomEvent('clerk:change-backend')); return; }
    if (id.startsWith('request-template:')) { tmpl.requestTemplate(id.slice('request-template:'.length)); return; }
    if (id.startsWith('activity-filter:')) {
      window.dispatchEvent(new CustomEvent('clerk:open-details'));
      const filter = id.slice('activity-filter:'.length) as ActivityFilter;
      activity.setFilter(filter);
      return;
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      open = false;
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, filtered.length - 1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedCommand) executeAction(selectedCommand.action);
      return;
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) open = false;
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="backdrop" onmousedown={handleBackdropClick} onkeydown={handleKeydown}>
    <div class="palette">
      <input
        bind:this={inputEl}
        bind:value={query}
        class="search"
        type="text"
        placeholder="Type a command..."
        spellcheck="false"
        autocomplete="off"
      />
      <div class="results">
        {#if filtered.length === 0}
          <div class="empty">No matching commands — try 'files', 'activity', or 'edit'</div>
        {:else}
          {#each grouped as grp, gi}
            <div class="group-header">{grp.group}</div>
            {#each grp.commands as cmd, ci}
              {@const flatIdx = getFlatIndex(gi, ci)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="item"
                class:selected={flatIdx === selectedIndex}
                data-palette-index={flatIdx}
                onmouseenter={() => selectedIndex = flatIdx}
                onmousedown={(e: MouseEvent) => { e.preventDefault(); if (cmd.action) executeAction(cmd.action); }}
              >
                <div class="item-left">
                  <span class="item-label">{cmd.label}</span>
                  {#if cmd.description}
                    <span class="item-desc">{cmd.description}</span>
                  {/if}
                </div>
                {#if cmd.shortcut}
                  <span class="item-shortcut">{cmd.shortcut}</span>
                {/if}
              </div>
            {/each}
          {/each}
        {/if}
      </div>
      <div class="footer">↑↓ navigate  Enter select  Esc close</div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 1010;
    background: rgba(0, 0, 0, 0.4);
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 80px;
  }
  .palette {
    width: 500px;
    max-height: 400px;
    background: var(--clerk-bg-secondary);
    border: 1px solid var(--clerk-border-light);
    border-radius: var(--radius-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }
  .search {
    padding: 12px 16px;
    border: none;
    border-bottom: 1px solid var(--clerk-border);
    background: transparent;
    color: var(--clerk-text);
    font-size: var(--font-size-md);
    font-family: var(--font-sans);
    outline: none;
  }
  .search::placeholder {
    color: var(--clerk-text-muted);
  }
  .results {
    flex: 1;
    overflow-y: auto;
    padding: var(--sp-xs) 0;
  }
  .group-header {
    padding: var(--sp-sm) var(--sp-md) var(--sp-xs);
    font-size: var(--font-size-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--clerk-text-muted);
  }
  .item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-sm) var(--sp-md);
    cursor: pointer;
  }
  .item.selected {
    background: var(--clerk-surface);
  }
  .item-left {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .item-label {
    color: var(--clerk-text);
    font-size: var(--font-size-sm);
  }
  .item-desc {
    color: var(--clerk-text-muted);
    font-size: var(--font-size-xs);
  }
  .item-shortcut {
    color: var(--clerk-text-muted);
    font-size: var(--font-size-xs);
    font-family: var(--font-mono);
    flex-shrink: 0;
    margin-left: var(--sp-md);
  }
  .empty {
    padding: var(--sp-lg) var(--sp-md);
    color: var(--clerk-text-muted);
    font-size: var(--font-size-sm);
    text-align: center;
  }
  .footer {
    padding: var(--sp-sm) var(--sp-md);
    border-top: 1px solid var(--clerk-border);
    color: var(--clerk-text-muted);
    font-size: var(--font-size-xs);
    text-align: center;
  }
</style>

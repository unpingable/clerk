<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Inspector drawer — quiet activity log. -->
<script lang="ts">
  import ActivityEventRow from './ActivityEventRow.svelte';
  import * as activity from '../stores/activity.svelte';
  import { settings } from '../stores/settings.svelte';
  import type { ActivityFilter } from '$shared/types';

  const friendly = $derived(settings.friendlyMode);

  const filters = $derived<{ value: ActivityFilter; label: string }[]>([
    { value: 'all', label: 'All' },
    { value: 'blocked', label: friendly ? 'Stopped' : 'Blocked' },
    { value: 'writes', label: friendly ? 'Changes' : 'Writes' },
  ]);

  const filteredEvents = $derived(activity.getFilteredEvents());
  const currentFilter = $derived(activity.getFilter());
  const loading = $derived(activity.isLoading());
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">Details</span>
    <div class="filters">
      {#each filters as f}
        <button
          class="filter-btn"
          class:active={currentFilter === f.value}
          onclick={() => activity.setFilter(f.value)}
        >{f.label}</button>
      {/each}
    </div>
  </div>
  <div class="event-list">
    {#if loading}
      <div class="empty">Loading...</div>
    {:else if filteredEvents.length === 0}
      <div class="empty">No activity yet.</div>
    {:else}
      {#each filteredEvents as event (event.id)}
        <ActivityEventRow {event} />
      {/each}
    {/if}
  </div>
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--clerk-bg);
    border-left: 1px solid var(--clerk-border);
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    border-bottom: 1px solid var(--clerk-border);
  }
  .panel-title {
    font-size: var(--font-size-xs);
    font-weight: 500;
    color: var(--clerk-text-muted);
  }
  .filters {
    display: flex;
    gap: 1px;
  }
  .filter-btn {
    padding: 1px 6px;
    font-size: 10px;
    background: transparent;
    color: var(--clerk-text-muted);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .filter-btn:hover {
    color: var(--clerk-text-secondary);
  }
  .filter-btn.active {
    color: var(--clerk-text);
    background: var(--clerk-surface);
  }
  .event-list {
    flex: 1;
    overflow-y: auto;
  }
  .empty {
    padding: var(--sp-md) var(--sp-sm);
    color: var(--clerk-text-muted);
    font-size: var(--font-size-xs);
  }
</style>

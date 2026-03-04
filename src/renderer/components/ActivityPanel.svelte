<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Right panel showing the activity feed. -->
<script lang="ts">
  import ActivityEventRow from './ActivityEventRow.svelte';
  import * as activity from '../stores/activity.svelte';
  import type { ActivityFilter } from '$shared/types';

  const filters: { value: ActivityFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'blocked', label: 'Blocked' },
    { value: 'writes', label: 'Writes' },
  ];

  const filteredEvents = $derived(activity.getFilteredEvents());
  const currentFilter = $derived(activity.getFilter());
  const loading = $derived(activity.isLoading());
</script>

<div class="panel">
  <div class="panel-header">
    <span class="panel-title">Activity</span>
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
      <div class="empty">No activity yet</div>
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
    padding: var(--sp-sm);
    border-bottom: 1px solid var(--clerk-border);
    background: var(--clerk-bg-secondary);
  }
  .panel-title {
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--clerk-text);
  }
  .filters {
    display: flex;
    gap: 2px;
  }
  .filter-btn {
    padding: 2px 8px;
    font-size: 10px;
    background: transparent;
    color: var(--clerk-text-muted);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .filter-btn:hover {
    color: var(--clerk-text-secondary);
  }
  .filter-btn.active {
    background: var(--clerk-surface);
    color: var(--clerk-text);
    border-color: var(--clerk-border);
  }
  .event-list {
    flex: 1;
    overflow-y: auto;
  }
  .empty {
    padding: var(--sp-lg);
    text-align: center;
    color: var(--clerk-text-muted);
    font-size: var(--font-size-sm);
  }
</style>

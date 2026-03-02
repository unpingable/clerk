<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Backend/model selection dropdown. -->
<script lang="ts">
  import * as chat from '../stores/chat.svelte';

  const models = $derived(chat.getAvailableModels());
  const selected = $derived(chat.getSelectedModel());

  function onChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    chat.setModel(target.value);
  }
</script>

{#if models.length > 0}
  <select class="picker" value={selected} onchange={onChange}>
    {#each models as model}
      <option value={model.id}>
        {model.name || model.id}
      </option>
    {/each}
  </select>
{:else}
  <span class="no-models">No models</span>
{/if}

<style>
  .picker {
    background: var(--clerk-surface);
    color: var(--clerk-text);
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-sm);
    padding: 4px 8px;
    font-size: var(--font-size-xs);
    font-family: var(--font-sans);
    cursor: pointer;
  }
  .picker:focus {
    outline: 2px solid var(--clerk-accent);
    outline-offset: 1px;
  }
  .no-models {
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
    padding: 4px 8px;
  }
</style>

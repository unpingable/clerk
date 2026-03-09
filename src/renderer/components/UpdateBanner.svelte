<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Update banner — shows when a new version is available or downloaded. -->
<script lang="ts">
  import { update, downloadUpdate, installUpdate, dismissUpdate } from '../stores/update.svelte';

  const visible = $derived(
    update.state === 'available' ||
    update.state === 'downloading' ||
    update.state === 'downloaded',
  );
</script>

{#if visible}
  <div class="update-banner" data-update-state={update.state}>
    {#if update.state === 'available'}
      <span class="update-text">Clerk {update.version} is available.</span>
      <button class="update-action" onclick={downloadUpdate}>Download</button>
      <button class="update-dismiss" onclick={dismissUpdate}>&times;</button>
    {:else if update.state === 'downloading'}
      <span class="update-text">Downloading update... {update.percent}%</span>
      <div class="update-progress">
        <div class="update-progress-bar" style="width: {update.percent}%"></div>
      </div>
    {:else if update.state === 'downloaded'}
      <span class="update-text">Update ready. Restart to apply.</span>
      <button class="update-action" onclick={installUpdate}>Restart</button>
      <button class="update-dismiss" onclick={dismissUpdate}>&times;</button>
    {/if}
  </div>
{/if}

<style>
  .update-banner {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-md);
    background: color-mix(in srgb, var(--clerk-accent) 15%, var(--clerk-surface));
    border-bottom: 1px solid var(--clerk-border);
    font-size: var(--font-size-sm);
    color: var(--clerk-text);
  }
  .update-text {
    flex: 1;
  }
  .update-action {
    padding: 2px var(--sp-sm);
    background: var(--clerk-accent);
    color: white;
    font-size: var(--font-size-xs);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-weight: 500;
  }
  .update-action:hover {
    filter: brightness(1.1);
  }
  .update-dismiss {
    background: none;
    color: var(--clerk-text-muted);
    cursor: pointer;
    font-size: var(--font-size-sm);
    padding: 0 2px;
  }
  .update-dismiss:hover {
    color: var(--clerk-text);
  }
  .update-progress {
    width: 100px;
    height: 4px;
    background: var(--clerk-border);
    border-radius: 2px;
    overflow: hidden;
  }
  .update-progress-bar {
    height: 100%;
    background: var(--clerk-accent);
    transition: width 0.3s ease;
  }
</style>

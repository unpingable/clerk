<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Daemon connection status indicator with reconnect nudge. -->
<script lang="ts">
  import * as conn from '../stores/connection.svelte';
  import { settings } from '../stores/settings.svelte';

  const state = $derived(conn.getConnectionState());
  const friendly = $derived(settings.friendlyMode);
  const label = $derived(
    state === 'connected' ? 'Connected' :
    state === 'degraded' ? 'Degraded' : 'Disconnected'
  );
  const tooltipText = $derived(
    state === 'disconnected'
      ? (friendly ? 'Lost connection to Clerk engine. Click to reconnect.' : 'Governor daemon disconnected. Click to retry.')
      : (friendly ? `Clerk engine: ${label}` : `Governor daemon: ${label}`)
  );
  const color = $derived(
    state === 'connected' ? 'var(--clerk-pass)' :
    state === 'degraded' ? 'var(--clerk-warn)' : 'var(--clerk-block)'
  );

  let retrying = $state(false);

  async function handleClick() {
    if (state !== 'disconnected' || retrying) return;
    retrying = true;
    await conn.checkHealth();
    retrying = false;
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  class="badge"
  class:clickable={state === 'disconnected' && !retrying}
  style:--dot-color={color}
  title={tooltipText}
  onclick={handleClick}
  onkeydown={(e) => e.key === 'Enter' && handleClick()}
  role={state === 'disconnected' ? 'button' : undefined}
  tabindex={state === 'disconnected' ? 0 : undefined}
>
  <span class="dot" class:pulse={state === 'disconnected'}></span>
  {#if retrying}
    Reconnecting...
  {:else}
    {label}
  {/if}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
  }
  .badge.clickable {
    cursor: pointer;
    color: var(--clerk-block);
  }
  .badge.clickable:hover {
    background: color-mix(in srgb, var(--clerk-block) 10%, var(--clerk-bg));
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--dot-color);
  }
  .dot.pulse {
    animation: pulse 2s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>

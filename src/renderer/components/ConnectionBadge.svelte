<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Daemon connection status indicator. -->
<script lang="ts">
  import * as conn from '../stores/connection.svelte';

  const state = $derived(conn.getConnectionState());
  const label = $derived(
    state === 'connected' ? 'Connected' :
    state === 'degraded' ? 'Degraded' : 'Disconnected'
  );
  const color = $derived(
    state === 'connected' ? 'var(--clerk-pass)' :
    state === 'degraded' ? 'var(--clerk-warn)' : 'var(--clerk-block)'
  );
</script>

<span class="badge" style:--dot-color={color} title="Governor daemon: {label}">
  <span class="dot"></span>
  {label}
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
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--dot-color);
  }
</style>

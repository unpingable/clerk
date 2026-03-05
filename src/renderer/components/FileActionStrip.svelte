<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Inline file action indicator shown under chat messages. -->
<script lang="ts">
  import type { FileAction } from '$shared/types';
  import { settings } from '../stores/settings.svelte';
  import { friendlyTool, friendlyProfile, friendlyError } from '$lib/jargon';

  let { action }: { action: FileAction } = $props();

  const friendly = $derived(settings.friendlyMode);

  const statusClass = $derived(
    action.status === 'ask_pending' ? 'ask-pending'
    : action.status === 'ask_approved' ? 'ask-approved'
    : action.status === 'ask_denied' ? 'ask-denied'
    : action.allowed ? 'allowed'
    : 'blocked'
  );

  const statusIcon = $derived(
    action.status === 'ask_pending' ? '?'
    : action.status === 'ask_approved' ? '\u2713'
    : action.status === 'ask_denied' ? '\u2717'
    : action.allowed ? '\u2713'
    : '\u2717'
  );

  const toolInfo = $derived(friendlyTool(action.tool, friendly));
  const profileInfo = $derived(friendlyProfile(action.profile, friendly));
  const errorInfo = $derived(action.error ? friendlyError(action.error, friendly) : null);

  const pathDisplay = $derived(
    action.toPath ? `${action.path} \u2192 ${action.toPath}` : action.path
  );

  const label = $derived(
    errorInfo
      ? `${toolInfo.label} ${pathDisplay} -- ${errorInfo.label}`
      : action.summary
        ? `${toolInfo.label} ${pathDisplay} -- ${action.summary}`
        : `${toolInfo.label} ${pathDisplay}`
  );

  const labelTooltip = $derived(
    action.error
      ? `${toolInfo.tooltip} ${pathDisplay} -- ${action.error}`
      : action.summary
        ? `${toolInfo.tooltip} ${pathDisplay} -- ${action.summary}`
        : `${toolInfo.tooltip} ${pathDisplay}`
  );
</script>

<div class="strip">
  <span class="status {statusClass}">{statusIcon}</span>
  <span class="label" title={labelTooltip}>{label}</span>
  {#if action.profile}
    <span class="profile" title={profileInfo.tooltip}>[{profileInfo.label}]</span>
  {/if}
</div>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
  }
  .status {
    font-size: 10px;
    font-weight: 600;
  }
  .allowed { color: var(--clerk-pass); }
  .blocked { color: var(--clerk-block); }
  .ask-pending {
    color: var(--clerk-warn, #e8a838);
    animation: pulse 1.5s ease-in-out infinite;
  }
  .ask-approved { color: var(--clerk-pass); }
  .ask-denied { color: var(--clerk-text-muted); opacity: 0.6; }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .profile {
    opacity: 0.6;
    font-size: 10px;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
</style>

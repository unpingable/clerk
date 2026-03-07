<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Single row in the activity log — inspector style. -->
<script lang="ts">
  import type { ActivityEvent } from '$shared/types';
  import { settings } from '../stores/settings.svelte';
  import { friendlyError } from '$lib/jargon';

  let { event }: { event: ActivityEvent } = $props();

  const friendly = $derived(settings.friendlyMode);
  const statusClass = $derived(event.allowed ? 'allowed' : 'blocked');
  const timeStr = $derived(formatTime(event.ts));

  const metaParts = $derived(buildMeta());

  function buildMeta(): string {
    const parts: string[] = [];
    if (event.mode?.templateName) parts.push(event.mode.templateName);
    parts.push(timeStr);
    return parts.join(' \u00b7 ');
  }

  let showDetails = $state(false);

  function formatTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  }

  let copyLabel = $state('Copy');

  function copyDetails(): void {
    const payload = {
      schemaVersion: 1,
      id: event.id,
      ts: event.ts,
      kind: event.kind,
      toolId: event.toolId,
      path: event.path,
      allowed: event.allowed,
      decisionSource: event.decisionSource,
      reason: event.reason,
      errorCode: event.errorCode,
      mode: event.mode,
      correlationId: event.correlationId,
      streamId: event.streamId,
    };
    const text = JSON.stringify(payload, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      copyLabel = 'Copied';
      setTimeout(() => { copyLabel = 'Copy'; }, 1500);
    }).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      copyLabel = 'Copied';
      setTimeout(() => { copyLabel = 'Copy'; }, 1500);
    });
  }
</script>

<div class="row"
  data-kind={event.kind}
  data-status={event.status ?? (event.allowed ? 'allowed' : 'blocked')}
  data-error-code={event.errorCode ?? ''}>
  <div class="row-main" role="button" tabindex="0"
    onclick={() => showDetails = !showDetails}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') showDetails = !showDetails; }}>
    <span class="dot {statusClass}"></span>
    <span class="summary">{event.summary}</span>
  </div>
  <div class="meta">{metaParts}</div>
  {#if showDetails}
    <div class="details">
      {#if event.reason}
        <div class="detail-line"><span class="detail-label">Reason:</span> {event.reason}</div>
      {/if}
      {#if event.errorCode}
        {@const errInfo = friendlyError(event.errorCode, friendly)}
        <div class="detail-line" title={errInfo.tooltip}><span class="detail-label">Error:</span> {errInfo.label}</div>
      {/if}
      {#if !friendly && event.mode?.governorProfile}
        <div class="detail-line"><span class="detail-label">Profile:</span> {event.mode.governorProfile}</div>
      {/if}
      {#if event.correlationId && !friendly}
        <div class="detail-line"><span class="detail-label">Correlation:</span> {event.correlationId}</div>
      {/if}
      <button class="copy-btn" onclick={copyDetails}>{copyLabel}</button>
    </div>
  {/if}
</div>

<style>
  .row {
    padding: 6px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--clerk-border) 50%, transparent);
  }
  .row:hover {
    background: var(--clerk-bg-secondary);
  }
  .row-main {
    display: flex;
    align-items: baseline;
    gap: 6px;
    cursor: pointer;
    user-select: none;
  }
  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
    margin-top: 2px;
    align-self: flex-start;
  }
  .dot.allowed {
    background: var(--clerk-text-muted);
    opacity: 0.5;
  }
  .dot.blocked {
    background: var(--clerk-block);
  }
  .summary {
    flex: 1;
    font-size: var(--font-size-xs);
    color: var(--clerk-text-secondary);
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .meta {
    margin-left: 12px;
    margin-top: 1px;
    font-size: 10px;
    color: var(--clerk-text-muted);
    line-height: 1.2;
  }
  .details {
    margin-top: 4px;
    margin-left: 12px;
    padding-left: 8px;
    border-left: 1px solid var(--clerk-border);
    font-size: 10px;
    color: var(--clerk-text-muted);
  }
  .detail-line {
    padding: 1px 0;
    line-height: 1.4;
  }
  .detail-label {
    color: var(--clerk-text-muted);
  }
  .copy-btn {
    margin-top: 4px;
    padding: 1px 6px;
    font-size: 10px;
    background: none;
    color: var(--clerk-text-muted);
    border: none;
    cursor: pointer;
  }
  .copy-btn:hover {
    color: var(--clerk-text-secondary);
    text-decoration: underline;
  }
</style>

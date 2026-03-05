<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Single row in the activity feed. -->
<script lang="ts">
  import type { ActivityEvent } from '$shared/types';

  let { event }: { event: ActivityEvent } = $props();

  const statusClass = $derived(event.allowed ? 'allowed' : 'blocked');
  const statusIcon = $derived(event.allowed ? '\u2713' : '\u2717');
  const timeStr = $derived(formatTime(event.ts));

  let showDetails = $state(false);

  function formatTime(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  }

  let copyLabel = $state('Copy details');

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
      setTimeout(() => { copyLabel = 'Copy details'; }, 1500);
    }).catch(() => {
      // Fallback for restricted Electron contexts
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      copyLabel = 'Copied';
      setTimeout(() => { copyLabel = 'Copy details'; }, 1500);
    });
  }
</script>

<div class="row" class:blocked-row={!event.allowed}
  data-kind={event.kind}
  data-status={event.status ?? (event.allowed ? 'allowed' : 'blocked')}
  data-error-code={event.errorCode ?? ''}>
  <div class="row-main" role="button" tabindex="0"
    onclick={() => showDetails = !showDetails}
    onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') showDetails = !showDetails; }}>
    <span class="status {statusClass}">{statusIcon}</span>
    <span class="summary">{event.summary}</span>
    <span class="time">{timeStr}</span>
  </div>
  {#if showDetails}
    <div class="details">
      <div class="detail-line">Mode: {event.mode.templateName} ({event.mode.governorProfile})</div>
      {#if event.reason}
        <div class="detail-line">Reason: {event.reason}</div>
      {/if}
      {#if event.errorCode}
        <div class="detail-line">Error: {event.errorCode}</div>
      {/if}
      {#if event.correlationId}
        <div class="detail-line">Correlation: {event.correlationId}</div>
      {/if}
      <button class="copy-btn" onclick={copyDetails}>{copyLabel}</button>
    </div>
  {/if}
</div>

<style>
  .row {
    border-bottom: 1px solid var(--clerk-border);
    padding: var(--sp-xs) var(--sp-sm);
  }
  .blocked-row {
    background: rgba(255, 107, 107, 0.05);
  }
  .row-main {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    user-select: none;
  }
  .status {
    font-size: 10px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .allowed { color: var(--clerk-pass); }
  .blocked { color: var(--clerk-block); }
  .summary {
    flex: 1;
    font-size: var(--font-size-xs);
    color: var(--clerk-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .time {
    font-size: 10px;
    color: var(--clerk-text-muted);
    flex-shrink: 0;
    font-family: var(--font-mono);
  }
  .details {
    padding: var(--sp-xs) var(--sp-sm) var(--sp-xs) 20px;
    font-size: 10px;
    color: var(--clerk-text-muted);
  }
  .detail-line {
    padding: 1px 0;
    font-family: var(--font-mono);
  }
  .copy-btn {
    margin-top: var(--sp-xs);
    padding: 2px 8px;
    font-size: 10px;
    background: var(--clerk-surface);
    color: var(--clerk-text-secondary);
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .copy-btn:hover {
    background: var(--clerk-surface-hover);
  }
</style>

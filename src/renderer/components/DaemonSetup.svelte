<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- First-run screen shown when the governor daemon can't be found. -->
<script lang="ts">
  import type { DaemonStatusErr } from '$shared/types';
  import { settings } from '../stores/settings.svelte';

  let { status }: { status: DaemonStatusErr } = $props();

  const friendly = $derived(settings.friendlyMode);
  const heading = $derived(friendly ? 'Clerk needs its engine' : 'Clerk needs Governor');

  const advice = $derived(
    status.reason === 'NOT_FOUND'
      ? 'Clerk needs the Governor engine to run. Install it and restart Clerk.'
      : status.reason === 'NOT_EXECUTABLE'
        ? 'Found Governor, but it isn\'t executable. Check file permissions.'
        : status.reason === 'BAD_BINARY'
          ? 'Found Governor, but it didn\'t respond correctly. It may need updating.'
          : 'Clerk couldn\'t start its engine.'
  );
</script>

<div class="setup">
  <div class="card">
    <h1>{heading}</h1>
    <p class="explanation">{advice}</p>

    <div class="detail">
      <span class="label">Reason:</span>
      <code>{status.reason}</code>
    </div>

    {#if status.detail}
      <div class="detail">
        <span class="label">Detail:</span>
        <code>{status.detail}</code>
      </div>
    {/if}

    {#if status.tried.length > 0}
      <div class="tried">
        <span class="label">Searched:</span>
        <ul>
          {#each status.tried as attempt}
            <li><code>{attempt}</code></li>
          {/each}
        </ul>
      </div>
    {/if}

    <div class="install-options">
      <h2>Install Governor</h2>

      <div class="option">
        <h3>With uv (recommended)</h3>
        <pre><code>uv tool install agent-governor</code></pre>
      </div>

      <div class="option">
        <h3>With pipx</h3>
        <pre><code>pipx install agent-governor</code></pre>
      </div>

      <div class="option">
        <h3>With pip</h3>
        <pre><code>pip install agent-governor</code></pre>
      </div>

      <p class="hint">
        After installing, restart Clerk.
      </p>
    </div>
  </div>
</div>

<style>
  .setup {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: var(--sp-xl);
  }
  .card {
    max-width: 560px;
    background: var(--clerk-bg-secondary);
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-lg);
    padding: var(--sp-xl);
  }
  h1 {
    font-size: var(--font-size-xl);
    color: var(--clerk-text);
    margin-bottom: var(--sp-sm);
  }
  .explanation {
    color: var(--clerk-text-secondary);
    line-height: 1.6;
    margin-bottom: var(--sp-lg);
  }
  .detail, .tried {
    margin-bottom: var(--sp-sm);
  }
  .label {
    font-size: var(--font-size-sm);
    color: var(--clerk-text-muted);
    margin-right: var(--sp-xs);
  }
  code {
    background: var(--clerk-bg);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-size: var(--font-size-sm);
    color: var(--clerk-text-secondary);
  }
  .tried ul {
    list-style: none;
    padding: 0;
    margin-top: 4px;
  }
  .tried li {
    padding: 2px 0;
  }
  .install-options {
    margin-top: var(--sp-lg);
    padding-top: var(--sp-lg);
    border-top: 1px solid var(--clerk-border);
  }
  h2 {
    font-size: var(--font-size-lg);
    color: var(--clerk-text);
    margin-bottom: var(--sp-md);
  }
  .option {
    margin-bottom: var(--sp-md);
  }
  .option h3 {
    font-size: var(--font-size-sm);
    color: var(--clerk-text-secondary);
    margin-bottom: 4px;
  }
  .option pre {
    background: var(--clerk-bg);
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-md);
    padding: var(--sp-sm) var(--sp-md);
    overflow-x: auto;
  }
  .option pre code {
    background: none;
    padding: 0;
    font-size: var(--font-size-md);
    color: var(--clerk-accent);
  }
  .hint {
    font-size: var(--font-size-sm);
    color: var(--clerk-text-muted);
    line-height: 1.5;
    margin-top: var(--sp-sm);
  }
</style>

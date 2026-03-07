<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- First-run setup wizard: choose AI backend, enter credentials, connect. -->
<script lang="ts">
  import type { BackendStatus, BackendType, BackendConfig } from '$shared/types';
  import { api } from '$lib/api';

  let { status, onConfigured }: { status: BackendStatus; onConfigured: () => void } = $props();

  const isRepair = $derived(status.state === 'unreachable' || status.state === 'no_models');

  let selectedType = $state<BackendType>(status.existingConfig?.type ?? status.type ?? 'anthropic');
  let apiKey = $state('');
  let ollamaUrl = $state(status.existingConfig?.ollamaUrl ?? 'http://localhost:11434');
  let connecting = $state(false);
  let error = $state<string | null>(null);
  let showKey = $state(false);

  const canConnect = $derived(
    !connecting && (selectedType !== 'anthropic' || apiKey.trim().length > 0)
  );

  const backends: Array<{ type: BackendType; label: string; desc: string }> = [
    { type: 'anthropic', label: 'Anthropic (Claude)', desc: 'Cloud-based. Requires an API key.' },
    { type: 'ollama', label: 'Ollama (local)', desc: 'Runs on your machine.' },
    { type: 'claude-code', label: 'Claude Code (CLI)', desc: 'Uses the claude command in your PATH.' },
    { type: 'codex', label: 'Codex (CLI)', desc: 'Uses the codex command in your PATH.' },
  ];

  async function handleConnect() {
    if (!canConnect) return;
    connecting = true;
    error = null;

    const config: BackendConfig = { type: selectedType };
    if (selectedType === 'anthropic') config.apiKey = apiKey.trim();
    if (selectedType === 'ollama' && ollamaUrl.trim()) config.ollamaUrl = ollamaUrl.trim();

    try {
      const result = await api.backendConfigure(config);
      if (result.ok) {
        onConfigured();
      } else {
        error = result.error.message;
      }
    } catch (err) {
      error = String(err);
    } finally {
      connecting = false;
    }
  }
</script>

<div class="setup">
  <div class="card">
    <h1>{isRepair ? 'Fix AI backend connection' : 'Choose an AI backend'}</h1>
    <p class="subtitle">
      {#if isRepair && status.state === 'unreachable'}
        Clerk couldn't reach the current backend.
      {:else if isRepair && status.state === 'no_models'}
        Clerk connected, but no models were available.
      {:else}
        Pick how Clerk should connect. You can change this later.
      {/if}
    </p>

    <div class="options">
      {#each backends as b}
        <label class="radio-row" class:selected={selectedType === b.type}>
          <input
            type="radio"
            name="backend"
            value={b.type}
            bind:group={selectedType}
            data-wizard-type={b.type}
          />
          <div class="radio-content">
            <span class="radio-label">{b.label}</span>
            <span class="radio-desc">{b.desc}</span>
          </div>
        </label>
      {/each}
    </div>

    {#if selectedType === 'anthropic'}
      <div class="field">
        <label class="field-label" for="api-key">API key</label>
        <div class="key-row">
          {#if showKey}
            <input
              id="api-key"
              type="text"
              bind:value={apiKey}
              placeholder="sk-ant-..."
              class="field-input"
              autocomplete="off"
              spellcheck="false"
            />
          {:else}
            <input
              id="api-key"
              type="password"
              bind:value={apiKey}
              placeholder="sk-ant-..."
              class="field-input"
              autocomplete="off"
            />
          {/if}
          <button
            class="toggle-key"
            onclick={() => showKey = !showKey}
            title={showKey ? 'Hide key' : 'Show key'}
            type="button"
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
        <p class="field-hint">Get one from the Anthropic console.</p>
      </div>
    {/if}

    {#if selectedType === 'ollama'}
      <div class="field">
        <label class="field-label" for="ollama-url">Server</label>
        <input
          id="ollama-url"
          type="text"
          bind:value={ollamaUrl}
          placeholder="http://localhost:11434"
          class="field-input"
          autocomplete="off"
          spellcheck="false"
        />
        <p class="field-hint">Make sure Ollama is running.</p>
      </div>
    {/if}

    <div class="actions">
      <button
        class="connect-btn"
        onclick={handleConnect}
        disabled={!canConnect}
        data-wizard-connect
      >
        {connecting ? 'Connecting...' : 'Connect'}
      </button>
    </div>

    {#if error}
      <div class="error" data-wizard-error>{error}</div>
    {/if}
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
    max-width: 480px;
    width: 100%;
    background: var(--clerk-bg-secondary);
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-lg);
    padding: var(--sp-xl);
  }
  h1 {
    font-size: var(--font-size-xl);
    color: var(--clerk-text);
    margin-bottom: var(--sp-xs);
  }
  .subtitle {
    color: var(--clerk-text-secondary);
    line-height: 1.5;
    margin-bottom: var(--sp-lg);
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: var(--sp-xs);
    margin-bottom: var(--sp-lg);
  }
  .radio-row {
    display: flex;
    align-items: flex-start;
    gap: var(--sp-sm);
    padding: var(--sp-sm) var(--sp-md);
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .radio-row:hover {
    border-color: var(--clerk-text-muted);
  }
  .radio-row.selected {
    border-color: var(--clerk-accent);
    background: var(--clerk-surface, rgba(255, 255, 255, 0.03));
  }
  .radio-row input[type="radio"] {
    margin-top: 3px;
    accent-color: var(--clerk-accent);
  }
  .radio-content {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .radio-label {
    color: var(--clerk-text);
    font-size: var(--font-size-md);
    font-weight: 500;
  }
  .radio-desc {
    color: var(--clerk-text-muted);
    font-size: var(--font-size-sm);
  }
  .field {
    margin-bottom: var(--sp-lg);
  }
  .field-label {
    display: block;
    color: var(--clerk-text-secondary);
    font-size: var(--font-size-sm);
    font-weight: 500;
    margin-bottom: var(--sp-xs);
  }
  .key-row {
    display: flex;
    gap: var(--sp-xs);
  }
  .field-input {
    flex: 1;
    padding: 8px 12px;
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-md);
    background: var(--clerk-bg);
    color: var(--clerk-text);
    font-family: var(--font-mono);
    font-size: var(--font-size-sm);
  }
  .field-input:focus {
    outline: none;
    border-color: var(--clerk-accent);
  }
  .toggle-key {
    padding: 8px 12px;
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-md);
    background: var(--clerk-bg);
    color: var(--clerk-text-muted);
    font-size: var(--font-size-sm);
    cursor: pointer;
    white-space: nowrap;
  }
  .toggle-key:hover {
    color: var(--clerk-text);
  }
  .field-hint {
    color: var(--clerk-text-muted);
    font-size: var(--font-size-xs);
    margin-top: var(--sp-xs);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--sp-md);
  }
  .connect-btn {
    padding: 10px 28px;
    background: var(--clerk-accent);
    color: white;
    border-radius: var(--radius-md);
    font-size: var(--font-size-md);
    font-weight: 500;
  }
  .connect-btn:hover:not(:disabled) {
    background: var(--clerk-accent-hover);
  }
  .connect-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .error {
    margin-top: var(--sp-md);
    padding: var(--sp-sm) var(--sp-md);
    background: rgba(224, 82, 82, 0.1);
    border: 1px solid rgba(224, 82, 82, 0.3);
    border-radius: var(--radius-md);
    color: var(--clerk-block, #e05252);
    font-size: var(--font-size-sm);
  }
</style>

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Gear icon with dropdown for settings (always visible). -->
<script lang="ts">
  import { settings, setFriendlyMode } from '../stores/settings.svelte';

  let open = $state(false);

  function toggle() {
    open = !open;
  }

  function handleClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.settings-wrap')) {
      open = false;
    }
  }

  function handleCheckbox(e: Event) {
    e.stopPropagation();
    const checked = (e.target as HTMLInputElement).checked;
    setFriendlyMode(checked);
  }
</script>

<svelte:window onclick={open ? handleClickOutside : undefined} />

<div class="settings-wrap">
  <button class="gear-btn" onclick={toggle} title="Settings" aria-label="Settings">
    &#9881;
  </button>
  {#if open}
    <div class="dropdown" role="menu" tabindex="-1" onkeydown={(e) => { if (e.key === 'Escape') open = false; }} onclick={(e) => e.stopPropagation()}>
      <label class="setting-row">
        <input
          type="checkbox"
          checked={settings.friendlyMode}
          onchange={handleCheckbox}
        />
        <span>Simple language</span>
      </label>
    </div>
  {/if}
</div>

<style>
  .settings-wrap {
    position: relative;
  }
  .gear-btn {
    background: none;
    border: none;
    font-size: 18px;
    color: var(--clerk-text-muted);
    cursor: pointer;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    line-height: 1;
  }
  .gear-btn:hover {
    color: var(--clerk-text);
    background: var(--clerk-surface);
  }
  .dropdown {
    position: absolute;
    right: 0;
    top: 100%;
    margin-top: 4px;
    background: var(--clerk-bg-secondary);
    border: 1px solid var(--clerk-border);
    border-radius: var(--radius-md);
    padding: var(--sp-sm) var(--sp-md);
    min-width: 180px;
    z-index: 100;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  .setting-row {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    font-size: var(--font-size-sm);
    color: var(--clerk-text);
    cursor: pointer;
    white-space: nowrap;
  }
  .setting-row input {
    cursor: pointer;
  }
</style>

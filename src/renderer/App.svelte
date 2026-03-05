<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Clerk app shell: header + main area. Day 1 is chat-only. -->
<script lang="ts">
  import Chat from './views/Chat.svelte';
  import ConnectionBadge from './components/ConnectionBadge.svelte';
  import ModelPicker from './components/ModelPicker.svelte';
  import TemplatePicker from './components/TemplatePicker.svelte';
  import DaemonSetup from './components/DaemonSetup.svelte';
  import ActivityPanel from './components/ActivityPanel.svelte';
  import SettingsGear from './components/SettingsGear.svelte';
  import * as conn from './stores/connection.svelte';
  import * as chat from './stores/chat.svelte';
  import * as tmpl from './stores/template.svelte';
  import * as activity from './stores/activity.svelte';
  import { loadSettings } from './stores/settings.svelte';
  import { api } from '$lib/api';
  import type { DaemonStatus, DaemonStatusErr } from '$shared/types';

  let daemonStatus = $state<DaemonStatus | null>(null);
  let loading = $state(true);

  const daemonOk = $derived(daemonStatus?.ok === true);

  // --- Keyboard shortcuts ---

  let clearPending = $state(false);
  let clearTimer: ReturnType<typeof setTimeout> | undefined;

  function handleGlobalKeydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    const target = e.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

    // Cmd/Ctrl+K: focus chat input (always active)
    if (mod && e.key === 'k') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('clerk:focus-input'));
      return;
    }

    // Ignore other shortcuts when in input fields
    if (isInput) return;

    // Cmd/Ctrl+Shift+Backspace: clear chat (press-twice guard)
    if (mod && e.shiftKey && e.key === 'Backspace') {
      e.preventDefault();
      if (clearPending) {
        clearTimeout(clearTimer);
        clearPending = false;
        chat.clearMessages();
      } else {
        clearPending = true;
        clearTimer = setTimeout(() => { clearPending = false; }, 2000);
      }
      return;
    }
  }

  // Check daemon status, then wire up if ok
  $effect(() => {
    loadSettings();
    api.daemonStatus().then((status) => {
      daemonStatus = status;
      loading = false;

      if (status.ok) {
        api.onChatDelta(chat.onDelta);
        api.onChatEnd(chat.onEnd);
        api.onFileAction(chat.onFileAction);
        api.onAskRequest(chat.onAskRequest);
        api.onActivityEvent(activity.onEvent);
        api.onConnectionState((state) => {
          conn.setConnectionState(state as 'connected' | 'degraded' | 'disconnected');
        });
        conn.startPolling(3000);
        chat.loadModels();
        tmpl.initialize();
        activity.loadEvents();
      }
    }).catch(() => {
      loading = false;
    });

    return () => {
      conn.stopPolling();
      api.offChatDelta();
      api.offChatEnd();
      api.offFileAction();
      api.offAskRequest();
      api.offActivityEvent();
      api.offConnectionState();
    };
  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="app">
  <header class="header">
    <h1 class="title">Clerk</h1>
    <div class="controls">
      {#if daemonOk}
        <TemplatePicker />
        <ModelPicker />
        <ConnectionBadge />
      {/if}
      <SettingsGear />
    </div>
  </header>
  <main class="main">
    {#if loading}
      <div class="loading">Starting up...</div>
    {:else if daemonOk}
      <div class="split">
        <div class="split-chat"><Chat /></div>
        <div class="split-activity"><ActivityPanel /></div>
      </div>
    {:else if daemonStatus}
      <DaemonSetup status={daemonStatus as DaemonStatusErr} />
    {/if}
  </main>
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-sm) var(--sp-md);
    border-bottom: 1px solid var(--clerk-border);
    background: var(--clerk-bg-secondary);
    -webkit-app-region: drag;
  }
  .title {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--clerk-text);
    -webkit-app-region: drag;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    -webkit-app-region: no-drag;
  }
  .main {
    flex: 1;
    overflow: hidden;
  }
  .split {
    display: flex;
    height: 100%;
  }
  .split-chat {
    flex: 65;
    overflow: hidden;
  }
  .split-activity {
    flex: 35;
    overflow: hidden;
  }
  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--clerk-text-muted);
    font-size: var(--font-size-lg);
  }
</style>

<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Clerk app shell: header + status bar + collapsible details drawer. -->
<script lang="ts">
  import Chat from './views/Chat.svelte';
  import ConnectionBadge from './components/ConnectionBadge.svelte';
  import ModelPicker from './components/ModelPicker.svelte';
  import TemplatePicker from './components/TemplatePicker.svelte';
  import DaemonSetup from './components/DaemonSetup.svelte';
  import SetupWizard from './components/SetupWizard.svelte';
  import ActivityPanel from './components/ActivityPanel.svelte';
  import SettingsGear from './components/SettingsGear.svelte';
  import CommandPalette from './components/CommandPalette.svelte';
  import ConversationSidebar from './components/ConversationSidebar.svelte';
  import * as conn from './stores/connection.svelte';
  import * as chat from './stores/chat.svelte';
  import * as tmpl from './stores/template.svelte';
  import * as activity from './stores/activity.svelte';
  import * as caps from './stores/capabilities.svelte';
  import { loadSettings } from './stores/settings.svelte';
  import { api } from '$lib/api';
  import { exportConversation } from '$lib/export';
  import type { DaemonStatus, DaemonStatusErr, BackendStatus } from '$shared/types';

  let daemonStatus = $state<DaemonStatus | null>(null);
  let loading = $state(true);
  let backendNeeded = $state(false);
  let backendStatus = $state<BackendStatus | null>(null);
  let detailsOpen = $state(false);

  // Sidebar state (session-only)
  let sidebarUserToggled = $state<boolean | null>(null);
  const canShowSidebar = $derived(chat.getConversationList().length >= 2);
  const sidebarVisible = $derived(canShowSidebar && (sidebarUserToggled ?? true));

  // Reset toggle when count drops below 2
  $effect(() => {
    if (!canShowSidebar) sidebarUserToggled = null;
  });

  const daemonOk = $derived(daemonStatus?.ok === true);
  const blockedCount = $derived(activity.getBlockedCount());

  // --- Keyboard shortcuts ---

  let clearPending = $state(false);
  let clearTimer: ReturnType<typeof setTimeout> | undefined;

  function handleGlobalKeydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    const target = e.target as HTMLElement;
    const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

    // Cmd/Ctrl+P: open command palette
    if (mod && e.key === 'p') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('clerk:open-palette'));
      return;
    }

    // Cmd/Ctrl+K: focus chat input (always active)
    if (mod && e.key === 'k') {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('clerk:focus-input'));
      return;
    }

    // Cmd/Ctrl+N: new conversation
    if (mod && e.key === 'n') {
      e.preventDefault();
      if (!chat.state.streaming) chat.newConversation();
      return;
    }

    // Cmd/Ctrl+B: toggle sidebar (only when 2+ conversations)
    if (mod && e.key === 'b') {
      e.preventDefault();
      if (canShowSidebar) {
        sidebarUserToggled = sidebarUserToggled === null ? false : !sidebarUserToggled;
      }
      return;
    }

    // Cmd/Ctrl+Shift+E: export conversation
    if (mod && e.shiftKey && e.key === 'E') {
      e.preventDefault();
      if (!chat.state.streaming) {
        const title = chat.getConversationTitle() || 'Conversation';
        const messages = chat.getMessages();
        exportConversation(title, messages);
      }
      return;
    }

    // Ignore other shortcuts when in input fields
    if (isInput) return;

    // Cmd/Ctrl+D: toggle details panel
    if (mod && e.key === 'd') {
      e.preventDefault();
      detailsOpen = !detailsOpen;
      return;
    }

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

  function openDetailsBlocked() {
    detailsOpen = true;
    activity.setFilter('blocked');
  }

  async function loadBackendReadyState() {
    caps.loadCapabilities();
    chat.loadModels();
    tmpl.initialize();
    activity.loadEvents();
    await chat.loadConversationList();
    await chat.restoreActiveConversation();
  }

  function onBackendConfigured() {
    backendNeeded = false;
    loadBackendReadyState();
  }

  // Check daemon status, then wire up if ok
  $effect(() => {
    loadSettings();

    function handleChangeBackend() {
      if (!daemonOk) return;
      api.backendStatus().then((bs) => {
        backendStatus = bs;
        backendNeeded = true;
      });
    }

    function handleToggleDetails() { detailsOpen = !detailsOpen; }
    function handleOpenDetails() { detailsOpen = true; }
    function handleToggleSidebar() {
      if (canShowSidebar) {
        sidebarUserToggled = sidebarUserToggled === null ? false : !sidebarUserToggled;
      }
    }
    function handleExportConversation() {
      const title = chat.getConversationTitle() || 'Conversation';
      const messages = chat.getMessages();
      exportConversation(title, messages);
    }

    window.addEventListener('clerk:change-backend', handleChangeBackend);
    window.addEventListener('clerk:toggle-details', handleToggleDetails);
    window.addEventListener('clerk:open-details', handleOpenDetails);
    window.addEventListener('clerk:toggle-sidebar', handleToggleSidebar);
    window.addEventListener('clerk:export-conversation', handleExportConversation);

    api.daemonStatus().then(async (status) => {
      daemonStatus = status;

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

        // Probe backend before revealing UI
        const bs = await api.backendStatus();
        backendStatus = bs;
        if (bs.state !== 'ready') {
          backendNeeded = true;
        } else {
          await loadBackendReadyState();
        }
      }

      loading = false;
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
      window.removeEventListener('clerk:change-backend', handleChangeBackend);
      window.removeEventListener('clerk:toggle-details', handleToggleDetails);
      window.removeEventListener('clerk:open-details', handleOpenDetails);
      window.removeEventListener('clerk:toggle-sidebar', handleToggleSidebar);
      window.removeEventListener('clerk:export-conversation', handleExportConversation);
    };
  });
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="app">
  <header class="header">
    <h1 class="title">Clerk</h1>
    <div class="controls">
      {#if daemonOk && !backendNeeded}
        <ModelPicker />
      {/if}
      <SettingsGear />
    </div>
  </header>
  <main class="main">
    {#if loading}
      <div class="loading">Starting up...</div>
    {:else if !daemonOk}
      {#if daemonStatus}
        <DaemonSetup status={daemonStatus as DaemonStatusErr} />
      {/if}
    {:else if backendNeeded && backendStatus}
      <SetupWizard status={backendStatus} onConfigured={onBackendConfigured} />
    {:else if daemonOk}
      <div class="workspace">
        {#if sidebarVisible}
          <div class="workspace-sidebar" data-testid="sidebar"><ConversationSidebar /></div>
        {/if}
        <div class="workspace-chat"><Chat /></div>
        {#if detailsOpen}
          <div class="workspace-details"><ActivityPanel /></div>
        {/if}
      </div>
    {/if}
  </main>
  {#if daemonOk && !backendNeeded && !loading}
    <div class="status-bar">
      {#if caps.getCapabilities().templateCompilation}
        <TemplatePicker />
        <span class="status-sep">&middot;</span>
      {/if}
      <ConnectionBadge />
      {#if blockedCount > 0}
        <span class="status-sep">&middot;</span>
        <button type="button" class="status-blocked" onclick={openDetailsBlocked}>
          {blockedCount} blocked
        </button>
      {/if}
      <button type="button" class="details-toggle" onclick={() => detailsOpen = !detailsOpen}>
        {detailsOpen ? 'Details \u25C2' : 'Details \u25B8'}
      </button>
    </div>
  {/if}
  <CommandPalette {detailsOpen} conversationCount={chat.getConversationList().length} {sidebarVisible} />
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
    min-height: 0;
  }
  .workspace {
    display: flex;
    height: 100%;
    min-height: 0;
  }
  .workspace-sidebar {
    width: 220px;
    flex-shrink: 0;
    overflow: hidden;
  }
  .workspace-chat {
    flex: 1;
    overflow: hidden;
    min-height: 0;
  }
  .workspace-details {
    width: 320px;
    flex-shrink: 0;
    overflow: hidden;
  }
  .status-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-sm);
    padding: var(--sp-xs) var(--sp-md);
    border-top: 1px solid var(--clerk-border);
    background: var(--clerk-bg-secondary);
    font-size: var(--font-size-xs);
    color: var(--clerk-text-muted);
    -webkit-app-region: no-drag;
  }
  .status-sep { opacity: 0.4; }
  .status-blocked {
    background: none;
    color: var(--clerk-block);
    font-size: var(--font-size-xs);
    padding: 0;
    cursor: pointer;
  }
  .status-blocked:hover { text-decoration: underline; }
  .status-blocked:focus-visible {
    outline: 2px solid var(--clerk-block);
    outline-offset: 2px;
  }
  .details-toggle {
    margin-left: auto;
    background: none;
    color: var(--clerk-text-muted);
    font-size: var(--font-size-xs);
    padding: 2px 8px;
    border-radius: var(--radius-sm);
  }
  .details-toggle:hover {
    color: var(--clerk-text);
    background: var(--clerk-surface);
  }
  .details-toggle:focus-visible {
    outline: 2px solid var(--clerk-accent);
    outline-offset: 2px;
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

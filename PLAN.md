# Clerk — A Desktop Assistant That Keeps Receipts

## One sentence

Clerk is a governed desktop agent for non-developers: it manages files,
runs tasks, and chats — and every action it takes is evidence-gated,
receipted, and auditable.

---

## Why This Exists

Anthropic shipped Cowork: a desktop agent that automates files and tasks
for non-technical users. The pitch is "trust the AI, it's helpful." There
is no enforcement layer, no audit trail, no proof of what it did or why.

We already built the enforcement layer (Agent Governor: 14,000+ tests,
60+ modules, receipt kernel, regime detection). We already built the
Electron shell (Guvnah: Svelte 5, daemon spawn, 34 RPC channels). We
already built the chat + generation pipeline (gov-webui: OpenAI-compatible
API, streaming, violation resolution, artifact store).

Clerk combines them: **Cowork's UX ambition + Governor's enforcement
guarantees.** The agent proposes, Governor decides admissibility, receipts
chain everything, and the user gets proof instead of trust.

The tagline: *"It runs over a governor."*

---

## What Clerk Is

- A **desktop app** (Electron, cross-platform)
- A **chat interface** where you ask the agent to do things
- A **file manager** where the agent organizes, creates, and edits files
- A **task tracker** where you see what the agent did, is doing, and plans to do
- A **receipt viewer** where every action has a hash-chained audit trail

## What Clerk Is Not

- Not a developer tool (that's Maude, Guvnah, VS Code extension)
- Not a web app (that's gov-webui / Phosphor)
- Not advisory — the governor gates, it doesn't suggest
- Not a second brain — it does work, not memorization
- Not ungoverable — every mutation flows through the daemon

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  Clerk (Electron + Svelte 5)                        │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
│  │ Chat     │  │ Files    │  │ Activity Feed    │  │
│  │ Panel    │  │ Panel    │  │ (receipts, tasks)│  │
│  └────┬─────┘  └────┬─────┘  └───────┬──────────┘  │
│       │              │                │              │
│       └──────────────┼────────────────┘              │
│                      │ IPC (contextBridge)           │
├──────────────────────┼──────────────────────────────┤
│  Main Process        │                               │
│  ┌───────────────────▼──────────────────────┐       │
│  │ RPC Client (JSON-RPC 2.0, stdio)        │       │
│  │ + File Operations (fs, with receipts)    │       │
│  │ + Shell Operations (child_process, gated)│       │
│  └───────────────────┬──────────────────────┘       │
│                      │ stdin/stdout                  │
│              ┌───────▼───────┐                       │
│              │ governor      │                       │
│              │ serve --stdio │                       │
│              │ (child proc)  │                       │
│              └───────────────┘                       │
└─────────────────────────────────────────────────────┘
```

### Key decisions

1. **Fork from Guvnah, not gov-webui.** Guvnah has the right foundation:
   Electron lifecycle, daemon spawn via stdio, Content-Length framing,
   contextBridge security boundary, Svelte 5 renderer. Gov-webui is a web
   app with direct Python imports — wrong substrate for desktop.

2. **Wire chat.* RPCs.** Guvnah intentionally omits them ("observes,
   doesn't generate"). Clerk's entire point is generation. Wire 3 methods:
   `chat.send`, `chat.stream`, `chat.models`.

3. **Add file operations in main process.** The daemon doesn't do file IO
   for the user. Clerk's main process handles `fs` operations (read, write,
   move, delete) but **every mutation goes through a gate receipt** before
   touching disk. The main process is the executor; the daemon is the
   authority.

4. **Artifact store lives locally.** Port gov-webui's `ArtifactStore`
   concept (file-backed, versioned, content-hashed) to TypeScript in
   Clerk's main process. Artifacts are what the agent produces; files are
   what the user has. Both are visible.

5. **Activity feed replaces receipt inspector.** Non-technical users don't
   want to browse gate receipts. They want a feed: "Clerk created
   budget.xlsx", "Clerk moved 3 photos to /sorted/", "Clerk was blocked
   from deleting config.ini." The receipts are *underneath* each feed item
   for anyone who wants to drill down.

---

## Day 1 POC — The Minimum Believable Thing

**Goal:** Chat with an LLM through a desktop app, governed, with receipts
visible. No file operations yet. Prove the wiring works.

### Scope

| What | How | Source |
|------|-----|--------|
| Electron shell | Fork Guvnah scaffold | `~/git/guvnah` |
| Daemon spawn | Keep as-is (stdio) | Guvnah `rpc-client.ts` |
| Chat panel | New Svelte component | Inspired by gov-webui `index.html` |
| Streaming | Wire `chat.stream` RPC | Guvnah's existing framing + new handler |
| Backend picker | Wire `chat.models` + `chat.backend` | New dropdown component |
| Receipts in chat | Inline receipt strip per message | Gov-webui pattern |
| Violation resolution | Fix/revise/proceed buttons | Gov-webui + Guvnah's CommitWaive |

### What this proves

- The daemon spawns and streams chat through governance
- Responses include receipt hashes (visible, clickable)
- Blocking violations surface in the chat and resolve inline
- Backend switching works (Anthropic, Ollama, etc.)

### What this defers

- File operations (Day 2)
- Task/activity feed (Day 2-3)
- System tray / background agent (later)
- Non-technical UX polish (later)
- Installer / auto-update (later)

---

## Day 1 Implementation Plan

### Step 0: Scaffold (30 min)

```bash
# Fork Guvnah structure (don't git clone — clean start)
mkdir -p ~/git/clerk/src/{main,preload,renderer/{components,views,stores,lib,styles},shared}
mkdir -p ~/git/clerk/{test,tests/e2e,scripts}

# Copy structural files from Guvnah (adapt, don't blindly copy)
# - package.json (rename, update deps)
# - tsconfig.json, tsconfig.main.json
# - vite.config.ts, vitest.config.ts, svelte.config.js
# - electron-builder.yml (rename app)
# - scripts/bundle-preload.mjs
```

**package.json changes from Guvnah:**
- Name: `clerk`
- Description: "A desktop assistant that keeps receipts"
- Same Electron + Svelte 5 + Vite stack
- Add: none (keep deps minimal for Day 1)
- Remove: nothing needed

### Step 1: Main Process — Daemon + Chat RPC (1 hr)

**Keep from Guvnah:**
- `src/main/rpc-client.ts` — Frame parser, JSON-RPC transport, shape adapters
- `src/main/connection.ts` — Health polling, connection state machine
- `src/main/index.ts` — App lifecycle, BrowserWindow creation (simplify)

**Add to `src/main/ipc-handlers.ts`:**
```typescript
// Chat namespace (the key unlock)
ipcMain.handle(Channels.CHAT_SEND, async (_e, messages, options) => {
  return client.rpc('chat.send', { messages, ...options });
});

ipcMain.handle(Channels.CHAT_STREAM_START, async (_e, messages, options) => {
  // Start streaming — daemon sends chat.delta notifications
  // Main process collects deltas, forwards to renderer via webContents.send
  const streamId = crypto.randomUUID();
  client.rpcStream('chat.stream', { messages, ...options }, (delta) => {
    win.webContents.send(Channels.CHAT_STREAM_DELTA, { streamId, delta });
  }, (result) => {
    win.webContents.send(Channels.CHAT_STREAM_END, { streamId, result });
  });
  return { streamId };
});

ipcMain.handle(Channels.CHAT_MODELS, async () => {
  return client.rpc('chat.models', {});
});

// Keep existing: governor.hello, governor.status, commit.*, receipts.*
```

**Add to `src/shared/channels.ts`:**
```typescript
export const Channels = {
  // ...existing...
  CHAT_SEND: 'clerk:chat:send',
  CHAT_STREAM_START: 'clerk:chat:stream:start',
  CHAT_STREAM_DELTA: 'clerk:chat:stream:delta',
  CHAT_STREAM_END: 'clerk:chat:stream:end',
  CHAT_MODELS: 'clerk:chat:models',
} as const;
```

**Streaming architecture note:** The daemon uses JSON-RPC notifications
(`chat.delta`) during streaming. Guvnah's `rpc-client.ts` already parses
Content-Length frames — it just doesn't handle notification messages that
arrive mid-request. The change is: when we see a JSON-RPC message without
`id` (a notification), route it to the stream callback instead of the
response handler.

### Step 2: Preload — Expose Chat API (15 min)

**`src/preload/index.ts`:**
```typescript
contextBridge.exposeInMainWorld('clerk', {
  // Chat
  chatSend: (messages, options) =>
    ipcRenderer.invoke(Channels.CHAT_SEND, messages, options),
  chatStreamStart: (messages, options) =>
    ipcRenderer.invoke(Channels.CHAT_STREAM_START, messages, options),
  onChatDelta: (cb) =>
    ipcRenderer.on(Channels.CHAT_STREAM_DELTA, (_e, data) => cb(data)),
  onChatEnd: (cb) =>
    ipcRenderer.on(Channels.CHAT_STREAM_END, (_e, data) => cb(data)),
  chatModels: () =>
    ipcRenderer.invoke(Channels.CHAT_MODELS),

  // Governor (keep from Guvnah)
  hello: () => ipcRenderer.invoke(Channels.HELLO),
  status: () => ipcRenderer.invoke(Channels.STATUS),
  commitPending: () => ipcRenderer.invoke(Channels.COMMIT_PENDING),
  commitFix: () => ipcRenderer.invoke(Channels.COMMIT_FIX),
  commitRevise: () => ipcRenderer.invoke(Channels.COMMIT_REVISE),
  commitProceed: (scope, expiry) =>
    ipcRenderer.invoke(Channels.COMMIT_PROCEED, scope, expiry),
  receiptsList: (opts) => ipcRenderer.invoke(Channels.RECEIPTS_LIST, opts),
  receiptsDetail: (id) => ipcRenderer.invoke(Channels.RECEIPTS_DETAIL, id),
});
```

### Step 3: Renderer — Chat View (2 hr)

**`src/renderer/views/Chat.svelte`** — the main event:

```
┌─────────────────────────────────────────────────┐
│  Clerk                              [Models ▾]  │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │ Assistant                               │    │
│  │ Hello! I'm Clerk. What can I help with? │    │
│  │                                         │    │
│  │ ░░░░░░░░░░ receipt: sha256:a1b2.. ✓     │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │ You                                     │    │
│  │ Summarize the meeting notes in ~/docs   │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │ Assistant                               │    │
│  │ I'll read the files in ~/docs and...    │    │
│  │ ▊ (streaming)                           │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  ┌─ VIOLATION ─────────────────────────────┐    │
│  │ ⚠ Continuity: response contradicts      │    │
│  │   anchor "meeting-format-v2"            │    │
│  │                                         │    │
│  │  [Fix]  [Revise Anchor]  [Proceed]      │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
├─────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────┐ [Send]  │
│ │ Ask Clerk to do something...        │         │
│ └─────────────────────────────────────┘         │
└─────────────────────────────────────────────────┘
```

**Components needed (Day 1):**

| Component | Purpose | Complexity |
|-----------|---------|------------|
| `Chat.svelte` | View: message list + input + streaming | Medium |
| `ChatMessage.svelte` | Single message bubble + receipt strip | Medium |
| `ChatInput.svelte` | Textarea + send button + keyboard | Simple |
| `ReceiptStrip.svelte` | Inline receipt hash + verdict badge | Simple (port from Guvnah VerdictBadge) |
| `ViolationCard.svelte` | Blocking violation + 3 action buttons | Medium (port from Guvnah CommitWaive) |
| `ModelPicker.svelte` | Dropdown for backend/model selection | Simple |
| `ConnectionBadge.svelte` | Daemon status indicator | Simple (keep from Guvnah) |

**Store: `src/renderer/stores/chat.svelte.ts`:**
```typescript
// Svelte 5 runes
let messages = $state<ChatMessage[]>([]);
let streaming = $state(false);
let currentStreamId = $state<string | null>(null);
let pendingViolation = $state<PendingViolation | null>(null);
let selectedModel = $state<string>('');
let availableModels = $state<Model[]>([]);

// Derived
const canSend = $derived(!streaming && !pendingViolation);

export async function send(content: string) {
  messages.push({ role: 'user', content, timestamp: Date.now() });
  streaming = true;

  // Check for pending violation first
  const pending = await window.clerk.commitPending();
  if (pending?.violation_id) {
    pendingViolation = pending;
    streaming = false;
    return;
  }

  // Start streaming
  const { streamId } = await window.clerk.chatStreamStart(
    messages.map(m => ({ role: m.role, content: m.content })),
    { model: selectedModel }
  );
  currentStreamId = streamId;
  messages.push({ role: 'assistant', content: '', timestamp: Date.now(), streaming: true });
}

// Delta handler (wired in App.svelte $effect)
export function onDelta(data: { streamId: string; delta: any }) {
  if (data.streamId !== currentStreamId) return;
  const last = messages[messages.length - 1];
  last.content += data.delta.content || '';
}

// End handler
export function onEnd(data: { streamId: string; result: any }) {
  if (data.streamId !== currentStreamId) return;
  const last = messages[messages.length - 1];
  last.streaming = false;
  last.receipt = data.result.receipt;  // Attach receipt to message
  last.violations = data.result.violations;
  if (data.result.pending) {
    pendingViolation = data.result.pending;
  }
  streaming = false;
  currentStreamId = null;
}
```

### Step 4: App Shell (30 min)

**`src/renderer/App.svelte`:**
```svelte
<script lang="ts">
  import Chat from './views/Chat.svelte';
  import ConnectionBadge from './components/ConnectionBadge.svelte';
  import ModelPicker from './components/ModelPicker.svelte';
  import * as chat from './stores/chat.svelte';

  // Wire streaming callbacks
  $effect(() => {
    window.clerk.onChatDelta(chat.onDelta);
    window.clerk.onChatEnd(chat.onEnd);
  });
</script>

<div class="app">
  <header>
    <h1>Clerk</h1>
    <div class="header-controls">
      <ModelPicker />
      <ConnectionBadge />
    </div>
  </header>
  <main>
    <Chat />
  </main>
</div>
```

**Day 1 is intentionally one view.** No sidebar, no tabs, no navigation.
Just chat. The sidebar and activity feed come on Day 2 when we add file
operations and need somewhere to show them.

### Step 5: Styles (30 min)

- Dark theme (default, matches developer expectations for Day 1)
- Light theme toggle (for Erin, Day 2+)
- System font stack (no web fonts)
- Design tokens: `--clerk-bg`, `--clerk-surface`, `--clerk-text`, etc.
- Chat bubbles: user right-aligned (blue-ish), assistant left-aligned (neutral)
- Receipt strip: subtle, monospace, muted color
- Violation card: yellow/amber warning, prominent action buttons

### Step 6: Tests (30 min)

**Day 1 test targets:**
- `test/main/chat-handlers.test.ts` — IPC handlers for chat.* forward correctly
- `test/renderer/chat-store.test.ts` — Message state, streaming state machine
- `test/renderer/chat-components.test.ts` — ChatMessage renders, ViolationCard actions

**E2E (stretch):**
- App launches, daemon boots, type message, see response

---

## Day 2-3: File Operations + Activity Feed

### File Operations

The agent needs to touch the filesystem. This is where Clerk diverges
from everything else in the ecosystem.

**Architecture:**
```
User: "Organize my photos by date"
  → chat.stream → daemon governs the request
  → response includes tool calls (file operations)
  → main process executes file ops WITH gate receipts
  → activity feed shows each operation + receipt
```

**File operation gate:**
```typescript
// In main process
async function gatedFileOp(op: FileOperation): Promise<FileResult> {
  // 1. Create receipt request
  const receipt = await client.rpc('gate.check', {
    gate: 'file_operation',
    subject: { type: op.type, path: op.path },
    evidence: { exists: fs.existsSync(op.path), size: ... },
  });

  // 2. If blocked, surface to user
  if (receipt.verdict === 'block') {
    return { blocked: true, reason: receipt.reason, receipt };
  }

  // 3. Execute
  const result = await executeFileOp(op);

  // 4. Record
  return { ...result, receipt };
}
```

**File operation types (Day 2):**
- `read` — Read file contents (for context)
- `write` — Create or overwrite file
- `append` — Append to file
- `move` — Move/rename file
- `copy` — Copy file
- `delete` — Delete file (requires confirmation)
- `mkdir` — Create directory
- `list` — List directory contents

### Activity Feed

Replace Guvnah's receipt inspector with a human-readable feed:

```
┌─────────────────────────────────────────┐
│  Activity                               │
│                                         │
│  ● Created summary.md           2:14 PM │
│    receipt: sha256:f3e1.. ✓  allow      │
│                                         │
│  ● Moved 12 photos to /sorted  2:13 PM │
│    receipt: sha256:a8b2.. ✓  allow      │
│                                         │
│  ⚠ Blocked: delete config.ini  2:12 PM │
│    reason: file matches protected pat.. │
│    receipt: sha256:c4d5.. ✗  block      │
│                                         │
│  ● Read meeting-notes.txt      2:11 PM │
│    (no receipt — read-only)             │
└─────────────────────────────────────────┘
```

### Layout evolution

Day 1: Chat only (full width)
Day 2: Chat (left, 65%) + Activity Feed (right, 35%)
Day 3: Optional sidebar with file browser

---

## Day 4+: Non-Technical UX Polish

### For Erin (the "can my partner use this?" test)

1. **First-run wizard.** Pick a backend (Ollama local = free, Anthropic =
   paid). Test connection. Done.

2. **No jargon.** "receipt" → "proof", "gate" → "check",
   "violation" → "Clerk wasn't sure about this", "verdict" → "decision".
   The technical terms exist in the drill-down, not the surface.

3. **Drag and drop.** Drop files onto the chat to give Clerk context.
   Drop files onto the activity feed to add them to the workspace.

4. **System tray.** Clerk runs in background. Click tray icon → chat
   window. Right-click → recent activity, quit.

5. **Notifications.** "Clerk finished organizing your photos" (native OS
   notification, not a beep from a web app).

6. **Keyboard shortcuts.** Cmd+N new chat. Cmd+Enter send. Escape close.
   That's it for v1.

7. **Onboarding.** First message from Clerk: "Hi! I'm Clerk. I can help
   you organize files, write documents, and manage tasks. Everything I do
   is logged — click any activity to see exactly what happened and why.
   What would you like help with?"

---

## Technical Decisions

### Why fork Guvnah, not start from scratch?

Guvnah gives us:
- Electron lifecycle management (tested)
- Daemon spawn via stdio (tested)
- Content-Length frame parser (tested)
- JSON-RPC 2.0 client with shape adapters (tested)
- contextBridge security boundary (tested)
- Svelte 5 + Vite build pipeline (tested)
- Connection health monitoring (tested)
- 77 unit tests + 2 E2E tests

Starting fresh would mean reimplementing all of this. The fork cost is
renaming + removing the 6 observation-only views + adding chat.

### Why not Tauri?

Guvnah's CLAUDE.md already documents the Tauri migration path — renderer
code is 100% reusable. Day 1 ships on Electron because it works today.
Tauri migration is a future optimization (smaller binary, less RAM).

### Why Svelte 5 runes?

Already proven in Guvnah. Runes mode (`$state`, `$derived`, `$effect`)
is cleaner than Svelte 4 stores for reactive UI. Constraint: state files
must be `.svelte.ts`, not plain `.ts`.

### Why stdio, not Unix socket?

Guvnah chose stdio for a reason: the daemon is a child process, lifecycle
is tied to the app. No socket file cleanup, no permission issues, no
stale socket detection. Chat streaming over stdio works because the
Content-Length framing handles interleaved request/notification messages.

### What about MCP?

The governor already has an MCP server (`governor mcp serve`). Clerk
could expose file operations as MCP tools, letting the LLM call them
through the standard tool-use protocol. This is a Day 4+ decision — for
Day 1, direct RPC is simpler. But the MCP path means Clerk could work
with any MCP-compatible model, not just ones that speak our RPC protocol.

---

## File Inventory (Day 1)

```
clerk/
├── package.json
├── tsconfig.json
├── tsconfig.main.json
├── vite.config.ts
├── vitest.config.ts
├── svelte.config.js
├── electron-builder.yml
├── LICENSE                          # Apache-2.0
├── README.md                        # "Clerk is a desktop assistant that keeps receipts."
├── PLAN.md                          # This file
│
├── src/
│   ├── main/
│   │   ├── index.ts                 # App lifecycle, window, daemon spawn
│   │   ├── rpc-client.ts            # JSON-RPC 2.0 + streaming support
│   │   ├── connection.ts            # Health polling
│   │   └── ipc-handlers.ts          # IPC channels (chat.* + governor.*)
│   │
│   ├── preload/
│   │   └── index.ts                 # contextBridge: window.clerk API
│   │
│   ├── renderer/
│   │   ├── App.svelte               # Shell: header + main area
│   │   ├── views/
│   │   │   └── Chat.svelte          # Chat panel (Day 1 only view)
│   │   ├── components/
│   │   │   ├── ChatMessage.svelte   # Message bubble + receipt strip
│   │   │   ├── ChatInput.svelte     # Textarea + send button
│   │   │   ├── ReceiptStrip.svelte  # Inline receipt hash + verdict
│   │   │   ├── ViolationCard.svelte # Blocking violation + actions
│   │   │   ├── ModelPicker.svelte   # Backend/model dropdown
│   │   │   └── ConnectionBadge.svelte
│   │   ├── stores/
│   │   │   ├── chat.svelte.ts       # Message state, streaming, violations
│   │   │   └── connection.svelte.ts # Daemon health state
│   │   ├── lib/
│   │   │   ├── api.ts               # window.clerk type wrapper
│   │   │   └── format.ts            # Date, hash, size formatters
│   │   └── styles/
│   │       ├── tokens.css           # Design tokens
│   │       └── global.css           # Reset + typography
│   │
│   └── shared/
│       ├── channels.ts              # IPC channel constants
│       └── types.ts                 # TypeScript interfaces
│
├── test/
│   ├── main/
│   │   └── chat-handlers.test.ts
│   └── renderer/
│       ├── chat-store.test.ts
│       └── chat-components.test.ts
│
└── tests/e2e/
    └── smoke.spec.ts
```

---

## What This Unlocks

**For users:** A desktop assistant that can prove what it did. Every file
it touches, every task it completes — there's a receipt. Not because you
asked for one, but because the system requires it.

**For the ecosystem:** A consumer-facing proof that governed AI is viable.
Not just a research artifact or a developer tool, but something a normal
person can install and use.

**For the Governor project:** The first time the enforcement kernel is
invisible. The user doesn't know about receipts, regime detection, or
claim types. They just know Clerk doesn't lie about what it did.

---

## Competitive Positioning

| Feature | Cowork (Anthropic) | Clerk |
|---------|-------------------|-------|
| Desktop agent | Yes | Yes |
| File management | Yes | Yes |
| Chat interface | Yes | Yes |
| Audit trail | No | **Every action receipted** |
| Violation resolution | No | **Fix/revise/proceed** |
| Multiple backends | Claude only | **Anthropic, Ollama, Claude CLI, Codex** |
| Open source | No | **Apache-2.0** |
| Formal enforcement | Trust-based | **Evidence-gated, receipt-chained** |
| Academic grounding | None visible | **17 papers, 14k+ tests** |

The pitch isn't "we're better than Cowork." The pitch is "we're the only
desktop agent that can prove what it did." Anthropic validated the market.
We differentiate on trust architecture.

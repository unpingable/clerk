# CLAUDE.md — Instructions for Claude Code

## What This Is

Clerk is a governed desktop agent (Electron + Svelte 5) that wraps the
Agent Governor daemon with a chat-first interface for non-technical users.

See `PLAN.md` for the full architecture and implementation plan.

## Key Architecture Rules

1. **The daemon is the sole authority.** Clerk is an untrusted renderer.
   All governance-relevant actions (chat, file mutations, task execution)
   go through the Governor daemon via JSON-RPC 2.0 over stdio.

2. **Every mutation gets a receipt.** File creates, moves, deletes — the
   main process gates them through the daemon before touching disk.

3. **contextBridge is the security boundary.** The renderer never touches
   Node APIs. All system access goes through `window.clerk.*` → IPC →
   main → daemon.

4. **Svelte 5 runes mode.** Use `$state`, `$derived`, `$effect`. State
   files must be `.svelte.ts`, not plain `.ts` (runes break silently in
   plain `.ts`).

## Relationship to Other Repos

| Repo | Role | Clerk's relationship |
|------|------|---------------------|
| `agent_gov` | Enforcement kernel | Clerk spawns `governor serve --stdio` |
| `guvnah` | Observation cockpit | Clerk forked from Guvnah's Electron scaffold |
| `gov-webui` | Web chat + builders | UX patterns ported (chat, artifacts, violations) |
| `maude` | TUI client | Peer — different surface, same daemon |
| `vscode-governor` | IDE extension | Peer — developer-facing, not consumer |

## Tech Stack

- **Electron** — Desktop shell
- **Svelte 5** — Renderer (runes mode)
- **Vite** — Bundler
- **TypeScript** — All layers
- **vitest** — Unit tests
- **Playwright** — E2E tests

## Common Commands

```bash
npm run dev        # Dev mode (watch + electron)
npm run build      # Production build
npm run start      # Build + launch
npm test           # Unit tests (vitest)
npm run test:e2e   # E2E tests (playwright)
```

## File Conventions

- IPC channels defined once in `src/shared/channels.ts`
- Types shared between main/renderer in `src/shared/types.ts`
- Shape adapters (daemon dict → TS types) live in `src/main/rpc-client.ts`
- Components in `src/renderer/components/`
- Views in `src/renderer/views/`
- Stores in `src/renderer/stores/` (must be `.svelte.ts`)

## Debugging Discipline

Shared doctrine across the constellation (annotated source: `agent_gov/CLAUDE.md`):

- **Default to reduction.** Escalate to integration only after reduction has failed to discriminate.
- **Belief must be earned by the cheapest available falsification, not constructed by accretion.**

**In this project**, "load-bearing" means the moment the renderer is about to treat any local state as "approved" or "committed." The cheapest discriminating test is always: round-trip through the daemon. The renderer's belief about daemon state is never authoritative — only the daemon's most recent response is. "The daemon is the sole authority" is the static version; this is its dynamic version.

## Don't

- Don't let the renderer make governance decisions
- Don't bypass the daemon for file operations
- Don't use plain `.ts` for files that use Svelte 5 runes
- Don't add framework deps (no React, no Tailwind, no component libraries)
- Don't optimize for developers — this is for non-technical users

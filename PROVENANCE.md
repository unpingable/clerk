# Provenance

This project is human-directed and AI-assisted. Final design authority,
acceptance criteria, and editorial control rest with the human author.
AI contributions were material and are categorized below by function.

## Human authorship

The author defined the project direction, requirements, and design intent.
AI systems contributed proposals, drafts, implementation, and critique under
author supervision; they did not independently determine project goals or
deployment decisions. The author reviewed, revised, or rejected AI-generated
output throughout development.

## AI-assisted collaboration

### Architectural design and constraint model

Lead collaboration: ChatGPT (OpenAI). Heavy involvement in the constraint
template design (the "trust dial"), capability model, confirmation enforcement
strategy, persistence contracts, and race-safety invariants. Also contributed
to the overall Clerk architecture (untrusted renderer, daemon authority,
receipt-gated mutations) in three-way design sessions.

### Implementation, tests, and integration

Lead collaboration: Claude (Anthropic) via Claude Code. Heavy contributions
to source code, Svelte 5 components, store modules, RPC client wiring, IPC
handlers, preload bridge, template manager, test suites, shape adapters,
and build configuration, including assembly of architectural decisions into
working code.

### Governor-in-the-loop development

The [Agent Governor](https://github.com/unpingable/agent_governor) daemon is
both the system Clerk wraps and a tool used during its own development:
evidence gate checks on generated code, pre-commit hooks, and receipt emission.
Included because it is unusual and directly relevant to the project's thesis.

## Provenance basis and limits

This document is a functional attribution record based on commit history,
co-author trailers (where present), project notes, and documented working
sessions. It is not a complete forensic account of all contributions.

Some AI contributions (especially design critique, rejected alternatives,
and footguns avoided) may not appear in repository artifacts or commit
metadata.

Model names/tools are recorded at the platform level (e.g., ChatGPT,
Claude Code); exact model versions may vary across sessions and are not
exhaustively reconstructed here.

## What this document does not claim

- No exact proportional attribution. Contributions are categorized by
  function, not quantified by token count or lines of code.
- Design and implementation were not cleanly sequential. Architecture
  informed code, code revealed design gaps, and the feedback loop was
  continuous.
- "Footguns avoided" and "ideas that didn't ship" are real contributions
  that leave no artifact. This document cannot fully account for them.

---

This document reflects the project state as of 2026-03-02 and may be revised.

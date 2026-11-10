---
id: card-mw8ij8mv-2
title: When I tell an agent to move a card to done have it put the card at the top of the done column
column: col-mqwk2njn-4
position: -114000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6.1-sol
preferredModel.claude-code: sonnet
preferredModel.cursor-other: claude-opus-5-5-medium
thinkingLevel.copilot: medium
thinkingLevel.codex: high
thinkingLevel.claude-code: medium
createdAt: 1794183505015
updatedAt: 1794308577895
---

## Description
When an agent is told to move a card into a Done-role column, that card must land at the **top** of Done (newest completed work first), not at the bottom. Today the AI Loop's verified `complete` path already inserts at index 0, but agent-driven moves (direct card-file `column`/`position` edits, handoff prompts, or other move paths used when a human asks an agent to finish a card) still tend to append after the current maximum position. Align those agent moves with the same "top of Done" rule: assign a position that sorts before every existing card in that Done column, leave the relative order of the other Done cards unchanged, and keep this special casing scoped to Done-role columns (do not change append-at-bottom behavior for other columns unless required to implement the Done case). Update any agent-facing board/skill guidance that currently implies "always append after the max position" so it tells agents to place Done moves at the top.

## Acceptance criteria
- [x] When an agent moves an existing card into a column whose `role` is `done` (including by editing that card's `column`/`position` frontmatter), the card's effective order in that column is first / top — its `position` is strictly less than every other card already in that Done column (or equivalent index-0 insertion via the store/API).
- [x] Other cards already in that Done column keep their relative order; only the newly moved card is inserted ahead of them.
- [x] Moving a card into a non-`done` column does not start using the Done "insert at top" rule; existing append / requested-index behavior for those columns remains unchanged unless a shared helper makes the Done case correct without regressing them.
- [x] Agent-facing instructions that describe how to move cards (board contract / card-authoring skill / AI control files as applicable) state that a move into Done must place the card at the top of that column, not after the current maximum position.
- [x] Focused tests cover: moving a card into a Done column that already has one or more cards results in the moved card ordered first; a second Done move then becomes the new first card with the previous move remaining next.
- [x] Manual or Development Host check: ask an agent (or perform the agent-equivalent move) to move a card to Done when Done already has cards; the board shows the moved card at the top of Done.

## Activity
### 2026-11-10T02:33:34.738Z - Usage Orchestrator chose Cursor Agent CLI
Stage: definition. Cursor Agent CLI reports 71% remaining, resetting 2026-11-06T23:33:31.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-10T02:33:36.468Z - Usage Orchestrator dispatch dispatch-mwa2sy50-1 started
Card: card-mw8ij8mv-2 ("When I tell an agent to move a card to done have it put the card at the top of the done column"). CLI: Cursor Agent CLI. Stage: definition.
Requested model: "auto" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the definition stage: auto.
AI loop stage thinking level rule for the definition stage "max" was not applied: Cursor Agent CLI does not accept a thinking level, so the AI loop stage thinking level rule for the definition stage "max" was not applied and the run used that CLI's default thinking level.

### 2026-11-10T02:33:41.565Z - Usage Orchestrator dispatch dispatch-mwa2sy50-1 model observed
Card: card-mw8ij8mv-2. CLI: Cursor Agent CLI. Stage: definition.
Actual model: "Auto" (source: Cursor Agent stream-json system.init.model; attempt: dispatch-mwa2sy50-1).

### 2026-11-10T02:34:19.320Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-sonnet-5.5`, thinking level `medium`
- codex: model `gpt-6.1-sol`, thinking level `high`
- claude-code: model `sonnet`, thinking level `medium`
- cursor-other: model `claude-opus-5-5-medium`

### 2026-11-10T02:58:47.864Z - Auto-started in Implement
Assigned to AI in Ready; moved to Implement automatically.

### 2026-11-10T02:58:59.238Z - Usage Orchestrator chose Cursor Agent CLI
Stage: implementation. Cursor Agent CLI reports 71% remaining, resetting 2026-11-06T23:33:31.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-10T02:59:01.224Z - Usage Orchestrator dispatch dispatch-mwa3pmnc-2 started
Card: card-mw8ij8mv-2 ("When I tell an agent to move a card to done have it put the card at the top of the done column"). CLI: Cursor Agent CLI. Stage: implementation.
Requested model: "auto" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: auto.

### 2026-11-10T02:59:04.900Z - Usage Orchestrator dispatch dispatch-mwa3pmnc-2 model observed
Card: card-mw8ij8mv-2. CLI: Cursor Agent CLI. Stage: implementation.
Actual model: "Auto" (source: Cursor Agent stream-json system.init.model; attempt: dispatch-mwa3pmnc-2).

### 2026-11-09 - Cursor Agent implementation
Added shared Done-top placement helpers (`positionForColumnPlacement`, `insertIndexForColumnPlacement`, `moveCardIntoColumn`) so agent file edits and role-aware API moves insert at the top of Done while non-done columns keep append / explicit-index behavior. Wired the AI Loop verified-complete path through the shared insert-index helper. Updated AGENTS.md board contract, card-authoring skill sources/installs, and board README guidance. Focused tests cover sequential Done top inserts (pure helpers + store/API + agent-equivalent on-disk column/position edits reloaded by the store). Validated with `npm run compile-tests`, `npm run compile`, focused Node tests, `npm test` (1131 passed), and `npm run lint`.

STATUS: DONE

### 2026-11-10T03:05:50.328Z - MWNN independent verification started

### 2026-11-10T03:05:50.964Z - Cursor Agent CLI implementation handoff failed
Acceptance criteria require human verification or lack independent check mappings.

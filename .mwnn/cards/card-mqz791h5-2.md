---
id: card-mqz791h5-2
title: Make Verify column part of standard board
column: col-mqwk2njn-4
position: 2000
assignee: { kind: human }
createdAt: 1782736446137
updatedAt: 1782829230164
---

## Description
Promote "Verify" from an ad-hoc `custom` column to a first-class, standard board column. Today Verify only exists on this board as a `role: 'custom'` column (`col-mqxta6ho-4` in `.mwnn/columns.json`), so it is invisible to the default board, the `ColumnRole` type, and any role-specific behavior. It also sits between Implement and Done but is not produced by `defaultBoard`.

This slice introduces `verify` as a recognized column role, includes a Verify column in the default/freshly-created board (positioned between the in-progress and done columns), and teaches the migration/role-inference logic to map a column titled "Verify" to the `verify` role instead of `custom`. The Verify role represents work that has been implemented and is awaiting verification (e.g. by a human) before it can be moved to Done.

This unblocks the dependent AI-loop card (`card-mqz7b9ae-3`), which needs Verify to be a stable, well-known column so the loop can park finished cards there and reassign them to Human.

Scope is the column model and default board only — no AI-loop behavior, and no change to how cards are dragged between columns beyond the new role existing.

## Acceptance criteria
- [ ] `ColumnRole` in `src/types.ts` includes a `'verify'` member, and `isColumnRole` accepts `'verify'` while still rejecting unknown strings.
- [ ] A freshly created/reset board (`defaultBoard` / `createInitialBoard`) includes a column titled "Verify" with `role: 'verify'`, positioned between the in-progress column and the Done column.
- [ ] The default column configuration (`mwnn-kanban.defaultColumns` and its hard-coded fallback) lists Verify in order: Backlog, Ready, In Progress, Verify, Done.
- [ ] Role inference / migration maps a column whose title matches "Verify" (case-insensitive, trimmed) to `role: 'verify'` rather than `custom` or `in-progress`, in both `inferColumnRole` (`src/utils.ts`) and `inferMigrationRole` (`src/boardStore.ts`).
- [ ] The existing board's Verify column (`col-mqxta6ho-4`) loads with `role: 'verify'` after the change, and round-trips through serialization back to `.mwnn/columns.json` with `"role": "verify"` (no data loss, no reordering of existing columns).
- [ ] A Verify column has no `wipLimit` or `reverseWip` enforced by default (both remain `null` unless explicitly configured), matching its current behavior.
- [ ] Boards that contain no Verify column continue to load and render unchanged (the new role is additive and does not force a Verify column onto existing boards).
- [ ] `npm run compile` and `npm run compile-tests` succeed, and unit tests covering column roles, `defaultBoard`, and migration/role inference pass (new or updated tests assert the `verify` role and default-board ordering).

## Activity
### 2026-06-30T12:33:10.202Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-06-30T13:48:28.121Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

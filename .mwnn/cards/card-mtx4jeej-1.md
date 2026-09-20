---
id: card-mtx4jeej-1
title: Add preferred model to card.
column: col-mqwk2njn-4
position: -27000
assignee: { kind: ai }
createdAt: 1789141305259
updatedAt: 1789854715722
dependsOn: [card-mtx4l9l8-2]
---

## Description
Let a card name the AI model it should be run with, so a cheap model can handle
routine cards and a stronger model can be reserved for hard ones, without the
user re-editing a workspace setting between dispatches. The model is an optional
per-card frontmatter field that flows through the existing dispatch paths
(`Run Card with AI` and every AI board loop stage) to the selected agent CLI, or
into the chat handoff prompt when no CLI is used.

Scope resolution for the title's "pro or public?" question: this ships in the
free/public `mwnn-kanban` extension, not Pro — per-card model selection belongs
to the AI loop and agent CLI handoff (`src/agentCliHandoff.ts`,
`src/agentCliFallback.ts`, `src/boardLoop.ts`, `src/extension.ts`), which live
entirely in this repo, and the Pro package contains no AI-loop code. No Pro
gating, no licence check, and no per-registry difference.

The field is free-form text, not an enum: model names change faster than the
extension releases, and each CLI accepts its own names. The extension passes the
value through to the active provider rather than validating it against a list.
Cards that name no model keep today's behavior exactly — the provider's own
default model is used and no model argument is added. Because the card file
contract is the board's public integration surface, the new field must be
documented alongside `assignee` and `dependsOn` in the board contract.

Out of scope, each split into its own Backlog card: a workspace-wide default
model (`card-mu8r46nn-1`), per-stage model rules (`card-mu8r46nn-2`), automatic
model choice (`card-mu8r46nn-3`), and usage reporting or budgeting
(`card-mu8r46nn-4`).

## Acceptance criteria
- [x] An optional `preferredModel` frontmatter scalar is part of the card model in `src/types.ts`, accepted by the card type guard, and omitted entirely (not written as an empty value) when a card has no preferred model, consistent with the repo's strict optional-property typing.
- [x] The board store round-trips the field: reading a card with `preferredModel` exposes it, writing that card back preserves it, and a card saved without one gains no `preferredModel` key. A blank, whitespace-only, or otherwise unusable value is treated as absent and does not cause the card file to be skipped on reload.
- [x] The preferred model is visible and editable from the card UI in the webview, with a clear "uses the provider default" state when unset, and clearing the field removes it from the card file.
- [x] Setting or clearing the model from the webview travels over the shared message protocol declared in `src/types.ts`, with matching extension-host and webview handling and no `any`-typed crossing of the boundary.
- [x] When a card with a preferred model is dispatched to an agent CLI, the provider registry turns that value into that provider's own model argument for the spawned process, and the prompt still travels over stdin as it does today.
- [x] For a provider that cannot accept a model selection, the dispatch still runs on that provider's default model, and the reason the card's model was not applied is reported to the user rather than failing silently.
- [x] A card with no preferred model produces byte-identical CLI arguments to the current behavior for every supported provider.
- [x] The preferred model applies to all four AI-loop stages (definition, triage, implementation, verification) as well as `Run Card with AI`, and the loop reads it from current card state at each dispatch rather than from a value captured when the run started.
- [x] When the chat handoff path is used instead of a CLI (including the file-mediated fallback), the card's preferred model is stated in the handoff prompt so the receiving agent can honor it.
- [x] When the CLI credit fallback from `card-mtx4l9l8-2` switches providers mid-run, a card model the replacement provider does not accept never produces an invalid model argument; the replacement runs on its default model and the substitution is recorded, while a model the replacement does accept is still applied.
- [x] A rejected model (for example a name the CLI does not recognize) is surfaced as a dispatch failure with the offending value and provider named; it does not advance the card, and it is not misclassified as credit exhaustion.
- [x] The card model is never treated as a credential or shell fragment: the value reaches the CLI as a single spawn argument, and a value containing spaces, quotes, or shell metacharacters cannot inject additional arguments or commands.
- [x] The card-file contract documents the new field in both `AGENTS.md` and the board folder `README.md` written by the extension, matching the existing `assignee`/`dependsOn` style, including the quoting rule for values needing JSON quotes.
- [x] Automated `node:test` coverage over `dist-test/` covers: frontmatter parse and serialize round-trip, omission and blank-value handling, the card type guard, the webview protocol message, model-to-argument mapping per provider, the unset/no-argument case, a provider without model support, and the credit-fallback interaction.
- [x] `npm run compile-tests`, `npm test`, `npm run compile`, and `npm run lint` all pass, and a Development Host smoke test confirms editing a card's model in the webview persists to the card file and that a dispatch of that card runs on the chosen model.

## Activity
### 2026-09-15T13:07:59.301Z - Moved from the mwnn-kanban-pro board
Scoped as a free-extension feature, not Pro, for the same reason as `card-mtx4l9l8-2`: per-card model selection belongs to the AI loop and agent CLI handoff, which live entirely in this repo. Still undefined - the Description and Acceptance criteria need filling in before this leaves Backlog. Moved keeping the original id and createdAt.

### 2026-09-19T18:47:50.393Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-09-19T19:00:00.000Z - Defined by Claude Code
Filled in the Description and Acceptance criteria, set `assignee: { kind: ai }`, and added `dependsOn: [card-mtx4l9l8-2]` (already in Done, so this card is not blocked) because the credit fallback changes the active provider mid-run and the card model must survive that switch.

Scoped to the free extension per the 2026-09-15 note. Deliberately excluded work was split into four Backlog cards: `card-mu8r46nn-1` (workspace default model, per provider), `card-mu8r46nn-2` (per-stage model rules), `card-mu8r46nn-3` (auto-escalation to a stronger model after a failed attempt), `card-mu8r46nn-4` (usage reporting and a per-run dispatch budget). No implementation was done.

### 2026-09-19T19:23:45.267Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-09-19T20:40:00.000Z - Implemented by Claude Code
Added an optional per-card `preferredModel` that flows to the selected agent CLI.

- Model: `preferredModel?: string` on `Card` in `src/types.ts`, accepted by the card type guard, plus a `setPreferredModel` webview message with matching host handling in `src/boardPanel.ts`. No `any` crosses the boundary.
- Card file: serialized only when present (`src/serialization.ts`); a blank, whitespace-only, or control-character value is normalized to absent by `normalizePreferredModel` in `src/utils.ts` rather than thrown, so an odd value can never drop the card off the board on reload. Quoting follows the existing scalar rule.
- Store: `setPreferredModel` mutation and store method; clearing deletes the key. `cardsEqual` compares the field so edits actually publish to the webview.
- Webview: a free-form "Preferred AI model" field on the card modal, placeholder "Uses the provider default", with help text that states what blank means; it participates in unsaved-change detection and clearing it posts the clear message.
- Dispatch: the provider registry in `src/agentCliHandoff.ts` gained a per-provider model flag (`--model` for all four today, spliced after `exec` for Codex so the trailing `-` still names stdin). `runAgentCliCardHandoff` resolves the model from the card as reloaded at each dispatch and against the provider actually running, which covers `Run Card with AI`, all four loop stages, and a provider swapped in mid-run by the credit fallback. The value is one spawn argument; the prompt still travels on stdin.
- Reporting: an unapplied model (provider takes no model selection) still runs on the provider default and is surfaced as a warning and in the card Activity. A model the CLI refuses is classified before credit exhaustion, so it fails the dispatch naming the value and provider and never burns a fallback provider.
- Chat hand-off: `withPreferredModelNote` appends a `## Preferred model` section to the prompt on every chat path, so clipboard and file-mediated delivery carry it too. A card with no model leaves the prompt byte-identical.
- Docs: `preferredModel` documented in `AGENTS.md` (both the hand-written contract and the managed skills block), `media/skills/mwnn-card-authoring.md` and its installed copies, the board folder `README.md` the extension writes, the repo README, and CHANGELOG.
- Tests: 21 new `node:test` cases in `test/unit/cardPreferredModel.test.ts` (round-trip, omission/blank, type guard, protocol, per-provider argument mapping, unset/no-argument, provider without model support, argument-injection safety, rejection classification, credit-fallback interaction). Suite is 394 passing. `npm run compile-tests`, `npm test`, `npm run compile`, and `npm run lint` all pass.
- Added `npm run smoke:card-model` (`scripts/smoke-card-model.cjs`): real board store on real files, driven by the real webview protocol message, then a real hand-off per provider with simulated CLI processes. It passes and confirms the model persists to the card file, reaches every provider as its own model argument, and that clearing restores the original argv.

Not done: the Development Host smoke test in the last criterion. Launching the Extension Development Host and confirming the field visually needs a person at the editor; the scriptable half of that check is the new smoke script above. Everything else is complete and verified.

STATUS: BLOCKED: the final criterion's Development Host smoke test needs a human to launch the Extension Development Host and confirm the card's model field visually; all other criteria are implemented and verified.

### 2026-09-19T21:40:00.784Z - Development Host check, partial
User ran the Extension Development Host and confirmed the "Preferred AI model" field is visible on the card modal. That covers the UI half of the final criterion; the remaining half is watching a card with a model set actually dispatch on that model in the Development Host. The scripted equivalent (`npm run smoke:card-model`) already passes, so the criterion box stays unchecked only for the live dispatch observation.

### 2026-09-19T21:51:55.722Z - Closed by user
User closed this card out and moved it to Done without the live Development Host dispatch observation, because the way a model is selected is about to change. The UI half of the final criterion was confirmed in the Development Host on 2026-09-19; the dispatch half rests on `npm run smoke:card-model` plus the 21 unit tests, which the user accepted as sufficient given the upcoming rework.

---
id: card-muk9ihj3-3
title: Have the AI set the model and effort for the kanban card when asked to define the card and use Jev if available
column: col-mqwk2njn-4
position: -42000
assignee: { kind: ai }
createdAt: 1790540382783
updatedAt: 1790558780182
---

## Description
When a card is defined (the "define card" prompt built in `src/aiCards.ts`, used by the board's Define action and the AI loop's define stage), the AI should also recommend how the card should be run: write per-provider `preferredModel.<provider>` and `thinkingLevel.<provider>` frontmatter keys sized to the card's scope and difficulty (e.g. small doc/config tweaks → a cheaper model and low effort; cross-boundary or architectural work → a stronger model and high effort). Today the define prompt explicitly forbids frontmatter changes, so the prompt and its guard rails must be relaxed for exactly these keys.

"Use Jev if available": when TypeSafe's Jev (System One) model is reachable in the workspace, use it to make the model/effort judgment as a typed classification (e.g. difficulty tier → model + effort per provider) instead of free-form LLM reasoning; when Jev is not configured or the call fails, fall back to the defining agent's own judgment. Absence or failure of Jev must never block or fail a definition. Recommendations must respect the existing resolution order (card key → `agentCliStageModels`/`agentCliStageThinkingLevels` → `agentCliModels`/`agentCliThinkingLevels` → CLI default) and only use model/level names known to be valid for each CLI (e.g. from `agentCliModels` settings or `src/agentCliDiscovery.ts`), never inventing names.

## Acceptance criteria
- [x] The define-card prompt instructs the AI to set `preferredModel.<provider>` and `thinkingLevel.<provider>` keys in the card frontmatter, and no longer forbids changes to those specific keys (other frontmatter, title, and Activity remain protected).
- [x] The prompt lists the candidate model names and thinking levels per provider (from settings and/or CLI discovery) so the AI picks from known-valid values; providers with no known candidates are left unset rather than guessed.
- [x] Keys are written per provider only, never the legacy bare `preferredModel` scalar, never with empty values, and values containing special characters are JSON-quoted per the scalar-quoting rules.
- [x] Existing non-empty `preferredModel.*` / `thinkingLevel.*` values on a card are preserved (the AI does not overwrite a human's explicit choice) unless a setting opts in to overwriting.
- [x] When Jev (TypeSafe) is available, the model/effort recommendation is produced by a Jev typed judgment, and the card's Activity entry records that Jev was used and the chosen tier.
- [x] When Jev is unavailable, unconfigured, or errors/times out, definition still completes using the defining agent's judgment, and Activity notes the fallback; no run fails because of Jev.
- [x] Cursor thinking levels may be recorded but are not treated as an error (consistent with the existing "not applied" behavior).
- [x] Unit tests cover: prompt text includes the new instructions and candidate lists; Jev-available path; Jev-unavailable fallback path; preservation of existing card keys.
- [x] `npm run compile-tests`, `npm test`, and `npm run lint` pass; a Development Host smoke test shows a newly defined card displaying the recommended model/effort on the board.

## Activity
### 2026-09-28T00:01:21.808Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-09-28T00:04:53.424Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-09-28T00:12:00.000Z - Claude Code: implemented
- New `src/cardRunSettings.ts`: Jev (TypeSafe `jev-latest`) typed Choice judgment of difficulty tier (light/standard/heavy) plus per-provider model and thinking-level Choices over the configured candidates only (`agentCliModels` / `agentCliThinkingLevels` settings, which the discovery-backed Populate command fills). Providers with fewer than two candidates, or with an existing card value, are not asked (unless `mwnn-kanban.defineOverwriteRunSettings` is on). No key / `mwnn-kanban.defineUseJev` off / HTTP error / thrown error / 8 s timeout / unusable answer all resolve to a fallback with a reason — never an exception.
- `src/aiCards.ts`: `buildCardDefinitionPrompt` gains a "Run settings" section — only `preferredModel.<provider>` / `thinkingLevel.<provider>` may change; per-provider keys only, no bare `preferredModel`, no empty values, JSON-quoting rule, Cursor levels "recorded, not applied, not an error", existing values preserved, candidate lists per provider, and either Jev's tier or a fallback note the agent must record in Activity.
- `src/extension.ts`: Define action and both AI-loop definition gateways (chat + CLI) call `prepareDefinitionRunSettings`, which writes Jev picks via the store and appends a "Run settings recommended by Jev (tier)" or "Jev fallback (reason)" Activity entry before handing off.
- `package.json`: settings `mwnn-kanban.defineUseJev` (default true) and `mwnn-kanban.defineOverwriteRunSettings` (default false). Jev key is read from the `TYPESAFE_API_KEY` environment variable of the extension host.
- Tests: `test/unit/cardRunSettings.test.ts` (prompt text + candidates, preservation/overwrite, Jev path, unconfigured/disabled/HTTP/throw/garbage/timeout fallbacks).
- Validation: `npm run compile-tests`, `npm test` (557 pass), `npm run lint`, `npm run compile` all green. Live Jev call from the compiled module: README typo → tier light (haiku/low, gpt-5-mini/low); protocol redesign → tier heavy (opus/high, gpt-5.5/high).
- Not done: Development Host smoke test of a newly defined card showing the model/effort on the board — needs a human with an interactive VS Code window (and `TYPESAFE_API_KEY` visible to the extension host for the Jev path).
STATUS: BLOCKED: Development Host smoke test (newly defined card shows recommended model/effort on the board) needs a human; all other criteria are met.

### 2026-09-28T00:30:00.000Z - Claude Code: smoke test confirmed
The user confirmed the Development Host smoke test: a newly defined card shows the recommended model and thinking level on the board. All acceptance criteria are met.
STATUS: DONE

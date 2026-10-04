---
id: card-mupir7dt-2
title: Have Jev set the preferred model and thinking level only after the card has been fully defined
column: col-mqwk2njn-4
position: -43000
assignee: { kind: ai }
preferredModel.copilot: auto
preferredModel.codex: gpt-5.5
preferredModel.claude-code: haiku
thinkingLevel.copilot: low
thinkingLevel.codex: low
thinkingLevel.claude-code: low
createdAt: 1790858236961
updatedAt: 1791031195216
---

## Description
Today `prepareDefinitionRunSettings` in `src/extension.ts` asks Jev for the difficulty tier and model/thinking-level picks *before* the defining agent runs (all three call sites: manual "Fill with AI" and the two AI-loop definition paths). Jev then judges an undefined card from its title alone. This card was itself judged "light" with an empty Description. Move the Jev step so it runs only once the card has a non-empty `## Description` and `## Acceptance criteria`. That way the tier is sized to the real scope. The prompt should stop telling the defining agent that Jev "already" chose. When Jev is available, the agent leaves the run settings alone and Jev fills them in after the definition. When Jev is unavailable or fails, the existing fallback still applies: the agent picks from the candidate lists itself. Fire-and-forget chat hand-offs have no completion signal, so they need an explicit trigger. One option is the board watcher seeing the card become defined. The other is the AI loop's next pass. Decide which during implementation and document it.

## Acceptance criteria
- [x] Jev is never called for a card whose `## Description` or `## Acceptance criteria` is empty. A unit test covers this guard.
- [x] In CLI definition runs (manual and AI loop), Jev is called after the agent CLI run completes and the card is defined. It reads the updated card file from disk.
- [x] Chat hand-off definitions get Jev picks once the card becomes defined, through the documented trigger. Card edits do not cause Jev to be called again and again.
- [x] The definition prompt no longer says Jev "already judged" the card. When Jev will run afterward, the prompt tells the agent not to set run settings. When Jev is unavailable, the prompt still asks the agent to choose from the candidates.
- [x] Existing non-empty `preferredModel.*` / `thinkingLevel.*` values are still preserved unless `overwriteExisting` is on. Jev failures still fall back without failing the definition.
- [x] The "Run settings recommended by Jev" Activity entry is written after the definition entry, not before it.
- [x] `npm run compile-tests`, `npm run compile`, `npm test`, and `npm run lint` pass.

## Activity
### 2026-10-03T12:11:37.854Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **light**.

- copilot: model `auto`, thinking level `low`
- codex: model `gpt-5.5`, thinking level `low`
- claude-code: model `haiku`, thinking level `low`

### 2026-10-03T12:11:38.267Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-03T12:29:26.356Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-03 - Claude Code: Jev moved after the definition
Model note: this card asked for `haiku`; I could not switch models from inside the session and ran as Claude Opus 5.5 (`claude-opus-5-5`).

- `src/cardRunSettings.ts`: added `planDefinitionRunSettings`, which decides with no network call whether Jev runs after the definition (enabled and `TYPESAFE_API_KEY` set) or the agent picks from the candidates. `DefinitionRunSettings.recommendation` is replaced by `mode`. `requestJevRunSettings` now refuses to call Jev unless `isCardDefined` holds. Added the `JevPendingDefinitions` tracker. The fallback Activity text now says no run settings were changed.
- `src/aiCards.ts`: in Jev mode the definition prompt says "Do not set run settings" and that Jev will choose afterward; it no longer says Jev "already judged". Agent mode still lists the candidates and asks the agent to choose.
- `src/extension.ts`: replaced `prepareDefinitionRunSettings` with `planDefinitionRunSettingsForCard` (before the run) and `applyJevRunSettingsAfterDefinition` (after the run). The latter calls `store.reload()` to read the card file from disk, skips undefined cards, keeps existing keys unless `overwriteExisting` is on, and appends the Jev Activity entry after the definition entries. Manual and AI-loop CLI definitions call it once the CLI completes.
- Trigger chosen for chat hand-offs: the board-store `onDidChange` observer, which sees every file-watcher reload. The AI loop's next pass was rejected because manual "Fill with AI" has no loop. The card is registered before the hand-off with a snapshot of its Description and Acceptance criteria, and fires once the first time it is defined with different content. It is then forgotten, so later edits never call Jev again. The decision is documented in the module header of `src/cardRunSettings.ts`.
- `package.json`: corrected the `defineUseJev` setting description.
- Tests (`test/unit/cardRunSettings.test.ts`): Jev guard for empty Description and/or Acceptance criteria with no fetch, the plan modes, the Jev-mode prompt, the fire-once trigger, and the already-defined-at-hand-off case.
- Validation: `npm run compile-tests`, `npm run compile`, `npm test` (562/562 pass), and `npm run lint` all pass. No Development Host smoke test was run.
STATUS: DONE

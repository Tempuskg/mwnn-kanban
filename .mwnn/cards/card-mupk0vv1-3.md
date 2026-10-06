---
id: card-mupk0vv1-3
title: Have a command where I can list/edit the preferred models and thinking levels
column: col-mqwk2njn-4
position: -53000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-4.6
preferredModel.codex: gpt-5.5
preferredModel.claude-code: sonnet
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1790860368205
updatedAt: 1791245396854
---

## Description
Add a command-palette command, **MWNN Kanban: Manage Agent CLI Models and Thinking Levels**, that lists and edits the per-CLI model lists and thinking levels, so nobody has to hand-edit `settings.json`. The command covers the two settings that `Populate Agent CLI Models and Thinking Levels` writes: `mwnn-kanban.agentCliModels` and `mwnn-kanban.agentCliThinkingLevels`.

Flow, built from extension-host quick picks and input boxes with no webview:
1. Pick a settings scope (Workspace when a folder is open, or User), the same way the populate command does.
2. See all four providers (`copilot`, `codex`, `claude-code`, `cursor`), each with its default model (the first list entry), the number of other models, and its thinking level. A provider with nothing configured shows that it uses the CLI's own default.
3. Pick a provider, then edit its models or its thinking level. Models: add, remove, or make an entry the default (move it first). Thinking level: set the level used, add or remove suggested levels, or clear it.
4. Each change is written to the chosen scope at once, and the board's model and effort pickers refresh through the existing configuration listener.

The listing also shows any stage overrides from `agentCliStageModels` and `agentCliStageThinkingLevels` as read-only entries, plus an "Open in Settings" item. Editing stage overrides, per-card `preferredModel.*` / `thinkingLevel.*` keys, and CLI discovery are out of scope.

Keep the list-editing rules (add, remove, make default, trim, de-duplicate, drop an emptied provider) in a pure module with unit tests, so `extension.ts` only asks and writes.

## Acceptance criteria
- [x] `package.json` contributes a `mwnn-kanban.*` command titled "Manage Agent CLI Models and Thinking Levels" in category "MWNN Kanban". It is registered in `src/extension.ts` at every site where `populateAgentCliModels` is registered.
- [x] The command asks for Workspace or User scope (Workspace only when a folder is open) and reads and writes only that scope's value, through `inspect()`. A value from the other scope is never copied in.
- [x] The overview lists all four providers. Each one shows its default model (or "CLI default" when unset), its other models, and its thinking level (or "CLI default" when unset). Cursor's thinking level is labelled as not applied by that CLI.
- [x] The overview shows configured `agentCliStageModels` / `agentCliStageThinkingLevels` overrides as read-only entries, and includes an item that opens the `mwnn-kanban` settings.
- [x] Models: the user can add a model, remove a model, and make a model the default by moving it to first place. Blank or whitespace-only input is rejected, a name already in that provider's list is rejected, and entries are trimmed.
- [x] Removing a provider's last model deletes that provider's key from `agentCliModels` instead of writing an empty array. Other providers' entries stay unchanged.
- [x] Thinking level: the user can set the level used (stored first), add or remove suggested levels, and clear the provider. A single level is written as a string, several as an array whose first entry is the level used, and clearing removes the provider key.
- [x] Every edit is written with `config.update` to the chosen scope at once. An open board's card model and effort pickers show the new values without a reload.
- [x] Cancelling any quick pick or input box at any step writes nothing.
- [x] The list-editing logic is in a pure module with no `vscode` import, covered by unit tests: add, duplicate rejection, blank rejection, remove, emptied provider dropped, make default, thinking-level string/array shape, and clear. `npm run compile-tests`, `npm run compile`, `npm test`, and `npm run lint` all pass.
- [x] Development Host smoke test: run the command, add a Claude Code model, make it the default, set a Codex thinking level, then remove both. Confirm `settings.json` and the open board's card pickers reflect each step.

## Activity
### 2026-10-05T22:05:15.456Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-05T22:06:34.992Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **standard**.

- copilot: model `claude-sonnet-4.6`, thinking level `high`
- codex: model `gpt-5.5`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`

### 2026-10-05T22:33:51.639Z - Auto-start held in Ready
Assigned to AI, but the card stays in Ready: "Ready" has 1 of its 3 defined cards (reverse WIP) and Backlog still has cards to define.

### 2026-10-05T22:33:57.921Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-10-05 - Claude Code: implemented Manage Agent CLI Models and Thinking Levels
- Ran on Claude Opus 5.5 (claude-opus-5-5): the card asks for `sonnet`, but this session could not switch models.
- New pure module `src/agentCliSettingsEditor.ts` (no `vscode` import) holds the editing rules: add, remove, make default (move first), trim, blank and duplicate rejection, dropping an emptied provider key (and removing the whole setting from the scope when the map is empty), and the thinking-level shape (one level as a string, several as an array with the level used first). It also builds the overview text, including Cursor's "not applied by this CLI" label. Unknown keys and other providers are copied through untouched.
- Added `test/unit/agentCliSettingsEditor.test.ts` with 19 tests covering every rule listed in the criteria.
- `src/extension.ts`: added `manageAgentCliModels()`, registered as `mwnn-kanban.manageAgentCliModels` at both sites that register `populateAgentCliModels`. Flow: pick Workspace or User scope (Workspace only when a folder is open), see the four providers, the read-only stage overrides, and Open in Settings, then use a per-provider menu to add, remove, or make a model the default, or to set the level used, add or remove a suggested level, or clear the level. Values are read through `inspect()` for that scope only, and each edit is written at once with `config.update(..., scope.target)`. Escape at any step writes nothing.
- `package.json`: contributed the command (category "MWNN Kanban") and added it to the command palette.
- Validation: `npm run compile-tests`, `npm run compile`, `npm test` (615/615 passed), and `npm run lint` all pass.
- Not done: the Development Host smoke test. A live check that an open board's pickers refresh needs a person in VS Code. The refresh should come from the existing `onDidChangeConfiguration` listener for `agentCliModels` and `agentCliThinkingLevels`, but this has not been seen working, so those two criteria stay unchecked.
STATUS: BLOCKED: needs a human Development Host smoke test (run the command, add a Claude Code model and make it the default, set a Codex thinking level, remove both, and check settings.json and the open board's pickers after each step)

### 2026-10-05 - Claude Code: smoke test confirmed
- Packaged the VSIX and installed it into the user's VS Code. The user ran the Development Host smoke test (added a Claude Code model and made it the default, set a Codex thinking level, then removed both) and reported that settings.json and the open board's pickers updated as expected at each step.
STATUS: DONE

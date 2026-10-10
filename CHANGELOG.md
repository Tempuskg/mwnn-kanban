# Changelog

All notable changes to MWNN Kanban are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [1.0.1] - 2026-10-10

### Fixed
- Pro: the Portfolio dashboard now keeps tracked hours current. It refreshes when the shared store changes and when the window regains focus. While the dashboard is visible, it also re-reads every 30 seconds in case a change made in another editor or window was missed.

## [1.0.0] - 2026-10-10

### Added
- **Agent CLI Models** panel: use the gear in the MWNN sidebar to edit ordered model lists, thinking levels, and per-stage/per-CLI AI-loop overrides in Workspace or User settings. Inherited values are shown separately, edits affect only the selected scope, and settings changes refresh the panel and open board pickers. The existing quick-pick manager also edits stage/CLI overrides. Legacy shared stage strings remain readable; conversion preserves the unedited CLIs, model and effort resolve independently after provider selection, and clearing restores scope inheritance.
- **Start interview** for any defined Human card: from the card's actions or details, open an interactive AI chat (Copilot, Codex or Claude Code) that asks one question at a time and records each answer, with its source and date, in the card and its linked facts. Starting again resumes from the saved answers. The card stays assigned to Human, the AI loop never picks it up, and starting a chat never checks acceptance criteria or completes the card.
- Injected CLI portfolio-loop capability for Pro: unopened-board execution shares the public card lifecycle, provider/model rules, credit fallback and dispatch accounting, with exclusive loop ownership in the current window.
- **Usage Orchestrator**: a new `orchestrator` value for `mwnn-kanban.aiLoopProvider`, also offered in the AI loop's local-CLI picker and the `Run Card with AI` picker. Before each dispatch it reads every installed CLI's remaining usage and reset time from that CLI and picks one. It spends the allowance that resets soonest first, then drains CLIs whose usage is unknown, then picks the CLI with the most usage left. In the AI loop, a stage that runs out of credits is retried on the next-ranked CLI. Codex usage is read through `codex app-server`; Claude Code and Copilot usage sources are pending, and Cursor's usage is always unknown.

### Changed
- During an orchestrated AI Loop, the selected CLI now uses that stage's effective user/workspace model preference ahead of the card's preferred model. If no stage model is configured for that CLI, it falls back to the CLI's workspace model default, then the CLI's own default.

### Fixed
- Handing a card to a chat provider that only supports the clipboard now copies the prompt and opens that chat. Previously it reported success without doing either.
- The board no longer shows a CLI as running when the Usage Orchestrator reports model metadata after that process has exited.
- Jev and the defining agent no longer recommend a model the CLI has refused for your account. A CLI's model list can include models your plan cannot use; when a dispatch is refused, that model is remembered and left out of run-settings recommendations for that CLI. The record clears when the model later completes a run, or after 30 days.

## [0.0.15] - 2026-10-04

### Added
- Assigning a card in Ready to AI now starts it automatically: the card moves to the end of In Progress. The move follows the same admission rules as any other move: unfinished dependencies, the In Progress WIP limit, and Ready's reverse WIP. If the move is refused, the card stays in Ready and the reason is recorded in its Activity.
- Starting an implementation run on a Ready card assigns the card to AI and moves it to In Progress under the same rules. If the move is refused, the run still goes ahead.
- When a card is defined with AI, the agent may split a card that covers several independently deliverable slices. The original card keeps the first slice, and each further slice becomes a new card next to it in the same column.
- Clicking the "Needs definition" chip on a card opens the card and offers to fill in its definition with AI.
- Hovering over or focusing a blocked card's chip highlights the cards that are blocking it.

## [0.0.14] - 2026-10-04

### Added
- The AI loop can be paused. The sidebar now has Play, Pause, and Stop controls under an "AI Loop" label, and there is a new command `MWNN Kanban: Pause AI Loop`. Pausing never interrupts work: the card stage in progress finishes first, and the loop then holds before its next action. Play resumes the same run, and Stop ends it whether it is running or paused. The controls enable and disable to match the loop's state.

### Changed
- Changing a card's column in the card editor now puts the card at the top of the new column instead of the bottom.

## [0.0.13] - 2026-10-03

### Added
- New command `MWNN Kanban: Populate Agent CLI Models and Thinking Levels` finds the models and thinking levels offered by the agent CLIs installed on this machine, and fills `mwnn-kanban.agentCliModels` and `mwnn-kanban.agentCliThinkingLevels` from them. It works without a folder open, in which case only user settings are offered.
- Thinking levels now reach GitHub Copilot CLI and Claude Code CLI, as `--effort <level>`, as well as OpenAI Codex CLI. Cursor Agent CLI still takes no effort argument: a level set for it is reported on the card and the run uses that CLI's default effort. Each CLI in `mwnn-kanban.agentCliThinkingLevels` takes either one level or a list. The first entry in a list is the level used, and the rest are offered as suggestions in the card's thinking field.
- When a card is defined with AI, TypeSafe's Jev model can choose its preferred model and thinking level for each CLI, picking only from names already in `mwnn-kanban.agentCliModels` and `mwnn-kanban.agentCliThinkingLevels`. Jev runs only once the card has a Description and Acceptance criteria, so its difficulty judgment uses the written scope rather than the title alone. It runs once per definition, and later card edits never trigger it again. Turn it on or off with `mwnn-kanban.defineUseJev`; it also requires the `TYPESAFE_API_KEY` environment variable. Without Jev, the defining agent picks from the same names. If Jev fails, the card's run settings are left as they were and the definition still stands. A model or level already set on a card is kept unless `mwnn-kanban.defineOverwriteRunSettings` is on.
- Pro: new command **Export Review Digest** saves a local Markdown summary of the Portfolio for a weekly, fortnightly, or monthly review. Tracked hours and completed cards get separate sections, and each compares against the previous period. Requires `@tempuskg/mwnn-kanban-pro` 0.1.13.
- Pro: projects can be opened directly from the Portfolio. A click opens the project in the current window, and Ctrl-click or Cmd-click opens it in a new window. Requires `@tempuskg/mwnn-kanban-pro` 0.1.12.

### Changed
- The card model and thinking-level pickers on the board are easier to use.
- Pro: **Export Timesheet** and **Export Review Digest** open the saved file in an editor once it has been written. Requires `@tempuskg/mwnn-kanban-pro` 0.1.13.

### Security
- The board and sidebar webviews now accept messages only from their own origin.

## [0.0.12] - 2026-09-26

### Added
- A card can name the *thinking level* (reasoning effort) it should be run at, once per agent CLI - a second axis of model selection that answers how hard the agent should think, not which model runs, so an effort choice no longer has to be hand-encoded into a model name. Set it beside the model on the card in the board, or write the optional `thinkingLevel.<provider>` frontmatter keys in the card file, where `<provider>` is `copilot`, `codex`, `claude-code`, or `cursor`. Workspace-wide equivalents are `mwnn-kanban.agentCliThinkingLevels` (a default per CLI) and `mwnn-kanban.agentCliStageThinkingLevels` (a rule per AI loop stage), resolved in the same order the model is: the card, then the stage rule, then the workspace default, then the CLI's own default effort. Values are free-form and passed to the CLI unchanged, an unknown provider key or a blank value is ignored, and both settings are empty by default so an untouched workspace dispatches exactly the arguments it did before. Only a CLI that exposes reasoning effort on its command line can honor a level - today that is OpenAI Codex CLI, as its `model_reasoning_effort` override - and on a CLI that cannot, the level is reported on the card and in a notification while the run proceeds at that CLI's default effort; a level that cannot be applied never fails a run.
- Every AI loop run now reports what it dispatched: how many agent handoffs it launched, broken down by stage and by the model each one actually ran on. The report is shown however the run ends - finished, cancelled, paused on spent credits, or stopped on budget - so a cancelled run still shows its partial tally. Usage and cost figures are only ever lines the CLI printed itself, quoted and attributed to that CLI; there is no built-in price table and nothing is estimated, so a CLI that reports nothing shows dispatch counts only.
- An optional per-run dispatch budget, `mwnn-kanban.aiLoopMaxDispatches`. It is `0` (disabled) by default, which leaves run length and behavior unchanged. Set a positive number to stop a run once it has launched that many handoffs, counting credit-fallback replacements and model-escalation retries. The cap is checked before a handoff starts, so no CLI is left running and the in-flight card is never advanced or half-dispatched; the reason is recorded in that card's Activity and named as the configured budget rather than spent credits, and the notification says how to raise or clear the cap.
- The AI loop can retry a card stage on a stronger model when the attempt does not finish. Opt in with `mwnn-kanban.aiLoopModelEscalationEnabled` and order the models per CLI, cheapest first, in `mwnn-kanban.aiLoopModelEscalationLadder`. Only an inconclusive attempt escalates - a `STATUS: BLOCKED` report, or a clean exit with no stage completion evidence - so spent credits, authentication errors, network failures, cancellation, and a rejected model name all keep the existing single-attempt behavior. The retry gets the same card, workspace, and stage instructions plus the reason it was escalated; an escalation never advances a card by itself, each model is tried at most once per card per loop run, and switching CLI on spent credits costs no escalation step and re-resolves the ladder for the replacement CLI. A model the card names for the active CLI is left alone unless `mwnn-kanban.aiLoopModelEscalationOverridesCardModel` is on. Every escalation appears in loop progress and in the card's Activity.
- A model per AI loop stage, in `mwnn-kanban.agentCliStageModels`, so the short definition and triage stages need not run on the model the workspace uses for implementation. The keys are the loop stages themselves - `definition`, `triage`, `implementation`, `verification` - not column titles, so renaming a column cannot break a rule. `Run Card with AI` uses the `implementation` rule, and filling in a card definition uses the `definition` rule. Resolution order is the model the card names for the active CLI, then the stage rule, then the workspace default in `mwnn-kanban.agentCliModels`, then the CLI's own default model; the setting is empty by default, so an untouched workspace behaves exactly as before. A stage rule the active CLI rejects is reported the same way a rejected card model is, and is never mistaken for spent credits.
- A workspace default AI model per agent CLI, in `mwnn-kanban.agentCliModels`. Each provider takes a list of model names: the first entry is the model used for `Run Card with AI` and every AI loop stage when a card names no model for that provider, and the rest are that provider's other known models. A model the card names for that provider always wins, the default is never written into the card file, and a provider with no configured entry still runs its own default model with no model argument added. Because model names are provider-specific, a default configured for one CLI is never used for another - including when the CLI credit fallback switches providers mid-run, where the replacement's own default applies and is recorded with the switch on the card.
- A card can name the AI model it should be run with, once per agent CLI. Set **Preferred AI model per CLI** on the card in the board - pick the CLI, then pick one of the models configured for it in `mwnn-kanban.agentCliModels` or type any other name - or write the optional `preferredModel.<provider>` frontmatter keys in the card file, where `<provider>` is `copilot`, `codex`, `claude-code`, or `cursor`. The model is scoped per CLI because a card never chooses the CLI it runs on - the CLI is picked at dispatch and the credit fallback can swap it mid-run - and model names are CLI-specific, so one name would be rejected by every CLI but the one its author had in mind. Each value is free-form and the entry for whichever provider actually runs is passed straight through to that CLI as its model argument for `Run Card with AI` and for every AI loop stage, or stated in the hand-off prompt when a chat provider is used instead; a chat hand-off states only the model for its own provider. A provider the card names no model for is unchanged: the CLI's own default model is used and no model argument is added. The suggestions are a shortcut past remembering each CLI's spelling, never a restriction: a name that is not in the list - a model newer than the extension, or a BYOK name - is saved and dispatched exactly as typed, a CLI with nothing configured simply gets no suggestions, and clearing the field removes only that CLI's entry. Editing the configured list in settings updates an open board immediately. An unknown provider key and a blank value are ignored rather than stored, and never make a card file unreadable. A provider that cannot accept a model selection, and a model a CLI rejects, are both reported rather than passing silently, and when the credit fallback switches CLI the replacement uses its own entry - or its own default - and never the exhausted CLI's model. A card written with a single bare `preferredModel` scalar still works: it applies to every provider it does not scope explicitly, and is migrated to the per-provider keys the next time the extension writes that card.
- The AI loop can continue on another agent CLI when the active CLI runs out of credits or hits a usage/session limit. Opt in with `mwnn-kanban.aiLoopCliFallbackEnabled` and order the replacements in `mwnn-kanban.aiLoopCliFallbackOrder`. The replacement retries the same card stage with the latest card contents and an explanation of the interruption; only genuine credit/usage-limit failures switch, each provider is tried at most once per run, and the loop pauses instead of cycling when no eligible CLI is left. Every switch appears in loop progress and in the card's Activity.
- Pro: board cards show the hours tracked against them. The badge is display-only, and cards with no tracked time show nothing rather than `0h`. Turn it off with `mwnn-kanban-pro.showCardTrackedHours`. Pro sets the badges through a new optional `setCardBadges` member of the board capability. Requires `@tempuskg/mwnn-kanban-pro` 0.1.11.
- Pro: the Portfolio Flow section shows where cycle time goes, as one bar per project split into the median time a completed card spent in each column role. Cards that cannot be split are listed with the reason. Requires `@tempuskg/mwnn-kanban-pro` 0.1.11.

### Changed
- Pro: VS Code, VS Code Insiders, Cursor, and other VS Code-family editors on one machine now share one Pro store, so Portfolio, Allocation, Output, timesheet, and My Work show the same projects and hours in every editor. Existing per-editor Pro data is merged in automatically on first start without duplicates, and the old folders are left untouched. The data stays local and is never transmitted. Requires `@tempuskg/mwnn-kanban-pro` 0.1.11.

### Fixed
- Pro: two windows or editors editing the project list at the same moment no longer lose one of the changes. Requires `@tempuskg/mwnn-kanban-pro` 0.1.11.

## [0.0.11] - 2026-09-12

### Added
- Pro: the Portfolio Flow section now charts aging work in progress. Cards currently in an in-progress column are plotted by how long they have been there, with p50 and p85 markers over today's ages. Cards first observed already in progress are reported as explicit unknown-age coverage rather than dated from the first event that mentions them, and backfilled events and column re-roles no longer reset an age. Requires `@tempuskg/mwnn-kanban-pro` 0.1.10.
- Pro: the My Work queue now ranks in-progress cards by age within each project and shows that age beside debt hours, marking any card at or past the p85 of today's in-progress ages. Project order still follows debt. Requires `@tempuskg/mwnn-kanban-pro` 0.1.10.

### Changed
- The marketplace description no longer describes Pro license validation, which does not apply to the free extension: "An in-editor MWNN Kanban board. No usage, board, or time data is transmitted."

## [0.0.10] - 2026-09-06

### Added
- Pro: cycle-time charts now show readable logarithmic duration gridlines, mark approximate timings, and call out thin sample coverage. Requires `@tempuskg/mwnn-kanban-pro` 0.1.9.

### Fixed
- Pro: cycle-time history now distinguishes cards that were never observed entering In Progress from out-of-order histories, so excluded-card reporting explains the actual data gap. Requires `@tempuskg/mwnn-kanban-pro` 0.1.9.

## [0.0.9] - 2026-09-01

### Added
- Pro: Portfolio Allocation and Timesheet now count eligible work outside VS Code from external project-file changes and Claude Code transcript heartbeats, including read-heavy Claude sessions that do not continuously modify workspace files. Requires @tempuskg/mwnn-kanban-pro 0.1.8.

### Fixed
- Pro: open Portfolio and Timesheet dashboards now refresh after local writes and cross-window Pro store changes. Requires @tempuskg/mwnn-kanban-pro 0.1.8.

## [0.0.8] - 2026-08-30

### Added
- Pro: a `Portfolio` button in the MWNN Kanban sidebar view opens the Pro Portfolio dashboard, alongside the existing `Open Board`, `Import plan`, and `Run AI loop` buttons. It is rendered only while a Pro license or live trial is active — the same signal behind `mwnn-kanban.hasProLicense` — and appears or disappears in the open sidebar as a license key is entered or cleared. Unlicensed users see the sidebar unchanged, with no button and no upsell.
- Pro: the Portfolio dashboard's Allocation rows now take an inline Target % edit, written straight to the project registry. The bar keeps showing the normalized share, and a "Targets total N%; shares are normalized" hint states the relationship. Requires @tempuskg/mwnn-kanban-pro 0.1.6.
- The GitHub Copilot CLI provider now prefers standalone `copilot` and falls back to GitHub CLI's modern `gh copilot` passthrough for both AI-loop and per-card runs, while rejecting the retired suggestion/explanation extension.
- Pro license commands for purchasing, entering, inspecting, and clearing a key, with validated status published through `mwnn-kanban.hasProLicense` for gated UI surfaces.
- Card Activity can now be edited as multiline Markdown from the card details view, including clearing saved Activity or discarding an unsaved draft, with changes persisted to the card file.
- Card details now offer an accessible copy-path action that copies the card's absolute Markdown file path and reports clipboard success or failure in the dialog.

### Changed
- Pro background activity tracking is now enabled by default, so registered-project work performed by agents and other processes continues to accrue while VS Code is unfocused. Set `mwnn-kanban-pro.trackWhenUnfocused` to `false` to opt out. Requires @tempuskg/mwnn-kanban-pro 0.1.7.
- The extension now activates after VS Code startup without creating `.mwnn` board files in an untouched workspace; board storage is created on the first board mutation.

- Cursor Agent CLI handoffs now deliver the full prompt on Windows: the `cursor-agent.cmd` PowerShell shim is unwrapped to `node.exe` so stdin is not dropped, and a temp prompt-file pointer is used only when that layout is unavailable.
- Every board-opening entry point now reveals the single live MWNN Kanban panel, while panel closure and session restoration safely create or adopt only one replacement.

## [0.0.1] - 2026-08-08

### Changed
- AI-loop progress now appears in the VS Code status bar so it remains visible without covering the built-in chat composer or submit button.
- AI implementation handoffs now keep acceptance-criteria checkboxes current, and a completed loop synchronizes any remaining unchecked items before moving the card to verification.
- AI Loop provider selection again offers supported VS Code chat extensions alongside local agent CLIs, with regression coverage for both execution channels and the contributed setting values.

### Added
- Optional AI-loop verification in the Verify column through `mwnn-kanban.aiLoopVerifyCards` (off by default): only a passing verification moves a card to Done; failures and work the agent cannot verify stay in Verify and return to a human with the reason recorded.
- Live feedback while a local agent CLI runs a card: the full CLI output streams into a new `MWNN Agent CLI` output channel (with a `Show Output` action on outcome notifications), the progress notification and AI-loop status-bar entry show the latest output line, and the board webview badges the active card with the running provider and a live output ticker.
- The per-card `Run Card with AI` and `Fill in with AI` provider pickers now also offer the four local agent CLIs (GitHub Copilot CLI, OpenAI Codex CLI, Anthropic Claude Code CLI, Cursor Agent CLI) alongside the chat extensions, running the selected CLI headlessly in the workspace root with cancellable progress, the shared handoff Activity trail and evidence validation, and `mwnn-kanban.agentCliPaths` overrides.
- Local AI-loop providers for GitHub Copilot CLI, OpenAI Codex CLI, Anthropic Claude Code CLI, and Cursor Agent CLI, with shared executable discovery, synchronous card evidence validation, failure reporting, and active-process cancellation.
- Settings `mwnn-kanban.aiLoopProvider` and `mwnn-kanban.agentCliPaths` for provider selection and executable path overrides, including paths containing spaces.
- Initial Kanban board webview with columns, cards, drag-and-drop, and per-workspace persistence.
- Commands: `MWNN Kanban: Open Board`, `Add Column`, `Reset Board`.
- Settings: `mwnn-kanban.defaultColumns`, `mwnn-kanban.confirmCardDeletion`.
- AI definition fill: dragging an undefined card into a Ready column offers to have AI write its Description and Acceptance criteria, and the card detail panel shows a "Fill in with AI" button when both are empty. Requests are handed off to the available AI chat extension and recorded in the card Activity log.
- Card dependencies: a card can depend on one or more other cards (chosen from the board in its detail view). Dependencies are persisted to the card's `dependsOn` frontmatter, a "Blocked" indicator appears while any dependency is not yet in a Done column, and deleting a card removes it from other cards' dependency lists.
- Board panel persistence: if the board panel was open when VS Code closed or the window was reloaded, it reopens automatically on the same workspace (restored to its previous editor column) via a registered `WebviewPanelSerializer`. A restored panel reuses the existing board singleton, so it shows live store state, reflects external file changes, and supports every action exactly like a freshly opened panel.

[Unreleased]: https://github.com/Tempuskg/mwnn-kanban/compare/v0.0.10...HEAD
[0.0.10]: https://github.com/Tempuskg/mwnn-kanban/releases/tag/v0.0.10
[0.0.9]: https://github.com/Tempuskg/mwnn-kanban/releases/tag/v0.0.9
[0.0.8]: https://github.com/Tempuskg/mwnn-kanban/releases/tag/v0.0.8
[0.0.1]: https://github.com/Tempuskg/mwnn-kanban/releases/tag/v0.0.1

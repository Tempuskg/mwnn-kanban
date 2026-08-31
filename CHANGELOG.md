# Changelog

All notable changes to MWNN Kanban are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

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

[Unreleased]: https://github.com/Tempuskg/mwnn-kanban/compare/v0.0.8...HEAD
[0.0.8]: https://github.com/Tempuskg/mwnn-kanban/releases/tag/v0.0.8
[0.0.1]: https://github.com/Tempuskg/mwnn-kanban/releases/tag/v0.0.1

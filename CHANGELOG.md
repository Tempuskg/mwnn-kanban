# Changelog

All notable changes to MWNN Kanban are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Changed
- AI-loop progress now appears in the VS Code status bar so it remains visible without covering the built-in chat composer or submit button.
- AI implementation handoffs now keep acceptance-criteria checkboxes current, and a completed loop synchronizes any remaining unchecked items before moving the card to verification.
- AI Loop provider selection again offers supported VS Code chat extensions alongside local agent CLIs, with regression coverage for both execution channels and the contributed setting values.

### Added
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

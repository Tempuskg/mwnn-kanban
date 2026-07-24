# Changelog

All notable changes to MWNN Kanban are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Changed
- AI-loop progress now appears in the VS Code status bar so it remains visible without covering the built-in chat composer or submit button.

### Added
- Initial Kanban board webview with columns, cards, drag-and-drop, and per-workspace persistence.
- Commands: `MWNN Kanban: Open Board`, `Add Column`, `Reset Board`.
- Settings: `mwnn-kanban.defaultColumns`, `mwnn-kanban.confirmCardDeletion`.
- AI definition fill: dragging an undefined card into a Ready column offers to have AI write its Description and Acceptance criteria, and the card detail panel shows a "Fill in with AI" button when both are empty. Requests are handed off to the available AI chat extension and recorded in the card Activity log.
- Card dependencies: a card can depend on one or more other cards (chosen from the board in its detail view). Dependencies are persisted to the card's `dependsOn` frontmatter, a "Blocked" indicator appears while any dependency is not yet in a Done column, and deleting a card removes it from other cards' dependency lists.
- Board panel persistence: if the board panel was open when VS Code closed or the window was reloaded, it reopens automatically on the same workspace (restored to its previous editor column) via a registered `WebviewPanelSerializer`. A restored panel reuses the existing board singleton, so it shows live store state, reflects external file changes, and supports every action exactly like a freshly opened panel.

# MWNN Kanban board files

This folder is the source of truth for the MWNN Kanban board in this workspace.

## Files

- `columns.json` stores the ordered column layout, roles, and WIP or reverse-WIP limits.
- `cards/<card-id>.md` stores one card per markdown file with frontmatter for column, position, assignee, and timestamps.
- `README.md` documents the contract for humans and AI agents editing the board directly.

## Card workflow

1. Find work in `cards/*.md`, usually filtering for `assignee: { kind: ai, ... }` when an AI agent is involved.
2. Add or update the `## Activity` section to claim work and report progress.
3. Update the `## Description` and `## Acceptance criteria` sections as the slice becomes better defined or completes.
4. Move a card by editing its `column` and `position` frontmatter values. When the destination column's `role` is `done`, place the card at the top: assign a `position` strictly less than every other card already in that column (step ~1000 before the current minimum) and leave the relative order of the other Done cards unchanged. For non-`done` columns, append after the current maximum unless a specific order is required.
5. Respect column `wipLimit` values and the Ready column `reverseWip` minimum from `columns.json`.

The extension watches this folder and reloads the board after external edits.

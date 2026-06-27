# MWNN Kanban Wiki — Schema & Conventions

This file defines how the LLM maintains the wiki for the **mwnn-kanban** VS Code extension project, and the coding-agent workflow for this repo. It is the authoritative reference for structure, workflows, and conventions.

## Coding Agent Workflow

For `/implement`, `/proceed`, direct implementation requests, or generated implementation handoffs in this repo:

1. Read `AGENTS.md`, `.github/copilot-instructions.md`, any repo-local AI control files, and any referenced analysis report before the first edit. Read `package.json` only when the task depends on commands, contribution points, versioning, or release metadata.
2. Acknowledge any user-referenced external instruction file and state whether it is accessible from the current workspace, applied, ignored, or out of repo scope.
3. Run `git status --short` and a scoped `git diff -- <candidate files>` before broad diagnostics or edits.
4. Before the first edit, use at most one repo-wide search and one targeted search. Prefer owner-file reads over broad exploration, skip directory listings when exact paths are already known, and avoid subagents unless blocked or intentionally parallelized.
5. Identify the surface before editing: extension-host (Node + `vscode` API) vs. webview (DOM, no Node/vscode). Changes that cross the boundary must update the shared message-protocol types on both sides.
6. After preflight, make the smallest safe edit in the same turn or state one concrete blocker. Investigation-only implementation turns are not sufficient.
7. Once an owner file is identified, stop adjacent filename fishing and only reopen the same hotspot with a new hypothesis.
8. If workspace access is unavailable, reply once with the blocker and one recovery path: request full access, ask for pasted files, or generate a handoff prompt.
9. Validate in this order when applicable: touched-file diagnostics, `npm run compile-tests`, `npm run compile`, focused relevant tests, `npm test` (Node built-in runner over `dist-test/`), `npm run lint`, then a Development Host smoke test for interactive board/webview behavior. If `dist-test` disagrees with source, rebuild before diagnosing deeper.
10. For renames, enumerate command-palette commands, view/menu titles, configuration keys, webview message types, tests, docs/wiki, plans, and AI control files. Ask whether the rename applies to all surfaces before editing. Do one final stale-reference sweep before reporting done.
11. Delay `README`, `wiki`, and `CHANGELOG` edits until command names and UX are stable unless the user explicitly asks for docs now.
12. Batch progress into milestone summaries instead of progress-only narration unless blocked or waiting for input.
13. Analysis recommendations may target only repository-local AI control files: `AGENTS.md`, `.github/copilot-instructions.md`, and when present `CLAUDE.md`, `*.instructions.md`, `*.prompt.md`, `*.agent.md`, `SKILL.md`, and similar local AI instruction files. If evidence is insufficient, say so instead of recommending source, test, build, or general documentation changes.
14. Re-read local AI instructions, and re-read `package.json` only when the task depends on repo metadata such as commands, contribution points, versioning, or release flow. Do not reuse commands, conventions, or assumptions from memory or another repo.
15. Use memory or auxiliary tool reads only when the retrieved state changes the next step. Prefer targeted existence checks over broad wildcard scans.

## Quick Start / Known Constraints

- Start with `AGENTS.md` and `.github/copilot-instructions.md`. Read `package.json` only when the task depends on commands, contribution points, versioning, or release metadata.
- Start with `git status --short`, then a scoped `git diff -- <candidate files>` before broader diagnostics.
- Common owner files (once the source exists) are expected to be `src/extension.ts`, the board panel and store modules under `src/`, the webview UI under `src/webview/`, the shared message-protocol types in `src/types.ts`, `package.json`, and the nearest unit tests.
- Webview UX changes need a Development Host smoke test; they rarely surface in unit tests.
- Strict optional-property typing is active in this repo, so omit optional keys rather than passing `undefined`.
- Repo type: VS Code extension. For patch version bumps, prefer `npm run version:build`. For explicit version sets, use the documented exact `npm version` path without automatic git tag or commit creation.
- Release-relevant files are `package.json`, `package-lock.json`, `README.md`, and any `scripts/bump-package-version.cjs`. Verify only the expected release files for versioning tasks.
- Defer `README.md`, `wiki/`, `CHANGELOG.md`, and plan/status-file sync until the changed surface passes one green targeted validation step, unless the user explicitly asks for docs now.
- Use plain relative file paths in summaries and handoffs.

## MWNN Board Contract

The extension stores the live board in a workspace folder instead of VS Code memento storage. This file contract is the primary integration surface for humans and AI agents collaborating on the same board.

- Board location: the workspace-relative folder from `mwnn-kanban.boardFolder`. The default is `.mwnn/`.
- Source of truth: the filesystem under that folder. The extension watches it and reloads the open board after external edits.
- Files written by the extension:
  - `.mwnn/columns.json` stores ordered columns, roles, and limit metadata.
  - `.mwnn/cards/<card-id>.md` stores one card per file.
  - `.mwnn/README.md` is a local copy of the board contract for direct editors inside the workspace.

`columns.json` shape:

```json
{
  "version": 2,
  "columns": [
    {
      "id": "col-ready",
      "title": "Ready",
      "role": "ready",
      "wipLimit": null,
      "reverseWip": 3
    }
  ]
}
```

Card file shape:

```md
---
id: card-abc123
title: Add login form
column: col-ready
position: 1000
assignee: { kind: ai, name: Codex }
createdAt: 1719360000000
updatedAt: 1719363600000
---

## Description
What the slice is.

## Acceptance criteria
- [ ] Ship the behavior

## Activity
- 2026-06-27 Codex: claimed
```

Rules for direct board edits:

- Treat `columns.json` and `cards/*.md` as the only canonical board state. Do not look for task state in workspace memento.
- Move a card by editing its `column` and `position` frontmatter. Column order lives only in `columns.json`.
- A card counts as "defined" for Ready reverse-WIP when `## Description` is non-empty.
- Respect `wipLimit` on flow columns and `reverseWip` on the Ready column when claiming or moving work.
- Prefer appending dated entries to `## Activity` when claiming, handing off, or reporting progress.
- AI agents should usually select work where `assignee.kind === 'ai'`, keep acceptance criteria current, and leave the board in a consistent state after edits.

---

## Directory Layout

```
mwnn-kanban/
├── AGENTS.md          # This file — wiki schema & LLM instructions
├── PLAN.md            # Project plan (reference, not wiki-managed)
├── raw/               # Raw source documents (immutable, LLM reads only)
│   └── assets/        # Images, diagrams, attachments
├── wiki/              # LLM-maintained wiki (markdown files)
│   ├── index.md       # Master index of all wiki pages
│   ├── log.md         # Chronological log of wiki operations
│   ├── overview.md    # Project overview & synthesis
│   └── ...            # Entity, concept, and topic pages
└── src/               # Extension source code
    └── webview/       # Webview UI source (no Node/vscode imports)
```

---

## Layers

### 1. Raw Sources (`raw/`)
- Immutable collection of source documents: plans, articles, research, transcripts, images.
- The LLM **reads** from `raw/` but **never modifies** files here.
- Images and attachments go in `raw/assets/`.

### 2. Wiki (`wiki/`)
- LLM-generated and LLM-maintained markdown files.
- The LLM **owns** this directory entirely — creates, updates, and deletes pages.
- The human reads and browses; the LLM writes and maintains.

### 3. Schema (`AGENTS.md`)
- This file. Defines conventions, page formats, and workflows.
- Co-evolved by human and LLM as the project grows.

---

## Page Conventions

### Filenames
- Lowercase, kebab-case: `board-state.md`, `card-model.md`
- Entity pages: named after the entity (e.g., `board-panel.md`)
- Concept pages: named after the concept (e.g., `drag-and-drop.md`)
- Source summaries: `source-{slugified-title}.md`

### Frontmatter
Every wiki page starts with YAML frontmatter:

```yaml
---
title: "Page Title"
type: overview | entity | concept | source-summary | comparison | analysis
created: 2026-06-26
updated: 2026-06-26
sources:
  - raw/plan.md
tags:
  - architecture
  - board
related:
  - wiki/overview.md
---
```

### Page Body
- Start with a `# Title` heading matching the frontmatter title.
- Use `## Section` headings for structure.
- Cross-reference other wiki pages using relative links: `[Board State](board-state.md)`.
- Cite raw sources with relative paths: `[PLAN.md](../raw/plan.md)`.
- Flag contradictions or open questions with a `> ⚠️ Note:` blockquote.
- Keep pages focused — one entity or concept per page. Split if a page grows beyond ~300 lines.

---

## Special Files

### `wiki/index.md`
- Master catalog of all wiki pages, organized by type.
- Each entry: `- [Page Title](filename.md) — one-line summary`
- Updated on every ingest or page creation. The LLM reads this first when answering queries.

### `wiki/log.md`
- Append-only chronological log. Each entry:
  ```
  ## [YYYY-MM-DD] operation | Subject
  Brief description of what was done.
  Pages touched: page1.md, page2.md, ...
  ```
- Operations: `ingest`, `query`, `lint`, `update`, `create`, `restructure`

---

## Workflows

### Ingest a New Source
1. Human places source document in `raw/`.
2. LLM reads the source, discusses key takeaways, and creates a `source-summary` page in `wiki/`.
3. LLM updates `wiki/index.md`, relevant existing pages, and flags contradictions.
4. LLM appends an entry to `wiki/log.md`.

### Query the Wiki
1. LLM reads `wiki/index.md`, then relevant pages, and synthesizes an answer with citations.
2. If the answer is substantial, LLM offers to file it as a new wiki page.
3. LLM appends a query entry to `wiki/log.md`.

### Lint the Wiki
1. LLM reviews pages for contradictions, stale claims, orphan pages, missing pages, and missing cross-references.
2. LLM reports findings, applies fixes with approval, and appends a lint entry to `wiki/log.md`.

---

## Tags Vocabulary
- `architecture` — system design, layers, components
- `board` — board, columns, lanes
- `card` — card model, fields, lifecycle
- `persistence` — board state storage, migration
- `webview` — VS Code webview UI, messaging
- `vscode-api` — VS Code extension APIs
- `ux` — user experience, drag-and-drop, interactions
- `types` — TypeScript types and interfaces
- `configuration` — user settings, options

---

## Notes
- The wiki is version-controlled via git alongside the source code.
- At small scale the index file is sufficient for navigation; no embedding-based search needed yet.

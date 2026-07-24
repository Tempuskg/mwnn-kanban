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

<!-- mwnn-kanban:skills:start -->
## MWNN Kanban skills

Guidance for importing plans into, and authoring cards for, the MWNN Kanban board.

### MWNN Plan Import

# MWNN Plan Import

Turn a written plan into one Backlog card per **genuine, actionable unit of
work**. A regex that treats every heading and bullet as a card is exactly the
failure to avoid — most lines in a real plan are structure, metadata, or
narrative, not tasks. Use judgment. Write cards using the companion **MWNN Card
Authoring** skill's file contract.

## Read the supplied path first

The handoff supplies the plan's local path. If it is workspace-relative, resolve
it from the current workspace root; if it is absolute, read it directly. Read
the file before touching `.mwnn/`. The extension does not parse or provide the
plan contents. If the path is missing, unreadable, invalid, or points to a
directory, create no cards and report the exact path and reason with
`STATUS: BLOCKED`.

## Import verification and idempotency

Treat an import as a repeatable synchronization, not a one-time append:

1. Before writing, inventory the existing cards and derive a stable import key
   for each actionable item from the source plan identity plus its location and
   normalized title. Search existing card `Activity`, description, and title
   for that key or an unambiguous equivalent scope.
2. Reuse an existing matching card and do not create a duplicate. If a match is
   ambiguous, stop that item for review rather than guessing. For new cards,
   record the import key and source item in `Activity` so a later import can
   recognize it.
3. After writing, count the actionable items, existing matches, and newly
   created cards. Verify that every intended item maps to exactly one card and
   record the mapping of import key to card `id` in the import handoff.
4. Validate every `dependsOn` reference against existing or newly created card
   ids, and check for self-dependencies or cycles. Confirm each card filename
   matches its frontmatter `id` and that all cards use the intended Backlog
   column.
5. Do not report the import as complete when counts, mappings, dependency
   references, or file identities do not reconcile; fix the discrepancy or
   report the specific unresolved item.

## What is a card

A card is a discrete slice of work someone could pick up and do next — a task, a
step, a deliverable, a fix. If a line does not describe work still to be done, it
is not a card.

## Do NOT make cards from

- Section / structural headings: Goal, Overview, Context, Background, Summary,
  Decisions, Data Model, Architecture, Design, Scope, Status, Milestones, Risks,
  Notes, Open Questions, Progress Log, Changelog, Verification, Testing, Files.
- Metadata lines: dates, authors, status/mode lines, labels.
- Narrative describing already-finished work: progress-log or changelog entries,
  past-tense "Completed …/Added …/Fixed …" notes, and any checklist item already
  marked done (`- [x]`).
- Bare file inventories — lists that only name files to touch.
- Code blocks, JSON/schema examples, tables of reference data.
- Generic parent headings whose sub-bullets are the real tasks (make cards from
  the sub-bullets, not the umbrella heading).

## Decompose with judgment

- One card per genuinely independent piece of work, in the order it appears.
- When a heading or numbered step has sub-bullets that are themselves the
  concrete steps, prefer the sub-steps as cards. When the sub-bullets are just
  clarifying detail for one unit of work, make a single card and put that detail
  in its `## Description`.
- Split a bundled line ("do X and Y") only when X and Y are truly separate
  deliverables; otherwise keep one card.
- Skip anything already done or purely informational.

## Card content

- `title` — a concise imperative summarizing the work; strip list markers,
  numbering, and checkbox syntax (`- [ ]`, `1.`, `*`).
- `## Description` — the item's own supporting detail (sub-bullets, prose) that
  clarifies scope; when the item has no extra detail, write a concise one-line
  explanation of the work rather than leaving it empty.
- `## Acceptance criteria` — a short markdown checklist (`- [ ] …`) of concrete,
  testable conditions that define "done" for this card, drawn from the item. Keep
  it tight — do not pad with filler — but do not leave it empty.
- `assignee` — set every card to `{ kind: ai }` or `{ kind: human }` based on the
  work: use `ai` for implementation, coding, refactoring, testing, or otherwise
  automatable work; use `human` for product or design decisions, reviews and
  sign-off, or manual/external steps that need a person. When genuinely unsure,
  prefer `{ kind: ai }`.
- `dependsOn` — capture real prerequisites between the cards you create. See
  **Dependencies** below.
- Place every card in the Backlog column (the column whose `role` is `backlog`,
  or the first column if none), preserving plan order via ascending `position`.

## Dependencies

Set `dependsOn` on a card when the plan says another item must be finished before
this one can start. A card is blocked until every id in its `dependsOn` reaches a
`done` column, and a blocked card cannot advance past Ready.

- Add a dependency when the plan implies a hard prerequisite: wording like
  "after", "once … is done", "depends on", "requires", "based on", or a
  foundation / earlier phase that a later item clearly builds on.
- Do **not** add a dependency just because one card is listed before another.
  Sequential order is not a prerequisite unless the later work genuinely cannot
  start until the earlier work is complete. When in doubt, leave `dependsOn` off.
- Because `dependsOn` references card ids, decide each card's `id` before writing
  so a later card can list an earlier card's id. Reference only ids of cards in
  this import (or existing board cards, if the plan continues prior work).
- Never make a card depend on itself, and never create a cycle (A → B → A) — both
  would leave the cards permanently blocked. Omit the `dependsOn` line entirely
  when a card has no prerequisites.

## When nothing qualifies

If the plan contains no genuine outstanding work items (e.g. it is all context,
or all already-completed log entries), create no cards and say so plainly rather
than inventing filler.

### MWNN Card Authoring

# MWNN Card Authoring

The MWNN Kanban board's source of truth is the workspace board folder (default
`.mwnn/`, configurable via `mwnn-kanban.boardFolder`). The extension watches that
folder and reloads the open board after external edits, so writing well-formed
card files is enough to add cards — do not call any API or command.

## Where cards live

- `<boardFolder>/columns.json` — ordered columns with `id`, `title`, `role`,
  `wipLimit`, `reverseWip`. Read it first to map a column to its `id`.
- `<boardFolder>/cards/<card-id>.md` — one card per file. The file's base name
  must equal the card's `id` (e.g. `card-abc123.md` holds `id: card-abc123`).
- Only touch files under the board folder. Never edit `columns.json` unless the
  task is explicitly about columns.

## Completion and re-dispatch preflight

Before creating, editing, or dispatching work for an existing card:

1. Read the card and `columns.json`; identify the card's current column `id`,
   title, and role. Do not infer status from the card title or from an old
   session summary.
2. Inspect the card's `## Activity` and every acceptance checkbox, then verify
   any claimed completion evidence in the repository (for example, the named
   files, focused tests, or build result).
3. If the card is in a done/completed column, or its acceptance criteria are
   already satisfied by current evidence, do not implement or dispatch it
   again. Preserve the existing card and record concise evidence in `Activity`
   only when the workflow requires a durable update.
4. If a prior dispatch is recorded but acceptance evidence is incomplete or
   contradictory, continue only with the unmet criteria and explain the gap in
   `Activity`; do not duplicate already completed work.
5. Create a new card only when the requested work is genuinely outside the
   existing card's scope. Link the new card to the existing card when a real
   dependency exists.

Treat acceptance evidence and the current board state as authoritative workflow
state. A prior assistant response, a timestamp, or an unchecked box by itself
does not prove completion.

## Card file shape

```md
---
id: card-abc123
title: Add login form
column: col-ready
position: 1000
assignee: { kind: ai }
createdAt: 1719360000000
updatedAt: 1719360000000
---

## Description
What the slice of work is.

## Acceptance criteria
- [ ] A verifiable condition

## Activity
```

### Frontmatter fields

- `id` (required) — unique across the whole board. Use `card-<base36-ms>-<n>`,
  e.g. `card-mqwtekyi-2`. Never reuse an id that already exists in `cards/`.
- `title` (required) — the card's one-line title.
- `column` (required) — a real column `id` from `columns.json` (e.g.
  `col-mqwk2njn-1`), **not** the column title.
- `position` (required) — an integer that orders the card within its column,
  ascending. New cards go **after** the current maximum position in that column,
  stepping by ~1000 (so if the column's largest position is 4000, use 5000, 6000,
  …). This preserves the order in which you write them.
- `createdAt` (required) — Unix epoch milliseconds.
- `updatedAt` (optional) — Unix epoch milliseconds; usually equal to `createdAt`
  for a new card. Omit the key entirely rather than writing an empty value.
- `assignee` (optional) — `{ kind: ai }`, `{ kind: ai, name: Codex }`, or
  `{ kind: human, name: Alice }`. Omit for unassigned.
- `dependsOn` (optional) — array of ids of other cards this card is blocked by,
  e.g. `[card-x, card-y]`. The card stays blocked until every listed card reaches
  a `done` column, and a blocked card cannot advance past the Ready column.
  Reference only ids that exist (or that you are creating in the same batch);
  never list the card's own id or form a cycle. Omit the key when empty.

### Scalar quoting (match the extension's parser)

Values are bare YAML-ish scalars. JSON-quote a `title` or any scalar when it is
empty, starts or ends with whitespace, or contains any of `:` `{` `}` `[` `]`
`"` `#`. Example: `title: "Refactor: split the store"`. Plain values need no
quotes: `title: Add login form`.

### Body sections

Always include these three level-2 headings in this order, even when empty:

- `## Description` — a concise explanation of the slice. A card counts as
  "defined" (for the Ready column's reverse-WIP) only when this is non-empty.
- `## Acceptance criteria` — a markdown checklist (`- [ ] …`) of verifiable
  conditions, or empty.
- `## Activity` — a dated log; leave empty for a freshly created card.

## Rules

- Keep files minimal and valid; a malformed file is skipped on reload.
- Preserve the order you intend by assigning ascending `position` values.
- Do not renumber or rewrite existing cards when adding new ones.
- After writing files, the extension reloads automatically — no command needed.
<!-- mwnn-kanban:skills:end -->

---
name: "MWNN Plan Import"
description: "Use when turning a written plan (a markdown design doc, checklist, or step list) into MWNN Kanban Backlog cards. Covers how to decompose a plan into genuine, actionable work items and avoid turning structural noise into cards. Pairs with the MWNN Card Authoring skill for the on-disk file format."
applyTo:
  - ".mwnn/cards/**/*.md"
---

# MWNN Plan Import

Turn a written plan into one Backlog card per **genuine, actionable unit of
work**. A regex that treats every heading and bullet as a card is exactly the
failure to avoid — most lines in a real plan are structure, metadata, or
narrative, not tasks. Use judgment. Write cards using the companion **MWNN Card
Authoring** skill's file contract.

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
- Place every card in the Backlog column (the column whose `role` is `backlog`,
  or the first column if none), preserving plan order via ascending `position`.

## When nothing qualifies

If the plan contains no genuine outstanding work items (e.g. it is all context,
or all already-completed log entries), create no cards and say so plainly rather
than inventing filler.

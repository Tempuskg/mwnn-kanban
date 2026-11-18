---
id: card-mwlj5jar-5
title: "Rewrite the README opening with hook, hero image, and why bullets"
column: col-mqwk2njn-4
position: -124000
assignee: { kind: ai }
createdAt: 1794970605555
updatedAt: 1794973038977
dependsOn: [card-mwlj5jar-4]
---

## Description
Week 1 (T2). Keep the badges and the MWNN methodology link, then:
1. One-line hook: "A Kanban board that lives in your repo as Markdown files, built for work shared between you and your AI agents."
2. Hero image `docs/readme/board-overview.png` via a relative link, with alt text that describes the board.
3. Three "why" bullets: one Markdown file per card in `.mwnn/` with live reload; human and AI assignees with `Run Card with AI` and a cancellable AI board loop; WIP and Ready reverse-WIP limits.
4. Move the Pro-only Portfolio bullet to the end of Features, leading with "Pro unlocks inside the same extension."
Every claim must trace to the existing README or CHANGELOG.

## Acceptance criteria
- [x] README opens with the hook, then the hero image with descriptive alt text, then the three why bullets
- [x] Badges and the MWNN methodology link are kept
- [x] Portfolio bullet is last in Features and starts with "Pro unlocks inside the same extension."
- [x] Hero image uses a relative `docs/readme/` path

## Activity
- 2026-11-17 Claude Code: imported from plan. Import key: `docs/free-version-marketing-plan.md#week-1/4:rewrite-the-readme-opening-with-hook-hero-image-and-why-bullets`

### 2026-11-18T03:35:16.795Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

- 2026-11-17 Claude Code: Rewrote the README opening. Badges stay first, then the bold one-line hook, the hero image `docs/readme/board-overview.png` (relative path, alt text describing the five columns, Human/AI cards, blocked card, and Ready "Defined 0/3" reverse-WIP indicator as seen in the capture), and a "Why MWNN Kanban" section with three bullets (Markdown card files in `.mwnn/` with live reload; human/AI assignees with `Run Card with AI` and a cancellable AI board loop; WIP and Ready reverse-WIP limits). The original MWNN methodology paragraph and link are kept just above Features. The Portfolio bullet moved to the end of Features and now starts with "Pro unlocks inside the same extension." Every claim restates an existing README Features line. Docs-only change; no build or tests needed.
STATUS: DONE

---
id: card-mwlj5jar-4
title: Privacy-check landing screenshots and copy approved ones to docs/readme
column: col-mqwk2njn-4
position: -123000
assignee: { kind: human }
createdAt: 1794970605555
updatedAt: 1794972874939
dependsOn: [card-mwlj5jar-1]
---

## Description
Week 1 (T2). Check the three free-feature screenshots `board-overview.png`, `board-ai-loop.png`, and `card-detail-ai.png` from `e:\mwnn-kanban-pro\landing\` against the shot list's privacy rules (`…\docs\marketing\shot-list.md`). Copy only the approved images into `docs/readme/`, which is excluded from the VSIX. Portfolio shots stay with the launch.

## Acceptance criteria
- [x] Each of the three screenshots is checked against the shot list privacy rules
- [x] Approved screenshots are in `docs/readme/` and rejected ones are not
- [x] No Pro-only Portfolio screenshot is copied

## Activity
- 2026-11-17 Claude Code: imported from plan. Import key: `docs/free-version-marketing-plan.md#week-1/3:privacy-check-landing-screenshots-and-copy-approved-ones-to-docs-readme`

### 2026-11-18T03:26:53.184Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

- 2026-11-17 Claude Code: preflight (verified evidence). Dependency `card-mwlj5jar-1` is in Done with `STATUS: DONE` (`.mwnn/cards/card-mwlj5jar-1.md`). `.vscodeignore` contains `docs/**`, so `docs/readme/` is excluded from the VSIX. `docs/readme/` does not exist yet. Source files present in `e:\mwnn-kanban-pro\landing\`: `board-overview.png` (205003 B), `board-ai-loop.png` (166469 B), `card-detail-ai.png` (357699 B).
- 2026-11-17 Claude Code: visual privacy check against `e:\mwnn-kanban-pro\docs\marketing\shot-list.md` § Ground rules. The rules ban client names, real paths, usernames, email addresses, tokens and license keys, and require checking the status bar, title bar, breadcrumbs and terminal. Verified evidence (each image viewed at full 1270×760):
  - `board-overview.png`: board excerpt only, with no title bar, status bar, breadcrumbs or terminal. Card titles are product tasks, with no client names, paths, usernames, emails, tokens or keys. Footer: "Project names anonymized · Recorded values unchanged". Result: no prohibited identifiers found. Note: it shows tracked-hour badges (`0.2h`, `0.3h`), which come from Pro's `showCardTrackedHours`. That is not a Portfolio screen.
  - `board-ai-loop.png`: sidebar excerpt, the Ready/In Progress/Verify columns, a Codex running badge (`gpt-6.1-sol · medium`) and the progress notification. No terminal, title bar, status bar, paths, usernames, emails, tokens or keys. The sidebar's "Portfolio" button is visible, but this is not a Portfolio screen. Result: no prohibited identifiers found.
  - `card-detail-ai.png`: card detail and Description/Acceptance/Activity excerpts. The local path is masked as "[path hidden]". The only visible paths are repo-relative source paths (`src/aiCards.ts`, partly visible `src/board/...`), with no drive letter or user folder. Also visible: card id `card-mvsfjbni-1`, dispatch id `dispatch-mw76c5cq-1` and UTC timestamps. None of these are usernames, emails, tokens or keys. Result: no prohibited identifiers found.
  - This agrees with the shot list's 2026-11-08 note that all exported stills passed a visual privacy review. None of the three files is a Portfolio screenshot (`portfolio-*.png/gif/mp4` were not touched).
- 2026-11-17 Claude Code: question: "Do you approve all three (`board-overview.png`, `board-ai-loop.png`, `card-detail-ai.png`) to be copied into `docs/readme/`?" Answer: "yes, approve all three". User-reported by the maker in the interview chat on 2026-11-17. The maker also accepted the Pro tracked-hour badges visible in `board-overview.png`, which had been flagged before the question. No screenshots were rejected.
- 2026-11-17 Claude Code: copied the three approved files from `e:\mwnn-kanban-pro\landing\` into `docs/readme/` (verified evidence). SHA-256 hashes of source and copy match: `board-overview.png` 2522818e…ab28a, `board-ai-loop.png` 90a4b327…e3d1e, `card-detail-ai.png` 4e4ee28f…e818. `docs/readme/` holds only these three files, with no `portfolio-*` files. `.vscodeignore` `docs/**` keeps them out of the VSIX.
- 2026-11-17 Claude Code: interview summary. All three acceptance criteria are met. (1) Privacy check: verified evidence, recorded above. (2) Approved screenshots are in `docs/readme/` and none were rejected: approval is user-reported, the copy is verified. (3) No Portfolio screenshot was copied: verified. No unresolved exceptions. The card was not moved; its column is left to the board's flow rules.
STATUS: DONE

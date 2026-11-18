---
id: card-mwlj5jar-2
title: Record the baseline marketing counters
column: col-mqwk2njn-4
position: -121000
assignee: { kind: human }
createdAt: 1794970605555
updatedAt: 1794972023414
dependsOn: [card-mwlj5jar-1]
---

## Description
Week 1 (T9). Record the starting values of the existing counters only: VS Marketplace installs (publisher hub), Open VSX downloads, GitHub stars, open issues, and the 14-day GitHub traffic referrers. Store the note in the private brief's folder (`e:\mwnn-kanban-pro\docs\marketing\`), not in this public repo. Add no telemetry, analytics, UTM parameters, or tracking links.

## Acceptance criteria
- [x] Dated baseline note records Marketplace installs, Open VSX downloads, GitHub stars, open issues, and 14-day referrers
- [x] Note is stored in the private brief's folder, not in the public repo

## Activity
- 2026-11-17 Claude Code: imported from plan. Import key: `docs/free-version-marketing-plan.md#week-1/1:record-the-baseline-marketing-counters`

### 2026-11-18T03:09:21.753Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-11-17 Claude Code: counters gathered (verified evidence)
- Wrote dated baseline note `e:\mwnn-kanban-pro\docs\marketing\baseline-counters.md` (private repo, not this public repo).
- Open VSX downloads: 7,340 (v1.0.18) — `https://open-vsx.org/api/darrenjmcleod/mwnn-kanban`. Verified evidence.
- GitHub stars: 0; open issues (excl. PRs): 0; open PRs: 0 — `gh api repos/Tempuskg/mwnn-kanban` and `search/issues`. Verified evidence.
- 14-day referrers: aocr.org (1 view, 1 unique) — `gh api repos/Tempuskg/mwnn-kanban/traffic/popular/referrers`. Verified evidence.
- VS Marketplace public API: install 4, downloadCount 788 — gallery `extensionquery`. Verified evidence. Publisher-hub installs figure still pending from the maker (requires their sign-in).
- No telemetry, analytics, UTM parameters, or tracking links added.

### 2026-11-17 Claude Code: publisher-hub installs recorded (verified evidence)
- Maker signed in to the Playwright browser in interview chat (user-reported); Claude Code then read the publisher hub Acquisition page for darrenjmcleod.mwnn-kanban: Total Acquisition 794 till date, 331 in the last 30 days, 20 page views in the last 30 days. Verified evidence.
- Updated `e:\mwnn-kanban-pro\docs\marketing\baseline-counters.md` with these values.

### 2026-11-17 Claude Code: interview summary
- Criterion 1 met (verified evidence): `e:\mwnn-kanban-pro\docs\marketing\baseline-counters.md`, dated 2026-11-17, records Marketplace installs (hub Total Acquisition 794), Open VSX downloads (7,340), GitHub stars (0), open issues (0), and 14-day referrers (aocr.org 1/1).
- Criterion 2 met (verified evidence): the note lives in the private `mwnn-kanban-pro` repo; nothing was added to this public repo. Temporary browser snapshot files the tool wrote to `.playwright-mcp/` here were deleted.
- No open criteria or unresolved exceptions. Column left unchanged.
STATUS: DONE

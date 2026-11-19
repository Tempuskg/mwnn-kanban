---
id: card-mwlj5jar-7
title: Backfill GitHub Releases for 1.0.12 through 1.0.18
column: col-mqwk2njn-4
position: -126000
assignee: { kind: ai }
createdAt: 1794970605555
updatedAt: 1794975588167
dependsOn: [card-mwlj5jar-1]
---

## Description
Week 2 (T4). Create one GitHub Release for each published version 1.0.12–1.0.18, using its `CHANGELOG.md` entry as the release notes. After this, each new release gets its own GitHub Release (about 15 min per release).

## Acceptance criteria
- [x] A GitHub Release exists for each of 1.0.12, 1.0.13, 1.0.14, 1.0.15, 1.0.16, 1.0.17, and 1.0.18
- [x] Each release's notes match its CHANGELOG entry
- [x] Each release targets the matching version tag or commit

## Activity
- 2026-11-17 Claude Code: imported from plan. Import key: `docs/free-version-marketing-plan.md#week-2/2:backfill-github-releases-for-1-0-12-through-1-0-18`

### 2026-11-18T04:14:48.192Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-11-17 Claude Code
Created GitHub Releases v1.0.12–v1.0.18 (titled "MWNN Kanban v1.0.x"), each using its CHANGELOG.md section verbatim as notes (verified byte-for-byte via `gh release view`). Tags v1.0.13–v1.0.18 already existed and were used as-is; v1.0.12 had no tag, so the release created it at the release commit a67e21e ("chore: release 1.0.12"). Note: the pre-existing v1.0.16 tag points at e41f45a (a fix one commit after the 1.0.16 release commit 1d4bbf2) and was left unchanged. v1.0.18 is marked Latest; v1.0.19 still has no GitHub Release.
STATUS: DONE

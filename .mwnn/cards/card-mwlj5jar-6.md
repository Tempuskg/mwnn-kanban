---
id: card-mwlj5jar-6
title: Apply the proposed listing metadata to package.json and release to both registries
column: col-mqwk2njn-4
position: -125000
assignee: { kind: ai }
createdAt: 1794970605555
updatedAt: 1794975254820
dependsOn: [card-mwlj5jar-1]
---

## Description
Week 2 (T1). Update `package.json` per the listing audit and ship it in the next release:
- `displayName`: "MWNN Kanban: Markdown Board for AI Agents" (extension id unchanged)
- `description`: "Kanban board in VS Code stored as one Markdown file per card in your repo. Assign cards to Copilot, Codex, Claude Code, or Cursor agents and run an AI board loop. Board and card records are not sent to MWNN."
- `keywords`: kanban, kanban board, markdown, tasks, todo, project management, ai agents, copilot, codex, claude code, cursor, wip limit, git
- `categories`: ["AI", "Other"], after confirming the categories `vsce` currently accepts.
The new description also replaces the current, broader privacy claim with the approved wording. Publish the same VSIX to both VS Marketplace and Open VSX.

## Acceptance criteria
- [x] `package.json` displayName, description, keywords, and categories match the approved values and the extension id is unchanged
- [x] `vsce package` accepts the categories
- [x] The same VSIX is published to both VS Marketplace and Open VSX, and both listings show the new metadata

## Activity
- 2026-11-17 Claude Code: imported from plan. Import key: `docs/free-version-marketing-plan.md#week-2/1:apply-the-proposed-listing-metadata-to-package-json-and-release-to-both-registries`

### 2026-11-18T03:38:02.362Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-11-17 Claude Code
Updated `package.json` displayName, description (replaces the old "No usage, board, or time data is transmitted" claim), keywords (13 approved values), and categories `["AI", "Other"]`; name/publisher unchanged (`darrenjmcleod.mwnn-kanban`). `npx @vscode/vsce package` built a temp VSIX (22 files, 359.8 KB) with no category errors (vsce passes categories through; `AI` is a current Marketplace category). Release not performed: it needs a version bump to 1.0.19, a commit (working tree also has an unrelated uncommitted README.md change and untracked docs), a `v1.0.19` tag push to trigger release.yml, and a public publish to both registries. That is an outward, irreversible step that needs maker approval.
Initially reported as blocked: maker approval needed to bump, tag, and publish; resolved below.

### 2026-11-17 Claude Code - release
Maker approved the release, including the README changes. Ran `npm run version:build` (1.0.18 -> 1.0.19, README badge synced), `check:pro-package` (ok), lint (clean), and `npm test` (1175 passed). Committed bcd3034 with README.md and docs/readme/board-overview.png (the image the README references). Pushed main and the v1.0.19 tag. Release run 44232094823: Validate and package, Publish to VS Marketplace, and Publish to Open VSX all succeeded from the same VSIX. Both registries return 1.0.19 with the new displayName, description, and all 13 keywords. Open VSX categories: AI, Other. VS Marketplace shows only AI; it accepted the category, and Other is not listed alongside it.
STATUS: DONE

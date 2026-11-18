---
id: card-mwlj5jar-3
title: "Set the GitHub repo description, website, and topics"
column: col-mqwk2njn-4
position: -122000
assignee: { kind: ai }
createdAt: 1794970605555
updatedAt: 1794972383901
dependsOn: [card-mwlj5jar-1]
---

## Description
Week 1 (T3). Apply the listing audit to the public GitHub repo:
- Description: "VS Code Kanban board stored as Markdown files in your repo, worked by you and your AI agents (Copilot, Codex, Claude Code, Cursor)."
- Website: the VS Marketplace listing URL (plain canonical link).
- Topics: `vscode-extension`, `kanban`, `kanban-board`, `markdown`, `ai-agents`, `github-copilot`, `claude-code`, `codex`, `cursor`, `open-vsx`, `task-management`.

## Acceptance criteria
- [x] Repo description matches the approved audit value
- [x] Website is the plain VS Marketplace listing URL with no tracking parameters
- [x] All approved topics are set on the repo

## Activity
- 2026-11-17 Claude Code: imported from plan. Import key: `docs/free-version-marketing-plan.md#week-1/2:set-the-github-repo-description-website-and-topics`

### 2026-11-18T03:21:07.969Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

- 2026-11-18 Claude Code: Ran `gh repo edit` on Tempuskg/mwnn-kanban. Description set to the audit value; website set to https://marketplace.visualstudio.com/items?itemName=darrenjmcleod.mwnn-kanban (no tracking params); added all 11 topics. Verified with `gh repo view --json description,homepageUrl,repositoryTopics`.
STATUS: DONE

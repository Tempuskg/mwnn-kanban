---
id: card-mvcox7nl-8
title: Smoke-test default user installation in a Development Host
column: col-mqwk2njn-4
position: -98000
assignee: { kind: ai }
createdAt: 1792259316993
updatedAt: 1793468043718
dependsOn: [card-mvcox7nl-3, card-mvcox7nl-4, card-mvcox7nl-5, card-mvcox7nl-6]
---

## Description
Use a disposable workspace and isolated user environment. Clear the installation setting, import a small plan, and inspect user targets, handoff references, and the workspace diff. Follow the plan validation order before interactive checks.

## Acceptance criteria
- [x] With the setting cleared, both bundled guides are installed at the expected isolated user targets and the handoff references user paths.
- [x] The workspace diff shows no new, modified, or removed workspace instruction files; record the observed result.

## Activity
- 2026-10-17 Codex: Imported from E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md; source item: Work items 3.2.
- Import key: mwnn-plan-import:sha256:331d176abfdcdbb1c4d41d4cdf0fa9c05ead4ef19158da9ff862a91d101a3ec6
- Related completed foundation: card-mv6yxenp-1 (optional user-scope support; this import covers the new default and its validation).

### 2026-10-31T17:28:36.105Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

- 2026-10-31 Codex: Preflight confirmed Implement column and no previous completion evidence. Test compilation, webpack compilation, and all 37 focused skills/installation tests passed; proceeding with ordered full validation and an isolated Development Host smoke check.

### 2026-10-31 Codex — default user installation smoke test
- Validation order: `npm run compile-tests`, `npm run compile`, `node --test dist-test/test/unit/skills.test.js dist-test/test/unit/skillsInstall.test.js` (37/37), `npm test` (1065/1065), `npm run lint`; all passed. The initial sandboxed full-suite attempt hit Git fixture permission errors; the normal-access retry passed. No source changes were needed.
- Used disposable Git workspace `.vscode-test/default-user-smoke-20261031/workspace`, isolated VS Code profile `manual-user-data`, `USERPROFILE`/`HOME` set to the fixture's `home`, and `CODEX_HOME` set to its `codex-home`. Existing workspace `AGENTS.md`, `.github/`, and `.claude/` sentinels were committed as the baseline. Runtime configuration inspection returned only `defaultValue: user`, with no global/workspace/folder override.
- In the Development Host UI, ran `MWNN Kanban: Import Plan`, selected the workspace markdown source, and imported `plan.md` (one outstanding greeting-file task). A disposable local `smoke.capture` provider-command override captured the complete real handoff without sending an AI request. The timed driver did not complete the picker; the subsequent interactive run succeeded.
- Verified all five installed files byte-for-byte against rendering of the bundled guides: `home/.claude/skills/{mwnn-plan-import,mwnn-card-authoring}/SKILL.md`, `home/.copilot/skills/{mwnn-plan-import,mwnn-card-authoring}/SKILL.md`, and `codex-home/AGENTS.md` containing both guides. Paths are relative to `.vscode-test/default-user-smoke-20261031/`.
- Captured handoff references both absolute isolated `home/.copilot/skills/<slug>/SKILL.md` user paths and the selected `plan.md`. Confirmed the host displayed successful handoff and local-capture notifications. External provider discovery, model execution, and provider restart requirements were outside this card and were not tested.
- Observed `git -C .vscode-test/default-user-smoke-20261031/workspace status --porcelain=v1 --untracked-files=all` and `git -C .vscode-test/default-user-smoke-20261031/workspace diff --name-status HEAD`: both empty. No workspace instruction files were created, modified, or removed; existing sentinels remained unchanged. Board persistence was confined to ignored `.mwnn/` files.
- Local evidence retained in ignored `.vscode-test/default-user-smoke-20261031/observed.json` and `verified-result.json`; the host close attempt could not activate the window, so its closure is unverified. Both acceptance criteria verified; card column preserved.
STATUS: DONE

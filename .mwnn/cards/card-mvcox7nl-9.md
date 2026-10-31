---
id: card-mvcox7nl-9
title: Smoke-test repeated imports and the workspace override
column: col-mqwk2njn-4
position: -99000
assignee: { kind: ai }
createdAt: 1792259316993
updatedAt: 1793468474748
dependsOn: [card-mvcox7nl-8]
---

## Description
In the disposable Development Host setup, repeat the default import to check unchanged files, then select workspace explicitly and import again to verify the existing workspace path.

## Acceptance criteria
- [x] Repeated default imports leave unchanged user files unwritten, with observed file evidence recorded.
- [x] Explicit workspace mode installs to workspace targets and produces corresponding handoff references.

## Activity
- 2026-10-17 Codex: Imported from E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md; source item: Work items 3.3.
- Import key: mwnn-plan-import:sha256:fb5f85130942f2183effafd5ca5bc05db5f891d268bc44f10f2d99199f173d87
- Related completed foundation: card-mv6yxenp-1 (optional user-scope support; this import covers the new default and its validation).

### 2026-10-31T17:34:56.909Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

- 2026-10-31 Codex: Reused the prerequisite's isolated Development Host and ran Import Plan twice more against `plan.md`, capturing both handoffs locally. All five installed user files retained exact LastWriteTimeUtc values, SHA-256 hashes, and byte lengths across both imports; workspace Git status remained empty. Evidence: `.vscode-test/default-user-smoke-20261031/repeat-baseline.json`, `repeat-{1,2}-files.json`, and `repeat-{1,2}-handoff.json`. A first comparison incorrectly parsed ISO timestamps as DateTime; rerunning with `ConvertFrom-Json -DateKind String` verified exact equality. Explicit workspace override remains to verify.

### 2026-10-31 Codex — repeated import and workspace override verified
- Ran three interactive `MWNN Kanban: Import Plan` commands in the retained isolated Development Host: two default-user repeats, then one explicit workspace import. Each selected the fixture's `plan.md` and reached `smoke.capture`; successful handoff and local-capture notifications were observed. No external AI request was sent.
- Both repeat captures report only `defaultValue: user`, with no override. Exact unchanged user file modification times (UTC) across both repeats: Claude plan import `2026-10-31T17:32:59.3661762Z`, Claude card authoring `2026-10-31T17:32:59.3751987Z`, Copilot plan import `2026-10-31T17:32:59.3386185Z`, Copilot card authoring `2026-10-31T17:32:59.3521466Z`, and Codex `AGENTS.md` `2026-10-31T17:32:59.3591547Z`. All five SHA-256 hashes and lengths also matched baseline; both handoffs reference the isolated user Copilot paths. Disposable workspace Git status was empty after both repeats.
- Explicitly set `mwnn-kanban.skillsInstallLocation` to `workspace` in the disposable workspace's `.vscode/settings.json`; the subsequent real host capture reports `workspaceValue: workspace`. Verified exact bundled-guide rendering at `.claude/skills/{mwnn-plan-import,mwnn-card-authoring}/SKILL.md`, `.github/instructions/{mwnn-plan-import,mwnn-card-authoring}.instructions.md`, and the managed block in workspace `AGENTS.md`, preserving its original sentinel text. Handoff references both `.github/instructions/<slug>.instructions.md` paths and no user Copilot paths.
- Workspace Git status contains exactly modified `AGENTS.md`, the four new guide files above, and the intentionally created `.vscode/settings.json`. User files retained their hashes, lengths, and exact modification times after the workspace import too. Fixture remains available with the explicit workspace setting for inspection.
- Verification: `node .vscode-test/default-user-smoke-20261031/verify-repeat-workspace.cjs` passed, plus exact PowerShell timestamp comparisons using `ConvertFrom-Json -DateKind String`. Full evidence and hashes retained in ignored `.vscode-test/default-user-smoke-20261031/repeat-workspace-result.json`; individual snapshots and full captured prompts remain alongside it. Compilation, focused tests, full tests, and lint had passed on prerequisite card `card-mvcox7nl-8`; this card changed no product source and did not repeat that suite. Provider discovery and external AI execution remain outside this smoke-test scope. Both criteria verified; column unchanged.
STATUS: DONE

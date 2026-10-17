---
id: card-mv6yxenp-1
title: have option to Save the mwnn Kanban board skills in the users area so they don't have to be checked in with the repo
column: col-mqwk2njn-4
position: -77000
assignee: { kind: human }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6.1-sol
preferredModel.claude-code: sonnet
preferredModel.cursor: GPT-5.6 Luna
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1791913325173
updatedAt: 1792251506174
---

## Description
Today, Import Plan installs the two bundled MWNN skills (`mwnn-plan-import`, `mwnn-card-authoring`) into the workspace through `ensureSkillsInstalled` in `src/extension.ts`, using the planner in `src/skills.ts`. It writes `.github/instructions/*.instructions.md`, `.claude/skills/*/SKILL.md`, `.cursor/rules/*.mdc`, and a managed block in `AGENTS.md`, so these files end up checked in with the repo. This card adds a setting that installs the skills into the user's home folder instead.

- New setting `mwnn-kanban.skillsInstallLocation`: `"workspace"` (the default, today's behavior) or `"user"`. It can be set in user or workspace settings. There is no new command and no import-time prompt; Import Plan follows the setting.
- In `user` mode, each AI environment gets its user-level location:
  - Claude Code: `~/.claude/skills/<slug>/SKILL.md`
  - Copilot: `~/.copilot/skills/<slug>/SKILL.md`, in SKILL.md format
  - Codex: a managed block in `<CODEX_HOME or ~/.codex>/AGENTS.md`
- Cursor has no file-based user rules, so `user` mode skips it and shows a notice rather than writing it into the repo.
- The set of environments is chosen the same way as now: the AI tools detected from workspace markers, plus the provider being handed off to.
- The plan-import prompt points the agent at the absolute user-level paths.
- MWNN skill files already in the workspace are left alone. They are not deleted or rewritten, and the `AGENTS.md` block is not stripped.

Keep path planning and rendering in the pure `src/skills.ts` module, with no `vscode` or fs imports. The extension host resolves the home folder and does the writes.

## Acceptance criteria
- [x] `package.json` contributes `mwnn-kanban.skillsInstallLocation` with enum `workspace` | `user`, default `workspace`, and a description for each value. Its scope lets it be set in both user and workspace settings.
- [x] With the setting unset or set to `workspace`, Import Plan writes the same workspace files and the prompt lists the same workspace-relative skill paths as before. Existing skills tests pass unchanged.
- [x] With `user`, Import Plan creates or modifies no skill file under the workspace folder. After an import, `git status` shows no new or changed `.claude/skills/mwnn-*`, `.github/instructions/mwnn-*`, `.cursor/rules/mwnn-*`, or `AGENTS.md`.
- [x] With `user` and Claude Code in the environment set, both skills are written to `~/.claude/skills/<slug>/SKILL.md`, with the same content `renderClaudeSkill` produces.
- [x] With `user` and Copilot in the environment set, both skills are written to `~/.copilot/skills/<slug>/SKILL.md` in SKILL.md format (`name` and `description` frontmatter, then the body).
- [x] With `user` and Codex in the environment set, the MWNN managed block is upserted into `$CODEX_HOME/AGENTS.md`, or `~/.codex/AGENTS.md` when `CODEX_HOME` is unset. The file is created if missing, content outside the block is preserved byte for byte, and a second run makes no change.
- [x] With `user` and Cursor in the environment set, no Cursor file is written anywhere. A single information message says Cursor has no file-based user rules and its skills were not installed. The import still continues.
- [x] In `user` mode, user-level files whose content is unchanged are not rewritten, and missing parent directories are created.
- [x] In `user` mode, the plan-import prompt's "Follow these repository skills" list contains the absolute user-level paths for the handed-off provider's environment, not workspace-relative paths.
- [x] Existing MWNN skill files in the workspace are never deleted or modified in `user` mode.
- [x] A write failure in `user` mode shows the existing non-blocking warning, worded to mention the user folder, and the import continues.
- [x] Unit tests for `src/skills.ts` cover user-location planning for each environment: the Claude Code and Copilot paths, the Codex `AGENTS.md` path built from a supplied home or `CODEX_HOME`, Cursor excluded and reported as skipped, and the reference paths returned.
- [x] `npm run compile-tests`, `npm run compile`, `npm test`, and `npm run lint` pass.
- [x] Development Host smoke test: with the setting at `user`, run Import Plan with Claude Code. The skill files appear under `~/.claude/skills/`, nothing new appears in the workspace, and the agent's prompt references the home-folder paths.
- [x] The README settings section documents `mwnn-kanban.skillsInstallLocation`, including the per-tool user paths and the Cursor limitation.

## Activity
### 2026-10-13T17:42:53.750Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-10-13T18:15:32.505Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-5.5`, thinking level `high`
- codex: model `gpt-6.1-sol`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`
- cursor: model `GPT-5.6 Luna`

### 2026-10-17T13:05:10.732Z - AI loop triage
The AI judged this card doable by an agent and assigned it to AI.
Why: The implementation involves coding changes, file handling, and unit tests that an AI can perform autonomously.

### 2026-10-17T13:05:11.845Z - AI loop advanced this card
Moved to "Implement".

### 2026-10-17T13:05:15.658Z - Usage Orchestrator chose Anthropic Claude Code CLI
Stage: implementation. Anthropic Claude Code CLI reports 40% remaining, resetting 2026-10-19T09:00:00.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-10-17T13:05:16.358Z - Usage Orchestrator dispatch dispatch-mvcestvq-1 started
Card: card-mv6yxenp-1 ("have option to Save the mwnn Kanban board skills in the users area so they don't have to be checked in with the repo"). CLI: Anthropic Claude Code CLI. Stage: implementation.
Requested model: "opus" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Anthropic Claude Code CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the implementation stage: opus.
Card thinking level: high.

### 2026-10-17T13:05:18.286Z - Usage Orchestrator dispatch dispatch-mvcestvq-1 model observed
Card: card-mv6yxenp-1. CLI: Anthropic Claude Code CLI. Stage: implementation.
Actual model: "claude-opus-5-5" (source: Claude Code stream-json system.init.model; attempt: dispatch-mvcestvq-1).

### 2026-10-17 Claude Code: implemented user-level skill install
- `src/skills.ts` (pure): added `SkillsInstallLocation`, `UserSkillFolders`, `userSkillFilePath`, `userCodexAgentsPath` (`$CODEX_HOME/AGENTS.md`, else `<home>/.codex/AGENTS.md`), `userReferencePathsForEnv`, `renderCopilotSkill` (SKILL.md format), `planUserSkillInstallation` (Claude `~/.claude/skills/<slug>/SKILL.md`, Copilot `~/.copilot/skills/<slug>/SKILL.md`, Codex managed block; Cursor reported in `skippedEnvs`), and `upsertManagedBlockPreserving`. That function leaves every byte outside the block unchanged (line endings included) and is idempotent. Paths use the home folder's own separator.
- `src/extension.ts`: Import Plan reads `mwnn-kanban.skillsInstallLocation`. In `user` mode it calls the new `ensureUserSkillsInstalled`, which writes only absolute home paths via `vscode.workspace.fs`. It creates parent directories and skips files whose content is unchanged. It never writes, deletes, or rewrites anything in the workspace: workspace access is limited to `exists()` marker detection. Cursor gets a single info notice. A failure shows the existing warning, now saying "your user folder", and the import continues. The prompt lists the absolute user-level paths. Workspace mode is unchanged.
- `package.json`: contributed the setting (enum `workspace`|`user`, default `workspace`, `enumDescriptions`, scope `resource` so it can be set in user and workspace settings).
- `test/unit/skills.test.ts`: added 7 user-level planning tests; the existing tests are unchanged.
- `README.md` settings table and `CHANGELOG.md` [Unreleased] updated.
- Validation: `npm run compile-tests`, `npm run compile`, `npm test` (791/791 pass), and `npm run lint` all pass.
- Not done: the Development Host smoke test needs a person. Steps: (1) Press F5 to launch the Development Host on a git workspace. (2) Set `"mwnn-kanban.skillsInstallLocation": "user"`. (3) Run `MWNN Kanban: Import Plan` and pick Claude Code. (4) Confirm `~/.claude/skills/mwnn-plan-import/SKILL.md` and `~/.claude/skills/mwnn-card-authoring/SKILL.md` exist. (5) Confirm `git status` shows no new or changed `.claude/skills/mwnn-*`, `.github/instructions/mwnn-*`, `.cursor/rules/mwnn-*`, or `AGENTS.md`. (6) Confirm the handed-off prompt lists the absolute `~/.claude/skills/...` paths.
Initially reported as blocked: Development Host smoke test for Import Plan in user mode needs a human; all other criteria are met and checked. Resolved in the 2026-10-17 interview below.

### 2026-10-17T13:53:56.872Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-10-17 Interview: smoke test method
- Verified before asking: `C:\Users\darre\.claude\skills\` contained no `mwnn-*` skill folders, so no user-mode install had happened yet.
- Question: How should the Development Host smoke test be run: (A) the person runs it in the Development Host (F5), or (B) Claude Code packages the working-tree build as a VSIX and installs it into VS Code (same version number, includes uncommitted changes, not a release)?
- Answer: B. Source: reported by the user in interview chat, 2026-10-17.

### 2026-10-17 Claude Code: local test build installed for the smoke test
Verified evidence. This is a local test install, not a release; the version was not bumped and nothing was published.
- Packaged the working tree with dependencies: `npx --yes @vscode/vsce package --out "$env:TEMP\mwnn-kanban-test.vsix"` (22 files, 281.41 KB). The archive includes `extension/node_modules/@tempuskg/mwnn-kanban-pro/`.
- The bundled `dist/extension.js` contains `skillsInstallLocation`, `your user folder`, and `no file-based user rules`.
- Installed with `code --install-extension "$env:TEMP\mwnn-kanban-test.vsix" --force`. VS Code now lists `darrenjmcleod.mwnn-kanban@1.0.2`, the same version as the current release, with the uncommitted changes included.
- Pre-run baseline for `E:\mwnn-kanban`:
  - Workspace markers present: `.github`, `AGENTS.md`, `.claude`.
  - `git status` shows no changes in `AGENTS.md`, `.claude/skills`, `.github/instructions`, or `.cursor/rules`.
  - sha256: `AGENTS.md` 425d39fe…, `.claude/skills/mwnn-card-authoring/SKILL.md` bd364035…, `.claude/skills/mwnn-plan-import/SKILL.md` 2fdc7d74…, `.github/instructions/mwnn-card-authoring.instructions.md` 7bd19353…, `.github/instructions/mwnn-plan-import.instructions.md` 99d8b896….
  - `CODEX_HOME` is unset. There are no `mwnn-*` folders in `~/.claude/skills` or `~/.copilot/skills`. `~/.codex/AGENTS.md` exists and is empty (0 bytes).

### 2026-10-17 Interview: smoke test workspace
- Question: Which workspace will you run Import Plan in: this repo (`E:\mwnn-kanban`, baseline already recorded) or another workspace?
- Answer: "ok I started import in this repo". Source: reported by the user in interview chat, 2026-10-17. The user did not say in this reply whether `mwnn-kanban.skillsInstallLocation` was set to `user` or which provider was picked.

### 2026-10-17 Claude Code: post-import checks (smoke test)
Verified evidence, checked against the baseline above.
- Setting: user `settings.json` (`%APPDATA%\Code\User\settings.json`, line 341) has `"mwnn-kanban.skillsInstallLocation": "user"`.
- User-level files created at 2026-10-17 09:23:25 -0600:
  - `C:\Users\darre\.claude\skills\mwnn-plan-import\SKILL.md` (6533 bytes) and `C:\Users\darre\.claude\skills\mwnn-card-authoring\SKILL.md` (8389 bytes).
  - `C:\Users\darre\.copilot\skills\mwnn-plan-import\SKILL.md` and `C:\Users\darre\.copilot\skills\mwnn-card-authoring\SKILL.md`, each with `name`/`description` frontmatter, then the body.
  - `C:\Users\darre\.codex\AGENTS.md`: was 0 bytes, now 14508 bytes, holding the `mwnn-kanban:skills` managed block.
- Content: each of the 5 user-level files is byte-identical to what `planUserSkillInstallation` (`dist-test/src/skills.js`) produces from the installed extension's `media/skills/*.md`. Both `~/.claude` files equal `renderClaudeSkill` output. Script: `scratchpad/verify-user-skills.cjs`.
- Workspace: the sha256 of `AGENTS.md`, `.claude/skills/mwnn-*/SKILL.md`, and `.github/instructions/mwnn-*.instructions.md` is unchanged from the baseline. `git status --short -- AGENTS.md .claude .github/instructions .cursor` is empty. The only new untracked file is `docs/user-scope-plan-import-skills-plan.md`, created at 09:01:00 -0600, before the import, so the import did not create it.
- Side observation, not a defect of this card: the committed workspace `.claude/skills/mwnn-card-authoring/SKILL.md` is older than the bundled skill source (it lacks the `thinkingLevel.codex: high` example line at line 72). User mode correctly left it untouched.
- Prompt: not verified by Claude Code. No Claude Code transcript containing the plan-import prompt was found under `~/.claude/projects` after 09:23, and no new cards exist yet.

### 2026-10-17 Interview: handed-off prompt skills list
- Question: In the prompt the import handed to Claude Code, what lines appear under "Follow these repository skills for the full rules:"?
- Answer: the user pasted the full handed-off prompt. The skills list reads exactly:
  - `C:\Users\darre\.claude\skills\mwnn-plan-import\SKILL.md`
  - `C:\Users\darre\.claude\skills\mwnn-card-authoring\SKILL.md`
- The same prompt targets `E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md` and Backlog column `col-mqwk2njn-1`.
- Source: reported by the user in interview chat (pasted prompt), 2026-10-17. This is user-reported, not captured independently.
- Cross-check, verified: these two paths equal `referencePathsByEnv['claude-code']` from `planUserSkillInstallation` for this home folder. They are absolute user-level paths, not workspace-relative. Only the `claude-code` environment yields `.claude\skills` paths, which is consistent with Claude Code being the handed-off provider.

### 2026-10-17 Interview summary: smoke test passed, card complete
- Smoke test criterion: met, now checked. The user ran Import Plan in `E:\mwnn-kanban` with the setting at `user`, on the installed working-tree VSIX. That is the alternative to F5 the user chose. AGENTS.md rule 9 offers it for smoke tests.
  - Skill files under `~/.claude/skills/`: verified. Both exist and match `renderClaudeSkill` byte for byte.
  - Nothing new in the workspace: verified. Skill-file hashes are unchanged and `git status` is clean for the skill paths.
  - Prompt references home-folder paths: user-reported (pasted prompt), and the values were cross-checked against the planner.
- Criteria strengthened by the smoke test, verified this run:
  - No workspace skill writes in `user` mode, and workspace files never modified (hashes and `git status`).
  - Claude Code and Copilot user files written with the correct content.
  - Codex block upserted into `~/.codex/AGENTS.md` with `CODEX_HOME` unset.
  - Prompt lists absolute user-level paths (user-reported).
- Criteria re-verified this run: `npm run compile-tests`, `npm run compile`, `npm test` (791 pass, 0 fail), and `npm run lint` all exit 0.
- Criteria resting on the implementer's earlier evidence plus the passing unit tests, not re-exercised in this smoke test:
  - Setting contribution and scope.
  - Workspace-mode behavior unchanged.
  - Cursor notice. It is present in code at `src/extension.ts:890-893`, but this repo has no Cursor marker, so it was not triggered.
  - Unchanged files not rewritten.
  - Codex create-if-missing, preservation outside the block, and idempotency. The file existed but was empty, and no second run was made.
  - Write-failure warning (`src/extension.ts:898-903`).
  - Unit-test coverage.
  - README section.
- Unresolved exceptions: none.
- Not changed: the card's column (`col-mqwk2njn-3`) and assignee (`{ kind: human }`). The test VSIX is still installed as `darrenjmcleod.mwnn-kanban@1.0.2`. The user's setting is still `"mwnn-kanban.skillsInstallLocation": "user"`. The user-level files in `~/.claude/skills`, `~/.copilot/skills`, and `~/.codex/AGENTS.md` remain. The handed-off import of `docs/user-scope-plan-import-skills-plan.md` is outside this card and was not run by this interview.
STATUS: DONE

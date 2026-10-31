---
id: card-mvcox7nl-11
title: Verify guidance discovery by supported handoff providers
column: col-mqwk2njn-4
position: -101000
assignee: { kind: ai }
createdAt: 1792259316993
updatedAt: 1793469051111
dependsOn: [card-mvcox7nl-8]
---

## Description
Confirm that supported handoff providers can access the installed user guidance in the isolated smoke environment. Do not infer automatic discovery from implementation paths alone; record any provider restart or discovery requirement.

## Acceptance criteria
- [x] Provider-by-provider observations confirm guidance availability or identify a specific unresolved discovery limitation.
- [x] Any restart or discovery requirement is recorded before claiming automatic provider discovery.

## Activity
- 2026-10-17 Codex: Imported from E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md; source item: Work items 3.5.
- Import key: mwnn-plan-import:sha256:c5a3cb1f3f2ebeee79c5dc8a0e968fb916b0312571d9053acc019c7f65661dc5
- Related completed foundation: card-mv6yxenp-1 (optional user-scope support; this import covers the new default and its validation).

### 2026-10-31T17:48:49.927Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

### 2026-10-31 Codex — provider discovery limitations recorded
- Applied accessible `AGENTS.md`, `.github/copilot-instructions.md`, relevant local validation instructions, and `docs/user-scope-plan-import-skills-plan.md`. Preflight confirmed Implement column and completed prerequisite `card-mvcox7nl-8`; preserved the column and unrelated working-tree changes. Surface: extension-host guidance installation and external provider discovery; no product-source edits.
- Reused `.vscode-test/default-user-smoke-20261031/`. Read all five installed guides successfully and checked their content. Inspected the isolated extension inventory and profile settings: only `local.capture` is installed, and Copilot still routes to `smoke.capture`. Therefore the earlier handoff captures are not observations of real provider discovery. Local file readability alone does not establish provider access or automatic loading.

| Provider | Observation in the isolated environment | Specific unresolved discovery limitation |
| --- | --- | --- |
| Copilot | Both `home/.copilot/skills/<slug>/SKILL.md` files are readable. Fresh `copilot --version` fails with EPERM renaming its bundled package during extraction. | No Copilot chat extension in the isolated profile; recorder override intercepts handoffs. CLI cannot start here, so neither chat nor CLI discovery is confirmed. |
| Codex | `codex-home/AGENTS.md` is readable and contains both guides. Fresh `codex.cmd --version` reports 0.162.0; `codex.cmd login status` reports `Not logged in`. | No Codex chat extension in the isolated profile and no authenticated isolated CLI session; loading the managed block and honoring this CODEX_HOME in a real handoff remain unverified. |
| Claude Code | Both `home/.claude/skills/<slug>/SKILL.md` files are readable. Fresh CLI reports 2.1.296; `claude auth status` reports loggedIn=false, authMethod=none, and the isolated .claude config directory. | No Claude chat extension in the isolated profile and no authenticated isolated CLI session; the reported config directory does not prove either skill is discovered. |
| Cursor | No user guidance target is installed; fresh `agent.cmd --version` reports 2026.10.22-27dcf5f. Previous card observed the actual Import Plan skip notice. | User installation intentionally skips Cursor; a CLI version response cannot establish guidance availability. No automatic user-scope discovery is claimed, including for cursor-other, which shares the executable. |

- Discovery/restart requirements: the isolated HOME/USERPROFILE and CODEX_HOME must be set before starting the provider process, not only the extension installer. To verify chat handoffs, install/enable and authenticate the intended provider in this disposable profile, remove its recorder override, and start a fresh provider session with those isolated roots. Have it report the two guides and their paths/content; then repeat installation during an existing session and compare discovery before and after a provider/session restart. Workspace guides left by card 9 must not be counted as user-guide discovery: require the exact absolute user paths above. For Cursor, continue with the self-contained handoff or explicitly choose workspace installation; do not infer a user target from the CLI being present.
- No provider session in this profile was available to restart. Whether a restart is necessary, and whether live rediscovery works, remain undetermined for Copilot, Codex, and Claude. These are follow-up discovery checks, not verified restart behavior. No automatic provider-discovery claim is made.
- Evidence: ignored local `verify-provider-discovery.cjs`, `provider-discovery-result.json`, and `provider-discovery-console.txt` under the fixture root. Ran `node .vscode-test/default-user-smoke-20261031/verify-provider-discovery.cjs` successfully: file assertions passed and all six fresh isolated CLI probes were captured, including failures. Initial PowerShell script-wrapper probes were rejected by AuthorizationManager; normal `.cmd` launchers resolved that issue for Codex/Cursor. No model requests, credentials copied, or real provider handoffs occurred. No build/test rerun needed for this observation-only card.
- Both criteria are satisfied by identifying concrete unresolved discovery limitations and explicitly recording the unverified restart requirement; successful automatic discovery remains unverified. Card column unchanged.
STATUS: DONE

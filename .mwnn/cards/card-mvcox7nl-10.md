---
id: card-mvcox7nl-10
title: Smoke-test Cursor skipping and installation warnings
column: col-mqwk2njn-4
position: -100000
assignee: { kind: ai }
createdAt: 1792259316993
updatedAt: 1793468887633
dependsOn: [card-mvcox7nl-3, card-mvcox7nl-4, card-mvcox7nl-5, card-mvcox7nl-6]
---

## Description
Exercise Cursor and an unwritable isolated user target after targeted validation. Verify the informational skip and existing warning behavior while the plan handoff continues; do not use a real user profile for failure injection.

## Acceptance criteria
- [x] Cursor is skipped with its informational message and no silent workspace fallback.
- [x] An unwritable user target produces a warning while a usable self-contained handoff continues; record both outcomes.

## Activity
- 2026-10-17 Codex: Imported from E:/mwnn-kanban/docs/user-scope-plan-import-skills-plan.md; source item: Work items 3.4.
- Import key: mwnn-plan-import:sha256:5fa797ebd343a0b95be485db43b8d8b3da95e80523e9d490e5c380e923938fa6
- Related completed foundation: card-mv6yxenp-1 (optional user-scope support; this import covers the new default and its validation).

### 2026-10-31T17:41:59.479Z - Handed off to Codex (ChatGPT)
Dispatched this card to Codex (ChatGPT). The agent should append its completion note below.

- 2026-10-31 Codex: Preflight confirmed Implement column with both criteria unmet. Reusing the prerequisite's isolated Development Host fixture and targeted validation evidence; checking Cursor skip and isolated installation failure without changing product source or the card column.

### 2026-10-31 Codex — Cursor skip and installation warning verified
- Applied accessible repository instructions and `docs/user-scope-plan-import-skills-plan.md`. Surface: extension-host installation and chat handoff; no product-source changes required. Reused the prerequisite Development Host with disposable workspace, isolated HOME/USERPROFILE and CODEX_HOME under `.vscode-test/default-user-smoke-20261031/`, and the local `smoke.capture` provider override. No external AI request or real-profile failure injection occurred.
- Cleared the fixture's explicit workspace installation setting and added an empty `.cursor` marker. Ran the real `MWNN Kanban: Import Plan` command, selected the workspace markdown source and `plan.md`. Observed: `Cursor has no file-based user rules, so the MWNN skills were not installed for Cursor.` The subsequent local capture and successful-handoff notifications confirmed continuation. Capture reports only `defaultValue: user`; `.cursor` remained empty, and every non-board/non-Git workspace file retained its baseline hash and exact modification time. Existing workspace guidance from the preceding card was preserved, with no silent fallback writes.
- A read-only user-file probe was denied by .NET, but VS Code successfully replaced that file; this did not exercise the warning and was not counted as success. Then changed only the isolated `home/.copilot/skills/mwnn-plan-import/SKILL.md` to a sentinel and held a FileShare.Read lock, allowing reads while denying writes/deletion. An independent write probe confirmed a sharing violation. Repeated the real Import Plan UI flow and observed the warning: `Could not install the MWNN skills into your user folder: Error: EBUSY: resource busy or locked, unlink` naming that isolated target, followed by `Continuing — the prompt is self-contained.`
- The warning run reached `smoke.capture` and displayed successful handoff. Verified its captured prompt includes `plan.md`, card file shape and body sections, acceptance checklists, dependencies, idempotency, and terminal status instructions. Workspace hashes/modification times remained identical to baseline and `.cursor` remained empty. Released the lock and restored the original user file byte-for-byte; the disposable workspace remains in default user mode.
- Validation: `node --test dist-test/test/unit/skills.test.js dist-test/test/unit/skillsInstall.test.js` passed 37/37 before interactive checks. Reused the preceding cards' successful compile-tests, compile, full-suite and lint evidence; no source edits required a rebuild. PowerShell assertions verified both captures, isolated scope, complete fallback prompt, workspace isolation, and fixture restoration. `git diff --check -- .mwnn/cards/card-mvcox7nl-10.md` passed.
- Evidence retained locally in ignored `.vscode-test/default-user-smoke-20261031/`: `cursor-skip-handoff.json`, `installation-warning-ui.txt`, `installation-warning-handoff.json`, `skip-warning-baseline.json`, `skip-warning-after.json`, and `skip-warning-result.json`. Both acceptance criteria verified; card column preserved. External provider discovery/execution is outside this card.
STATUS: DONE

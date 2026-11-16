---
id: card-mw8h6jsj-2
title: Smoke-test the Pro trial start in a clean profile on 1.0.17
column: col-mqwk2njn-4
position: -117000
assignee: { kind: human }
createdAt: 1794181233331
updatedAt: 1794870795045
dependsOn: [card-mw89f8vw-1, card-mwam3st6-1]
---

## Description
Free 1.0.11 introduced starting the 14-day Pro trial the first time a gated Pro feature opens, not at activation. Free 1.0.12 was prepared with `@tempuskg/mwnn-kanban-pro` 1.0.6 but was never published (gallery and tags jump 1.0.11 → 1.0.13). This smoke test now targets the latest published free release, **1.0.17**, which bundles `@tempuskg/mwnn-kanban-pro` **1.0.9** and still carries that trial-on-first-Pro-open behaviour.

Install 1.0.17 from the Marketplace or Open VSX into a clean profile, for example `code --user-data-dir <temp> --extensions-dir <temp-ext>`, with no license key and no stored trial. Local 1.0.12 packaging was already checked on `card-mwam3st6-1`.

## Acceptance criteria
- [x] The installed version is 1.0.17 and Pro loads from the shipped `node_modules/@tempuskg/mwnn-kanban-pro` (1.0.9)
- [x] After activation alone, the license status shows no trial, and My Work does not appear
- [x] Running Open Portfolio opens the Portfolio, the license status shows an active trial, and `mwnn-kanban-pro.trialStartedAt` is written
- [x] Reloading the window keeps the same `trialStartedAt`

## Activity
- 2026-11-10 Claude: Changed the target from 1.0.11 to 1.0.12, which still bundles Pro 1.0.6. Now depends on the local 1.0.12 test card `card-mwam3st6-1`.

### 2026-11-16T09:10:21.020Z - AI-guided interview started in Cursor
Opened an interview chat in Cursor. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

### 2026-11-16 - Retarget away from unpublished 1.0.12 (verified evidence + user-reported)
- Verified: `npx @vscode/vsce show darrenjmcleod.mwnn-kanban` lists 1.0.11 then 1.0.13–1.0.17 (no 1.0.12). Local `git tag -l "v1.0.*"` has no `v1.0.12`. Open VSX latest and Marketplace latest are both 1.0.17; lockfile at release commit `5c7408d` resolves `@tempuskg/mwnn-kanban-pro` 1.0.9.
- Q: Treat Marketplace/Open VSX 1.0.12 as unavailable and pick a different install target? A: "Pick the latest published free version" (user-reported by Darren McLeod in interview chat, 2026-11-16). Card retargeted to free 1.0.17 / Pro 1.0.9.

### 2026-11-16 - Clean-profile install of 1.0.17 (verified evidence)
- Temp profile: `%TEMP%\mwnn-clean-user`, extensions: `%TEMP%\mwnn-clean-ext`, workspace: `%TEMP%\mwnn-clean-workspace`.
- `code --user-data-dir ... --extensions-dir ... --install-extension DarrenJMcLeod.mwnn-kanban --force`: installed `darrenjmcleod.mwnn-kanban@1.0.17`.
- On disk: `...\darrenjmcleod.mwnn-kanban-1.0.17\package.json` = mwnn-kanban@1.0.17; `...\node_modules\@tempuskg\mwnn-kanban-pro\package.json` = @tempuskg/mwnn-kanban-pro@1.0.9 (`dist/index.js` present).
- Extension host log: `[pro] Loaded Pro features from '@tempuskg/mwnn-kanban-pro'`. Criterion 1 met.

### 2026-11-16 - Activation alone: no trialStartedAt yet (verified evidence, UI pending)
- After activation with `--disable-workspace-trust`, extension host activated `darrenjmcleod.mwnn-kanban` on `onStartupFinished` and logged `[pro] Loaded Pro features from '@tempuskg/mwnn-kanban-pro'`.
- Clean-profile `User\globalStorage\state.vscdb` still has no `DarrenJMcLeod.mwnn-kanban` memento and no `mwnn-kanban-pro.trialStartedAt` key (rechecked after relaunch).
- Awaiting UI confirmation that Show Pro License Status reports not activated and My Work is absent.

### 2026-11-16 - Interview: activation UI (user-reported + verified)
- Q: After activation only, does Show Pro License Status report Pro is not activated, and is My Work absent? A: "yes and yes" (user-reported by Darren McLeod in interview chat, 2026-11-16).
- Matches verified absence of `trialStartedAt` in the clean profile. Criterion 2 met.

### 2026-11-16 - Interview: Open Portfolio (user-reported + verified evidence)
- Q: Did the Portfolio open after Open Portfolio? A: There is no `MWNN Kanban: Open Portfolio`; the command is `MWNN Kanban Pro: Open Portfolio`, and it worked (user-reported by Darren McLeod in interview chat, 2026-11-16).
- Verified: clean-profile `state.vscdb` key `darrenjmcleod.mwnn-kanban` now holds `{"mwnn-kanban-pro.trialStartedAt":1794848576164}`; webview origin for `mwnn-kanban-pro.portfolio` is present. UI status / My Work still pending.

### 2026-11-16 - Interview: license status after Open Portfolio (user-reported)
- Q: After Open Portfolio, does Show Pro License Status report that Pro is active? A: "Yes" (user-reported by Darren McLeod in interview chat, 2026-11-16). My Work visibility still pending.

### 2026-11-16 - Interview: My Work after Open Portfolio (user-reported)
- Q: After Open Portfolio, does My Work appear in the MWNN Kanban activity-bar container? A: "Yes" (user-reported by Darren McLeod in interview chat, 2026-11-16).
- Criterion 3 met: Portfolio opened via `MWNN Kanban Pro: Open Portfolio`, status active, My Work visible, and `trialStartedAt` = 1794848576164 (verified). Pre-reload baseline for criterion 4: 1794848576164.

### 2026-11-16 - Reload persistence pending
- Pre-reload baseline reconfirmed: `{"mwnn-kanban-pro.trialStartedAt":1794848576164}`.
- Awaiting window reload in the clean profile, then re-read of `trialStartedAt` and UI confirmation.

### 2026-11-16 - Interview: reload finished (user-reported + verified evidence)
- Q: Reload the clean window and reply when finished. A: "reload finished" (user-reported by Darren McLeod in interview chat, 2026-11-16).
- Post-reload `state.vscdb` still has `{"mwnn-kanban-pro.trialStartedAt":1794848576164}` — same value as pre-reload baseline (verified). UI status / My Work after reload still pending.

### 2026-11-16 - Interview: UI after reload (user-reported)
- Q: After reload, does Show Pro License Status still report Pro is active, and is My Work still present? A: "yes and yes" (user-reported by Darren McLeod in interview chat, 2026-11-16).
- Criterion 4 met: same `trialStartedAt` (verified) and matching UI (user-reported).

### 2026-11-16 - Closing summary
- Criterion 1 met (verified): Marketplace install `darrenjmcleod.mwnn-kanban@1.0.17` with shipped `@tempuskg/mwnn-kanban-pro@1.0.9`.
- Criterion 2 met (verified + user-reported): activation alone left no `trialStartedAt`; status not activated; My Work absent.
- Criterion 3 met (verified + user-reported): `MWNN Kanban Pro: Open Portfolio` opened Portfolio; status active; My Work appeared; `trialStartedAt` written as 1794848576164.
- Criterion 4 met (verified + user-reported): after reload, `trialStartedAt` unchanged; status still active; My Work still present.
- No unresolved exceptions. Assignee left as human. Column left unchanged (Implement); Done move left to board WIP rules.
STATUS: DONE

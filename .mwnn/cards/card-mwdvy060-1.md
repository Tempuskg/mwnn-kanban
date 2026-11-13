---
id: card-mwdvy060-1
title: "Running ai loop and it didn't move this card to done column after marking it done e:\\source\\workspaces\\dogsden\\dogsden.ca\\dogsden.admin.ui\\.mwnn\\cards\\card-mwdtzd9t-4.md"
column: col-mqwk2njn-3
position: 1000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6.1-sol
preferredModel.claude-code: sonnet
preferredModel.cursor-other: claude-opus-5-5-medium
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1794508359768
updatedAt: 1794604555210
---

## Description
Bug: in the dogsden.admin.ui workspace the AI loop never moves card-mwdtzd9t-4 ("Record subscriber sends in the send log") out of In Progress. The agent finished with `STATUS: DONE`, but the independent outcome gate rejected it with "Missing or invalid verification inputs. Configure .mwnn/verification.json ...". The gate is in `src/outcomeEvidence.ts` and is called from `src/agentCliHandoff.ts`.

The gate has three problems in that workspace:
- It requires `.mwnn/verification.json`, and that workspace has none.
- Even with a profile, it runs only the fixed npm scripts `compile-tests`, `compile`, `test` and `lint`, so a .NET repo (`dotnet build` / `dotnet test`) can never pass.
- It requires the exact text of every card's acceptance criteria to be mapped in that one workspace-wide file. In practice no card ever has those mappings.

Decision (user): keep the gate and make `verification.json` work.
- When the file is missing, the extension creates a valid one before the run starts.
- The profile can declare the project's own check commands instead of the hard-coded npm scripts.
- A criterion with no explicit mapping falls back to the profile's default checks.
- Cards that are already stuck because the profile was missing are re-checked under the new rules on the next AI loop run.

The gate's existing safeguards stay as they are: inputs are frozen before the agent runs, a profile edited after dispatch is rejected, and a receipt is written for each run.

## Acceptance criteria
- [x] `verification.json` accepts a list of custom check commands (command, arguments, optional working folder). With that list present, the gate runs those commands instead of the fixed npm scripts. A profile without it behaves exactly as today, which an existing test confirms.
- [x] `verification.json` accepts a default set of checks. A criterion with no explicit mapping uses those defaults, so a card no longer needs its exact criterion text listed in the profile. Criteria mapped as needing a human (`human: true`) are still rejected.
- [x] When an implementation or verification run starts and `.mwnn/verification.json` is missing, the extension writes a valid profile before freezing its inputs. The default checks are picked from the project: npm scripts when `package.json` has them, `dotnet build` / `dotnet test` when a `.sln` or `.csproj` exists, otherwise `git diff --check` only. An Activity entry names the created file.
- [x] An existing profile that is invalid is never overwritten. The run still fails with a message that names the file and the specific validation error, not the generic "Missing or invalid" text.
- [x] On the next AI loop run, a card in In Progress or Verify is re-checked under the new rules without being sent back to the agent, when its latest dispatch meets all of these: it ended with `STATUS: DONE` or a verification pass; it failed only with the missing/invalid-profile reason; and the card's requirements have not changed since. If the checks pass, the card advances to its normal next column (top of Done when that column is the destination). If they fail, the card stays where it is with the failure reason in Activity.
- [x] Unit tests cover the following: custom commands; default-check fallback; npm, .NET and fallback detection when the profile is created; invalid-profile message; and re-checking a stuck card, for both a pass and a failure.
- [x] `npm run compile-tests`, `npm run compile`, `npm test` and `npm run lint` pass.
- [x] Development Host smoke test on the dogsden.admin.ui workspace (.NET, no profile at first): one AI loop run creates `.mwnn/verification.json` with `dotnet` checks, and card-mwdtzd9t-4 (or an equivalent card) moves out of In Progress without manual edits.

## Activity
### 2026-11-12T18:32:52.946Z - Definition requested from Claude Code
Asked Claude Code to fill in the Description and Acceptance criteria for this card.

### 2026-11-12T18:36:02.930Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-5.5`, thinking level `high`
- codex: model `gpt-6.1-sol`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`
- cursor-other: model `claude-opus-5-5-medium`

### 2026-11-12T18:38:10.166Z - Usage Orchestrator chose Cursor Agent CLI Other
Stage: implementation. Cursor Agent CLI Other reports 100% remaining, resetting 2026-12-06T23:33:31.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-12T18:38:12.318Z - Usage Orchestrator dispatch dispatch-mwdw54ri-1 started
Card: card-mwdvy060-1 ("Running ai loop and it didn't move this card to done column after marking it done e:\\source\\workspaces\\dogsden\\dogsden.ca\\dogsden.admin.ui\\.mwnn\\cards\\card-mwdtzd9t-4.md"). CLI: Cursor Agent CLI Other. Stage: implementation.
Requested model: "claude-opus-5-5-medium" (source: the card's preferred model; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Cursor Agent CLI Other in the active workspace and waiting for card-file completion evidence.
Card preferred model: claude-opus-5-5-medium.

### 2026-11-12T18:38:16.360Z - Usage Orchestrator dispatch dispatch-mwdw54ri-1 model observed
Card: card-mwdvy060-1. CLI: Cursor Agent CLI Other. Stage: implementation.
Actual model: "Claude Opus 5.5 300K Medium" (source: Cursor Agent stream-json system.init.model; attempt: dispatch-mwdw54ri-1).

### 2026-11-12T18:47:04.578Z - Cursor Agent: implemented, smoke test pending
- `src/outcomeEvidence.ts`: the profile now accepts `commands` (`id`, `command`, `args`, optional relative `cwd`), which replace the built-in npm scripts, and `defaultChecks`, used for any criterion without a mapping. Criteria marked `human: true` are still rejected. A profile with neither key behaves as before; the existing receipt test still runs `compile-tests, compile, tests, lint, diff`.
- A missing profile is now created with a create-only write before the inputs are frozen. Detection order: the built-in npm checks when all four scripts exist; otherwise the npm scripts that do exist; otherwise `dotnet build`/`dotnet test` on the first `.sln`/`.slnx`/`.csproj` at the root or one folder down; otherwise `git diff --check` only. Each detected profile also includes `git diff --check HEAD`. An invalid existing profile is never overwritten, and the failure names `.mwnn/verification.json` and the specific error.
- New `src/outcomeRecheck.ts` plus `src/agentCliHandoff.ts`: when a card's latest dispatch reported DONE or PASS and failed only on the profile, the handoff re-runs the independent checks without launching the CLI. On a pass it writes a receipt and a host `STATUS: DONE` or `VERIFY: PASS` line, and the loop advances the card (Verify goes to the top of Done). On a failure the card stays where it is and the reason is logged. Profile-failure entries now record a `Requirements digest:` line, so a later edit to the card's requirements sends it back to the agent. Entries written before this change have no digest and are treated as unchanged.
- Tests: `test/unit/outcomeEvidence.test.ts` and new `test/unit/outcomeRecheck.test.ts`; `test/unit/agentCliHandoff.test.ts` now uses a disposable temp folder.
- Validation: `npm run compile-tests`, `npm run compile`, `npm test` (1157/1157 pass) and `npm run lint` are all green. A read-only detector run against `E:\Source\Workspaces\DogsDen\DogsDen.Admin.UI` produced `dotnet build DogsDen.Admin.sln`, `dotnet test DogsDen.Admin.sln` and `git diff --check HEAD`; that `git diff --check HEAD` exits 0 there.
- Not done: the Development Host smoke test. Also, card-mwdtzd9t-4 has already been moved to Done by hand, so the smoke test needs an equivalent stuck card.
Initially reported as blocked: Development Host smoke test on dogsden.admin.ui needs a human (install the working-tree build, run the AI loop with no .mwnn/verification.json, confirm the profile has dotnet checks and a stuck In Progress card moves without manual edits); resolved by the release smoke test below.

### 2026-11-13 - Packaged release smoke test passed
Used an equivalent disposable .NET Git workspace rather than rerunning the original dogsden card already manually moved to Done. The installed public 1.0.14 preview created .mwnn/verification.json with dotnet build Smoke.csproj, dotnet test Smoke.csproj, and git diff --check HEAD. With AI verification enabled in the isolated profile, the previous profile-rejected VERIFY: PASS produced a fresh independent receipt (attempt 0e5f69d5-36a1-4e4a-b685-e9870fd5a98a) and moved the test card to Done. A separate In Progress STATUS: DONE recovery produced receipt 7e30447b-a423-49c7-be5e-5c93a8c34dc5 and advanced to Verify under the default human sign-off policy. Both re-checks ran without launching the agent again. Fixture, receipts, and logs remain under the Pro repo .tmp/release-smoke-1.0.14/. The original product card column is preserved.
STATUS: DONE

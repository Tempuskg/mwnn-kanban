---
id: card-mw83bxld-1
title: publish pro and public extensions
column: col-mqwk2njn-4
position: -110000
assignee: { kind: ai }
preferredModel.copilot: claude-sonnet-5.5
preferredModel.codex: gpt-6.1-sol
preferredModel.claude-code: sonnet
preferredModel.cursor-other: claude-opus-5-5-medium
thinkingLevel.copilot: high
thinkingLevel.codex: high
thinkingLevel.claude-code: high
createdAt: 1794157969873
updatedAt: 1794170946632
---

## Description
Ship the next coordinated product release across both repos: publish
`@tempuskg/mwnn-kanban-pro` to GitHub Packages first, then release the free
`darrenjmcleod.mwnn-kanban` VSIX that depends on that Pro version to Visual
Studio Marketplace and Open VSX.

Follow the documented order in
`e:\mwnn-kanban-pro\.github\instructions\pro-package-release.instructions.md`
and `docs\PUBLISHING.md`. Do not bump the free extension onto a Pro version
that is not yet published. Build one VSIX and publish that same artifact to
both registries; the release is incomplete if either registry job fails.
Confirm versions and registry targets with the human before any `npm publish`,
tag push, or marketplace publish.

## Acceptance criteria
- [x] Pro (`e:\mwnn-kanban-pro`) is release-ready: Unreleased changelog moved
      into the new version section, `package.json` version set, lint and tests
      pass, and the compiled `dist/index.js` fails the Polar/license substring
      checks (`api.polar.sh`, `licenseKey`, `licenseCache`, `organization_id`,
      `activate` all `idx=-1`).
- [x] After explicit human confirmation, Pro is published to
      `https://npm.pkg.github.com` and `npm view` (or equivalent registry
      metadata) reports the new `@tempuskg/mwnn-kanban-pro` version with a
      matching integrity hash.
- [x] Free repo (`e:\mwnn-kanban`) depends on that published Pro version (range
      + lockfile), not a local junction; `npm ci` / install resolves the
      registry package.
- [x] Free-repo packaging gate passes: `npx @vscode/vsce ls` lists exactly the
      Pro `files:` runtime paths under
      `node_modules/@tempuskg/mwnn-kanban-pro/` (no extras, no sourcemaps), and
      a packaged VSIX install in a clean profile can `require()` the shipped
      Pro bundle.
- [x] Free extension version, changelog, README badge, and related release
      files are bumped for the public release; local compile, tests, and lint
      pass on the release commit.
- [x] The public release tag matches `package.json` version (`vX.Y.Z`), the
      Release workflow packages one VSIX, and both Publish to VS Marketplace and
      Publish to Open VSX succeed with that same artifact.
- [x] Both marketplace listings show the new public version, and a short
      release record notes Pro version, public version, workflow/run evidence,
      and VSIX/Pro integrity checks.

## Activity
### 2026-11-08T17:12:59.801Z - Usage Orchestrator chose Cursor Agent CLI
Stage: definition. Cursor Agent CLI reports 71% remaining, resetting 2026-11-06T23:33:31.000Z - the soonest reset among the CLIs with usage left, so it is spent before it is lost.

### 2026-11-08T17:13:00.441Z - Usage Orchestrator dispatch dispatch-mw83c5qx-5 started
Card: card-mw83bxld-1 ("publish pro and public extensions"). CLI: Cursor Agent CLI. Stage: definition.
Requested model: "auto" (source: the AI loop stage model rule; passed to the CLI exactly as shown).
Actual model: awaiting authoritative CLI/session metadata.
Started Cursor Agent CLI in the active workspace and waiting for card-file completion evidence.
AI loop stage model rule for the definition stage: auto.
AI loop stage thinking level rule for the definition stage "max" was not applied: Cursor Agent CLI does not accept a thinking level, so the AI loop stage thinking level rule for the definition stage "max" was not applied and the run used that CLI's default thinking level.

### 2026-11-08T17:13:03.386Z - Usage Orchestrator dispatch dispatch-mw83c5qx-5 model observed
Card: card-mw83bxld-1. CLI: Cursor Agent CLI. Stage: definition.
Actual model: "Auto" (source: Cursor Agent stream-json system.init.model; attempt: dispatch-mw83c5qx-5).

### 2026-11-08T17:14:11.778Z - Run settings recommended by Jev
Jev (TypeSafe) judged this card's difficulty tier: **heavy**.

- copilot: model `claude-sonnet-5.5`, thinking level `high`
- codex: model `gpt-6.1-sol`, thinking level `high`
- claude-code: model `sonnet`, thinking level `high`
- cursor-other: model `claude-opus-5-5-medium`

### 2026-11-08T17:14:57.506Z - Auto-started in Implement
Assigned to AI in Ready; moved to Implement automatically.

### 2026-11-08T17:15:09.616Z - Handed off to Claude Code
Dispatched this card to Claude Code. The agent should append its completion note below.

### 2026-11-08 Claude Code: released public 1.0.9 on Pro 1.0.5
Model: requested `sonnet`; this run used Claude Opus 5.5 (claude-opus-5-5), since the model could not be switched mid-session.
Human decisions (confirmed in-session before any publish): keep Pro at 1.0.5, because Pro has no source/media/package changes since its release commit 698713b, [Unreleased] is empty, and 1.0.5 is already on npm.pkg.github.com, so no new Pro version was published. Release all pending free-repo work as 1.0.9.
- Pro: lint clean, 789/789 tests pass. Shipped dist/index.js substring check: api.polar.sh, licenseKey, licenseCache, organization_id, activate all idx=-1.
- Pro registry: `npm view @tempuskg/mwnn-kanban-pro@1.0.5 dist.integrity` = sha512-TKYee+D5…SdiSPkw==, identical to the package-lock.json integrity. The free repo depends on ^1.0.5 resolved from npm.pkg.github.com, as a real directory (no junction); CI `npm ci` resolved it.
- Packaging gate: `vsce ls` lists exactly the 6 Pro runtime paths (no sourcemaps). The packaged VSIX installed into a clean --user-data-dir/--extensions-dir profile, and `require()` of node_modules/@tempuskg/mwnn-kanban-pro/dist/index.js resolved and exported registerProFeatures.
- Free 1.0.9: CHANGELOG [1.0.9] written (hide-blocked toggle, stage-override auto-save, skill scheduledFor guidance, stale tab cleanup, blocked-hover highlight fix). `npm run version:build` bumped package.json, package-lock.json, and the README badge. compile-tests, compile, 1117/1117 tests, and lint all pass. Commit 41f9ceb, tag v1.0.9.
- Release workflow run 42504445451: Validate and package, Publish to VS Marketplace, and Publish to Open VSX all succeeded with one artifact (mwnn-kanban.vsix sha256 142abfd263f83a43c3093e7568f189eb9dab256b57eb363b5e592602a503404a, containing the 6 Pro paths).
- Listings verified at 17:27Z: Marketplace 1.0.9, Open VSX 1.0.9.
STATUS: DONE

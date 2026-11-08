---
id: card-mw83bxld-1
title: publish pro and public extensions
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
createdAt: 1794157969873
updatedAt: 1794158109777
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
- [ ] Pro (`e:\mwnn-kanban-pro`) is release-ready: Unreleased changelog moved
      into the new version section, `package.json` version set, lint and tests
      pass, and the compiled `dist/index.js` fails the Polar/license substring
      checks (`api.polar.sh`, `licenseKey`, `licenseCache`, `organization_id`,
      `activate` all `idx=-1`).
- [ ] After explicit human confirmation, Pro is published to
      `https://npm.pkg.github.com` and `npm view` (or equivalent registry
      metadata) reports the new `@tempuskg/mwnn-kanban-pro` version with a
      matching integrity hash.
- [ ] Free repo (`e:\mwnn-kanban`) depends on that published Pro version (range
      + lockfile), not a local junction; `npm ci` / install resolves the
      registry package.
- [ ] Free-repo packaging gate passes: `npx @vscode/vsce ls` lists exactly the
      Pro `files:` runtime paths under
      `node_modules/@tempuskg/mwnn-kanban-pro/` (no extras, no sourcemaps), and
      a packaged VSIX install in a clean profile can `require()` the shipped
      Pro bundle.
- [ ] Free extension version, changelog, README badge, and related release
      files are bumped for the public release; local compile, tests, and lint
      pass on the release commit.
- [ ] The public release tag matches `package.json` version (`vX.Y.Z`), the
      Release workflow packages one VSIX, and both Publish to VS Marketplace and
      Publish to Open VSX succeed with that same artifact.
- [ ] Both marketplace listings show the new public version, and a short
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

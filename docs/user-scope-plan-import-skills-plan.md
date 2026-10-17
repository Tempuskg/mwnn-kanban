# Default user-scope installation for Import Plan skills

Date: 2026-10-17
Status: Proposed

## Goal

Make `MWNN Kanban: Import Plan` install the bundled `mwnn-plan-import` and
`mwnn-card-authoring` guidance at user scope by default, so importing a plan does
not add AI instruction files to the project. Keep workspace installation as an
explicit option.

Installation remains on demand when Import Plan runs. Automatically installing
skills during extension activation is outside this plan.

## Current evidence

The current working tree already includes user-scope installation support:

- `package.json` contributes `mwnn-kanban.skillsInstallLocation`, with
  `workspace` and `user` options, but its default is `workspace`.
- `src/extension.ts` reads that setting with a `workspace` fallback and selects
  the existing user or workspace installer before handing off the plan.
- `src/skills.ts` already plans user-level writes and reference paths, preserves
  content outside the Codex managed block, and reports Cursor as skipped.
- `test/unit/skills.test.ts` already covers user paths, rendering, environment
  deduplication, reference-path consistency, and managed-block preservation.

These are existing uncommitted changes. Implementation must preserve them and
verify their current state rather than reimplementing them. This plan does not
claim those changes have passed tests.

## Intended behavior

- With no explicit setting, Import Plan uses user installation for both bundled
  documents, for detected AI environments plus the selected handoff provider.
- Explicit `workspace` and `user` settings retain their existing behavior and
  VS Code configuration precedence. Do not rewrite users' settings.
- Missing or invalid setting values resolve to `user` consistently with the
  contributed default.
- User mode neither creates, updates, nor removes workspace skill files or
  the workspace `AGENTS.md`. Previously installed workspace guidance remains.
- Repeated imports skip unchanged user files and preserve unrelated user
  instructions. Changing this default does not change the skill content.
- Installation failures retain the existing warning and self-contained prompt
  fallback; they do not prevent the plan handoff.
- Keep the existing Cursor skip and informational message; do not silently
  install workspace files as a fallback.

The current implementation targets Claude Code and Copilot user `SKILL.md`
folders and a managed block in Codex's user `AGENTS.md`, honoring `CODEX_HOME`.
These are repository implementation facts, not independently verified claims
about current provider discovery. Validate provider compatibility before
claiming the skills are automatically discovered by every provider.

## Work items

### 1. Change the configuration and runtime defaults

- [ ] Change the contributed setting default in `package.json` to `user`.
- [ ] Change `readSkillsInstallLocation()` in `src/extension.ts` so its missing
  and invalid value fallbacks both select `user`; retain explicit `workspace`.
- [ ] Update nearby comments and setting descriptions to explain the new
  default and the retained workspace option.

Acceptance: an unset or invalid value selects user installation; an explicit
workspace value selects workspace installation. No configuration migration or
activation-time installation is introduced.

### 2. Verify configuration routing and repository isolation

Depends on item 1.

- [ ] Add focused coverage for unset, invalid, `user`, and `workspace` values,
  using the smallest existing test seam; extract a pure resolver only if needed.
- [ ] Verify that the contributed default and runtime default agree.
- [ ] Exercise the import installation branch with temporary user and workspace
  roots: default mode writes only user targets, explicit workspace mode still
  writes workspace targets, and handoff references match the selected scope.
- [ ] Reuse existing tests for `CODEX_HOME`, repeated installation, unrelated
  Codex instruction preservation, and Cursor skipping; add coverage only for
  gaps in changed behavior.
- [ ] Verify a write failure still produces a usable self-contained handoff.

Acceptance: focused checks demonstrate the default routing, explicit override,
repository isolation, and existing failure fallback without writing into a real
user profile from automated tests.

### 3. Document and smoke-test the new default

Depends on item 2 passing targeted validation.

- [ ] Update the installation-scope section in `README.md` and add a concise
  `CHANGELOG.md` entry after the behavior is stable. Explain that old workspace
  files remain and that existing explicit settings retain precedence.
- [ ] In a Development Host with a disposable workspace and isolated user
  environment, clear the setting, import a small plan, and inspect user targets,
  handoff references, and the workspace diff.
- [ ] Repeat the import to confirm unchanged files are not rewritten; select
  `workspace` and verify that the existing workspace path still works.
- [ ] Exercise Cursor and an unwritable user target to confirm the skip and
  warning behavior while the handoff continues.
- [ ] Confirm user guidance is available to the supported handoff providers;
  record any provider restart or discovery requirement found during the check.

Acceptance: documentation matches verified behavior; default imports add no
workspace instruction files; explicit workspace installs and fallback handoffs
remain usable.

## Validation order

For implementation, use touched-file diagnostics, `npm run compile-tests`,
`npm run compile`, focused relevant tests, `npm test`, `npm run lint`, then the
Development Host smoke checks above. Re-read `package.json` before running
commands and use its actual current scripts. Rebuild stale `dist-test` output
before interpreting test failures.

If only the Development Host checks remain unmet, report `STATUS: BLOCKED`,
provide the exact outstanding checks, and offer to package and install the
working-tree build under the local test-install rule. Do not mark the feature
complete based on unit tests alone.

## Scope and completion

The implementation surface is extension-host configuration and installation;
no webview or shared message-protocol change is expected. Do not add new
installation destinations, delete old workspace guidance, bump a release
version, publish, or import this plan into the board as part of this request.

Done means both defaults select user scope, explicit workspace installation
still works, tests and smoke checks pass, and user documentation reflects the
verified behavior.

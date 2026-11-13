# Independent verification for CLI work

Local CLI implementation DONE and verification PASS are requests to run checks. MWNN accepts them only after its own checker runs the project checks and records a receipt for the exact requirements and code. CLI permissions and allow/deny settings are unchanged.

## Configure a project

Run from the Git repository root, with a committed HEAD. Before an implementation or verification dispatch, MWNN creates a missing `.mwnn/verification.json` and records its path in Activity. It detects available npm scripts first, then a .NET solution or project at the root or one folder down, otherwise a Git diff check only. Review the generated checks: a diff check alone does not establish functional correctness. Existing profiles are never overwritten; an invalid profile reports its specific error.

Edit `.mwnn/verification.json` at the repository root; its location stays the same even when the board folder is customized. Map the exact text of each acceptance checkbox, without its Markdown marker, to checks that demonstrate that criterion, or provide `defaultChecks` for unmapped criteria. A profile may cover criteria from several cards. Explicit `human: true` mappings still require human verification.

```json
{
  "version": 1,
  "criteria": [
    {
      "text": "Disabled providers cannot launch a process",
      "checks": ["focused-tests", "tests"]
    },
    {
      "text": "The panel is usable in the Development Host",
      "checks": [],
      "human": true
    }
  ],
  "focusedTests": [
    "dist-test/test/unit/agentCliAccess.test.js",
    "dist-test/test/unit/agentCliHandoff.test.js"
  ]
}
```

Without custom commands, available check ids are `compile-tests`, `compile`, `focused-tests`, `tests`, `lint`, and `diff`. Focused paths must name compiled `.test.js` files inside `dist-test/test/`. No command strings are read from card Activity or from an agent's suggested verification commands. The configured npm scripts are ordinary project scripts; review their behavior before approving unattended work. A mapping to lint or compilation is appropriate only for a criterion those checks actually prove.

With the built-in npm profile, MWNN runs `npm run compile-tests`, `npm run compile`, configured focused tests, `npm test`, `npm run lint`, and `git diff --check HEAD`, in that order. Every check must start and exit zero, and test commands must report a nonzero Node test count and passing-test count. A check times out after 15 minutes; stopping the handoff cancels the active check. Missing mappings without defaults, manual criteria, failed commands, missing built-in test summaries, cancellation and unreadable inputs leave the work open.

For other project checks, declare commands with unique ids, an executable, arguments, and an optional project-relative working folder. Custom commands replace the built-in npm sequence and run in their declared order. All must exit zero; custom test tools do not need Node test summaries. For example:

```json
{
  "version": 1,
  "criteria": [],
  "commands": [
    { "id": "build", "command": "dotnet", "args": ["build", "Example.sln"] },
    { "id": "test", "command": "dotnet", "args": ["test", "Example.sln"] },
    { "id": "diff", "command": "git", "args": ["diff", "--check", "HEAD"] }
  ],
  "defaultChecks": ["build", "test", "diff"]
}
```

Commands come from the project profile, never card Activity or agent suggestions. Review their behavior before unattended work. `focusedTests` applies only to the built-in npm profile; use a custom command for other focused test runners.

The profile, scripts, root `AGENTS.md`, `.github/copilot-instructions.md`, root `CLAUDE.md`, prompt and card requirements are captured before the CLI runs. If the agent changes the profile, package manifest, or those instruction files, a new dispatch must capture the new inputs. Checkbox state and Activity text may change without rewriting the requirements.

## What a receipt means

MWNN hashes the Git HEAD, tracked and nonignored untracked file contents, deletions and file modes. Workflow cards under the configured board folder's `cards/` directory are excluded from the code hash because their requirements are checked separately and their Activity is expected to grow. The production host supplies each project's configured board folder; direct checker callers default to `.mwnn`. Gitignored build outputs are outside the code fingerprint. Symlinks, submodules and unsupported file types require human review.

The checker compares code and inputs before and after running checks and saving the receipt. The receipt identifies the checker version, canonical project root, card, stage, host-generated run and attempt ids, input and checked revisions, command arguments, exit codes, test counts and timestamps. Output is hashed; raw output, prompts, instruction contents and credentials are not copied into receipts. Receipts live in the editor-neutral worker store under `evidence/<project-hash>/<attempt-id>.json`. Activity records the receipt path and digests.

Before a production board or portfolio loop advances completed work, it revalidates the live host receipt against the current code and requirements. Merely mentioning a receipt path in Activity cannot supply this proof. Chat-extension handoffs have no live host checker session and therefore require human review before automatic advancement; their DONE/PASS text alone is insufficient. Definition, triage, BLOCKED, FAIL and HUMAN outcomes retain their existing meanings.

When the latest dispatch reported DONE or PASS but failed only because the profile was missing or invalid, the next loop run can re-run independent checks without dispatching the agent again. A pass writes a fresh receipt and completion marker; a failure leaves the card open. A recorded requirements digest must still match. Older failure entries without a digest remain eligible, so review any requirements edits to those cards.

After an interrupted attempt or restart, MWNN does not import a passing receipt from disk or automatically retry ambiguous completed work. It hands the outcome to a person for fresh verification. Persisted receipts are an audit record, not an automatic recovery credential.

These checks run outside the agent's response, but they are not an operating-system security boundary against a CLI with the user's existing permissions. Tests must meaningfully cover the mapped criteria. Manual review remains necessary where automated checks cannot establish the outcome.

## Development Host check

1. Use a disposable npm Git repository with the required scripts and a profile covering a test card.
2. Run the card through a local CLI that reports DONE. Confirm the independent-check Activity entries, saved receipt, and advancement only after successful checks.
3. Fail a mapped test, remove a mapping, or change a source file after checking. Confirm the card is not advanced or automatically checked off.
4. Stop during a check, then exercise pause/restart recovery. Confirm there is no automatic acceptance from terminal text or a receipt path.
5. Use a chat handoff with PASS alone. Confirm human review is requested instead of an automatic move to Done.

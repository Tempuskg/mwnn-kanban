# Contributing to MWNN Kanban

## Pull-request reviews with Rabbit

Rabbit means **CodeRabbit**, the designated handler for GitHub PR review
requests in this repository. `.coderabbit.yaml` configures its GitHub App.
A repository administrator must first enable the App for
`Tempuskg/mwnn-kanban` using the [CodeRabbit setup guide](https://docs.coderabbit.ai/getting-started/quickstart).
The configuration file alone does not install or authorize the App.

Open a non-draft PR to any target branch, or mark a draft ready for review, to
request a review automatically. Each new push requests an incremental review.
To request a review explicitly, add a PR conversation comment:

```text
@coderabbitai review
```

Put the scope, acceptance criteria, and validation results in the PR description;
keep additional review instructions in its comments. The PR itself is the
request record: title, description, source and target branches, diff, and comment
history remain available to the reviewer. Summaries go in CodeRabbit's walkthrough
comment, preserving the author's description during automatic reviews. Explicit
content-generation commands such as `@coderabbitai summary` are separate opt-ins.
CodeRabbit handles the review through its App; it is not a GitHub user assignee
or a new provider in the extension's Run Card with AI picker.

## Acknowledgement and outcomes

Inspect CodeRabbit's progress/check report and walkthrough in the PR conversation.
An in-progress report acknowledges receipt. Only a completed review for the latest
head commit is completion evidence; a green PR CI job alone does not prove that
Rabbit received or reviewed the request. Findings can require work even after
the review completes. Human merge decisions and the existing PR CI stay in place.

| Observable outcome | Action |
| --- | --- |
| Review completed | Read the walkthrough and inline findings; verify the reviewed commit matches the latest PR head. |
| Draft skipped | Rabbit is blocked by draft status. Mark the PR ready for review. `review_status` keeps the reason visible. |
| Review paused or ignored | Use `@coderabbitai resume` for a paused review; remove `@coderabbitai ignore` from the description if present, then request `@coderabbitai review`. |
| Review failed | Read the reported error, correct the stated cause, and request `@coderabbitai review` again. `fail_commit_status` makes review errors fail the outward status. |
| Invalid review command | Compare the comment with the [supported commands](https://docs.coderabbit.ai/reference/review-commands); use `@coderabbitai help` in the PR and resubmit the correct command. |
| No acknowledgement | Do not count this as success. Have an administrator confirm the App is installed, has access to this repository, and reviews are enabled. Check [service status](https://status.coderabbit.ai/), then request `@coderabbitai review`. If still silent, report the PR URL, head SHA, request time, and command to [CodeRabbit support](https://docs.coderabbit.ai/support). |

An issue or Kanban card is not this PR intake path. Requests there continue through
their existing workflows; automatic issue enrichment, planning, and labeling are
disabled in the CodeRabbit configuration. A PR review needs an actual GitHub PR with a diff;
create that PR first if the request only exists in an issue or card.

## Repeatable verification

After enabling the App, use a disposable branch with a small reviewable source
change and `.coderabbit.yaml`. Do not merge the verification change. Save the PR
URL, head SHA, request time, and links to Rabbit's acknowledgement and final
outcome in the work card's Activity. Repeat after changing review configuration.

1. **Blocked request:** open the branch as a draft PR with a recognizable title
   and description containing a scope, acceptance criterion, and validation note.
   Verify CodeRabbit identifies the draft as skipped. Record the actual message
   and the recovery action (mark ready); absence of a message fails this check.
2. **Successful routing:** save the title, body, base/head branches, and diff,
   then mark the same PR ready. Observe CodeRabbit's in-progress acknowledgement
   and wait for its final completed review on the recorded head SHA. Confirm the
   saved request details are preserved and the findings refer to that diff.
3. **Explicit intake:** push a second small change and post `@coderabbitai review`
   with a specific review instruction. Verify the comment remains intact and
   CodeRabbit completes a review covering the new commit. Do not count an older
   completed review as acknowledgement of this request.
4. **Failure recovery:** if CodeRabbit reports a processing error, verify its
   check fails and the report gives a cause. Record it, resolve the cause, and
   rerun the explicit request. A silent request, missing reason, or indefinitely
   pending review is an unresolved verification failure, never a pass.
5. **Non-PR regression:** run the existing checks below and confirm the PR CI
   workflow still runs its normal validation. Run a normal AI card handoff through
   the existing provider picker and verify its provider and Activity status are
   unchanged. Close the disposable PR after recording the evidence.

Run repository checks from the workspace root in PowerShell, stopping on failure:

```powershell
npm run compile-tests
npm run compile
node --test dist-test/test/unit/runWithAi.test.js dist-test/test/unit/chatHandoff.test.js dist-test/test/unit/boardLoop.test.js
npm test
npm run lint
```

Validate `.coderabbit.yaml` with the official
[YAML validator](https://docs.coderabbit.ai/configuration/yaml-validator) or its
[JSON schema](https://coderabbit.ai/integrations/schema.v2.json). Check malformed
YAML and an invalid field type (for example, a string for `reviews.auto_review.enabled`)
are rejected before committing. Schema validation and local unit tests do not
prove that the installed GitHub App receives requests; retain live PR evidence
for both the successful and blocked scenarios above.

The [configuration reference](https://docs.coderabbit.ai/reference/configuration)
describes review status/progress settings, and
[automatic review controls](https://docs.coderabbit.ai/configuration/auto-review)
describe draft handling and manual triggers.

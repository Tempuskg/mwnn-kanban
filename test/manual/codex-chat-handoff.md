# Codex first-assignment handoff investigation

Card: `.mwnn/cards/card-mvddaz91-1.md`.

## Current acknowledgement correction (2026-10-18)

User reports that the startup-order handoff **worked**, but the same
eight-attempt "Could not hand off" notification appeared and reported no
Activity entry. This supplies reported native delivery success for that
attempt, alongside a false failure notification. It does not establish the
three fresh Development Host trials or independently verify complete text.

The new regression inserts the complete prompt successfully while Copy
silently leaves the clipboard unchanged. Before correction, the result
claimed failure without distinguishing unavailable readback. It now returns
an explicit unconfirmed outcome. A neutral information notification offers
**Prompt is present** and **Prompt is missing**. Confirming the complete prompt
records one successful handoff through the existing caller; missing prompt
reports a genuine failure, and dismissing records no success. Confirmation
never opens a new chat or repeats the paste. The per-card guard and shared
queue remain held while confirmation is pending, preventing duplicate actions.

Automatic complete-text readback still finishes without user confirmation.
Observed mismatches and explicit activation/open/paste errors retain failure
notifications. An unavailable Copy result is not treated as success or as
proof of missing delivery. This is a human-confirmation fallback for the
unreliable clipboard acknowledgement, not a new provider acknowledgement API.

After reloading this build, assign the card once. If the neutral verification
notification appears and the complete selected-card prompt is visible, choose
**Prompt is present**. Verify one successful Activity entry and no second chat,
second paste or "Could not hand off" notification. Also exercise **Prompt is
missing** and dismissal in a disposable test workspace: neither may record
success, and a later retry must be allowed. Do not assign again merely because
automatic confirmation was unavailable.

Acknowledgement build validation: focused handoff/interview tests **56 passed**;
complete unit suite **811 passed**. Test compilation, webpack build, production
packaging, lint and scoped whitespace checks passed. Packaged with dependencies
and installed version 1.0.2 from
`C:\Users\darre\AppData\Local\Temp\mwnn-kanban-card-mvddaz91-1-acknowledgement.vsix`.
Verified the runtime dependency and matching working-tree/VSIX/installed bundle
SHA256:
`E37CACF33D1D81397F91738DA828B6ABF2A7FB2223EE670D3159AABEDAB1D6B7`.
Native confirmation behavior and the required three fresh Development Host
reload trials remain **NOT RUN**. Existing user-reported delivery success is
retained as evidence for the previous startup-order build.

## Previous startup ordering correction (2026-10-18)

The user tested the six-second-wait correction and reported that Codex looked
ready but showed the same eight-attempt acknowledgement warning. Asked what
was in its composer, the user answered **Completely empty**. This is a failed
installed-build delivery result, not merely an unconfirmed Copy readback.

That build requested the new chat while Codex was still starting, then waited
six seconds before pasting. The new correction opens the sidebar and allows
six seconds for startup **before** its single new-chat request. It then gives
the new-chat request 300 ms to focus its composer before the single prompt
insertion. Asynchronous clipboard settling and complete-prompt verification
remain. Targets without a separate prepare command retain a six-second wait
after their new-chat request.

The new regression models startup finishing with an unfocused composer when
the new-chat request was queued too early. It failed before this ordering
change with the same acknowledgement error and now passes with exactly one
new-chat request issued after startup. Focus loss on initialization is a
working hypothesis consistent with the reported empty composer; it has not
been independently traced in the native Codex webview. The startup allowance
still uses a bounded delay rather than a provider readiness receipt.

Follow the Development Host procedure below after reloading the installed
build. The new-chat UI should now be requested after the startup pause, and
its composer must receive the full selected-card prompt on that assignment.
No diagnostic tokens, repeated pastes or manual paste should be needed.

Startup-order build checks: focused regressions **50 passed**, full suite
**805 passed**, test compilation/build/lint/whitespace checks passed. Packaged
with runtime dependencies and installed version 1.0.2 from
`C:\Users\darre\AppData\Local\Temp\mwnn-kanban-card-mvddaz91-1-startup-order.vsix`.
Installed extension, VSIX and working-tree bundle SHA256 all match:
`27358E7D9AFD378F79F515EAA8B3CE5358499E8F744BF728D3C3159045C5AD54`.
Native startup-order build checks remain **NOT RUN** pending window reload
and user testing; the earlier empty-composer result remains a failed result
for the previous build.

## Previous correction after the failed token smoke test (2026-10-18)

The user reported "It pasted this a bunch of times" and supplied a screenshot
showing a selected `[MWNN preparing handoff ...]` token in Codex's composer,
rather than the card prompt. This is a failed smoke result for the installed
token-based build. The earlier automated evidence did not model asynchronous
webview clipboard updates and was insufficient to establish native readiness.

The [VS Code webview implementation](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/webview/browser/webviewElement.ts)
forwards Copy/Paste using a message without awaiting execution in the renderer.
The previous probe read the clipboard immediately after Copy. If Copy updates
later, each next probe can overwrite its result and paste the token again.
This race is reproduced with deferred clipboard updates; it is an inferred
cause of the reported screenshot, not an independently captured native trace.

Removed all readiness-token insertion and its retry loop. The handoff now
allows six seconds after requesting the new chat, covering the previously
reported approximately five-second startup, then inserts each card-prompt
chunk once. It leaves each chunk on the clipboard for 150 ms before proceeding.
Verification writes its distinct clipboard sentinel once (never pastes it),
requests Select All/Copy and waits 250 ms before reading. Polls do not overwrite
an outstanding Copy result or repeat the prompt paste. Complete-prompt readback
is still required before success, with visible failure and clipboard recovery.

The startup allowance is a bounded timing workaround, not a Codex readiness
receipt. Startup beyond that allowance can still fail visibly. Native first
attempt success remains unverified for this corrected build.

The asynchronous Copy regression failed against the installed token
implementation, then passed after this correction. Focused tests now include
delayed Copy across multiple polls, delayed paste clipboard consumption for
long prompts, the five-second startup, silent delivery failure, duplicate
prevention and retry. No diagnostic token is excluded from the paste history
in the test harness; any extra paste fails the expected prompt-only history.

### Corrected build validation and installation

- Focused handoff/interview tests: 49 passed.
- Full unit suite: 804 passed; test compilation, webpack build, production
  packaging, lint and scoped whitespace checks passed.
- Packaged with dependencies and installed:
  `C:\Users\darre\AppData\Local\Temp\mwnn-kanban-card-mvddaz91-1-correction.vsix`.
- Version remains 1.0.2, including existing uncommitted working-tree changes.
  The installed bundle matches the corrected working tree and VSIX; runtime
  Pro dependency is present, and the preparation-token string is absent.
- SHA256:
  `33A5A2D8AEDD8F5ECFDFC6F772AB497E226313BE8734CEB7225717925E413594`.
- Live corrected-build smoke checks: NOT RUN; user needs to reload the window.

Run **Developer: Reload Window**, assign one card once, keep Codex focused and
allow approximately seven seconds. Check that only the complete card prompt
appears, without preparation tokens. Follow the three-reload and other
Development Host scenarios below before checking the outstanding criteria.

## Reproduction and cause

The automated reproduction models a cold Codex view whose new-chat request is
queued while it initializes. Its paste command resolves without inserting text
because no composer has focus yet. Initialization then finishes. Previously,
`deliverClipboardHandoff` returned `{ delivered: true }` and its caller could
write a successful handoff Activity entry despite the empty composer.

Before the mitigation, this command failed with `true !== false`:

```powershell
npm run compile-tests
node --test --test-name-pattern='silently ignored' dist-test/test/unit/chatHandoff.test.js
```

The earlier fix in `card-mrjayz9y-1` added activation, sidebar preparation,
300 ms waits and a per-card lock. The fix in `card-muv70vog-1` retried rejected
paste commands. Neither established composer readiness or detected a resolved
paste that did nothing. A second assignment worked because startup had finished.
Different cards could also overlap despite their separate locks, sharing the
focused conversation and clipboard.

Inspection of the locally installed `openai.chatgpt` version `26.1007.21434`
confirms that its `chatgpt.newChat` handler calls `triggerNewChatViaWebview`.
That implementation queues its own `new-chat` message until sidebar readiness;
the command's return does not acknowledge composer focus or MWNN's later paste.
This is local implementation evidence, not a supported public integration API.

## Earlier mitigation

The extension-host handoff now copies the selected composer contents back and
requires an exact match with the complete generated prompt. Before copying it
changes the clipboard to a distinct marker, so the original source clipboard
cannot itself prove delivery. Readback is bounded and retried; paste is never
replayed after an ambiguous outcome. The complete prompt is restored to the
clipboard for recovery. All chat prompt deliveries share a queue, in addition
to the existing per-card guard held through the successful Activity write.
Codex activation is bounded at 15 seconds both during provider discovery and
delivery. An activation that finishes after timeout cannot resume an old handoff.

This initially detected the lost paste but still required a second assignment.
The interview record below confirms that limitation in the installed test build.

## Superseded token recovery added on 2026-10-18

After the single new-chat command, MWNN now probes the composer with a short,
unique temporary token. Select All/Paste replaces the token on each probe;
Select All/Copy must read back that exact token before any card prompt is
inserted. A distinct clipboard value prevents an ignored Copy from proving
readiness. There are at most 60 probes with a 250 ms wait each (15 seconds of
readiness waits, in addition to activation and command latency).

The acknowledged token remains selected, so the first prompt chunk replaces it.
Later chunks append, preserving the existing inline long-prompt behavior.
The actual card prompt is never replayed. Exact complete-prompt verification,
clipboard restoration, shared serialization and per-card locking remain.
Readiness timeout, unexpected readback or command failure returns a visible
failure without a success Activity entry and releases the lock for a retry.

The focused regression now expects first-assignment success after the original
silent no-op, and a separate virtual-time regression models the reported
five-second startup using the default readiness budget. The harness models
selection replacement as well as append behavior, delayed acknowledgement,
stale drafts, duplicate clicks while probing, timeout and subsequent retry.

The [official command reference](https://learn.chatgpt.com/docs/developer-commands?surface=ide)
documents new-chat/sidebar commands without a prompt-prefill or readiness
contract. This recovery uses the existing clipboard fallback. Native composer
focus, selection and clipboard routing still require the smoke checks below;
automated success is not Development Host completion evidence.

## Development Host procedure

Use a disposable workspace and two eligible, defined AI cards with distinct
titles and acceptance text. Do not send their prompts to an agent. Run
`npm run compile` and launch the repo's **Run Extension** debug configuration.
Keep the AI loop stopped while checking assignment behavior.

1. Close/hide Codex, reload the Development Host, and immediately use the card's
   **Run with AI** action once, selecting **Codex (ChatGPT)**. Do not open Codex
   first, click again, or paste manually. Verify that exactly one new chat opens
   and its composer contains the complete generated prompt, including the
   selected card path, title, description, criteria and any run-setting notes.
   Inspect Activity for exactly one successful handoff entry. Repeat across
   three fresh reloads, recording the result for each. A warning/empty composer
   is a failure of the requested first-attempt behavior, even though false
   success is prevented.
2. Repeat with Codex still initializing for approximately five seconds, then
   allow it to finish. The current build allows six seconds after opening the
   sidebar before requesting its single new chat, then 300 ms before inserting
   the prompt. No diagnostic text should
   appear at any point. No second assignment, warning or manual paste should
   be needed for this case. Also test initialization longer than six seconds:
   record any visible failure honestly rather than treating the wait as an
   observable readiness guarantee.
3. Open a different Codex conversation and leave an identifiable unsent draft.
   Hand off the other test card once. Check the new composer contains precisely
   that card's complete prompt and no old draft or other card text. Check Copy
   verification reads the composer, rather than the whole webview or an editor.
4. During a pending handoff, invoke the same card action repeatedly. Check for
   one new chat, one complete prompt and one success Activity entry. Hand off
   the two different cards close together and check their prompts remain distinct
   and their deliveries run sequentially.
5. Force delivery failure by closing/changing focus away from the Codex composer
   during startup. Check for an actionable warning and no success Activity entry.
   Open Codex, inspect any partial draft, and retry once. Verify the retry can
   proceed, with one complete selected-card prompt and one success entry.
   If readback is unavailable rather than a definite error, choose **Prompt is
   missing** in the neutral notification to record the observed failure; dismissing
   also must not record success. For a complete delivered prompt with unavailable
   readback, choose **Prompt is present** and verify a single success entry.

## Earlier mitigation results (2026-10-18)

| Check | Result |
| --- | --- |
| Original silent-no-op automated reproduction | Reproduced before mitigation: expected false, received true |
| Focused handoff and interview regressions | 45 passed |
| Complete unit suite | 800 passed |
| TypeScript test compilation and webpack build | Passed |
| ESLint and whitespace checks | Passed |
| Fresh reload 1 | NOT RUN: native VS Code UI control unavailable |
| Fresh reload 2 | NOT RUN: native VS Code UI control unavailable |
| Fresh reload 3 | NOT RUN: native VS Code UI control unavailable |
| Already-open Codex conversation | NOT RUN: native VS Code UI control unavailable |
| Deliberately slow Codex initialization | Automated model still requires retry; native check not run |

This table records the earlier mitigation only. The subsequent readiness
implementation is recorded above and its validation is recorded below.

## Superseded token recovery results (2026-10-18)

| Check | Result |
| --- | --- |
| Original silent-no-op case | Automated first-assignment success; one new chat and one complete card-prompt insertion |
| Reported five-second loading case | Automated success with default readiness budget; no second assignment |
| Focused handoff and interview regressions | 48 passed |
| Complete unit suite | 803 passed |
| TypeScript test compilation and webpack build | Passed |
| ESLint and whitespace checks | Passed |
| Working-tree test VSIX | Packaged with runtime Pro dependency; archive bundle SHA256 matches working-tree bundle |
| Fresh reload 1 | NOT RUN: native VS Code UI control unavailable |
| Fresh reload 2 | NOT RUN: native VS Code UI control unavailable |
| Fresh reload 3 | NOT RUN: native VS Code UI control unavailable |
| Already-open conversation with readiness recovery | NOT RUN: native VS Code UI control unavailable; previous build had user-reported success |
| Native slow initialization, duplicate clicks, failure/retry | NOT RUN: native VS Code UI control unavailable |
| Subsequent user smoke report | FAILED: repeated readiness-token pastes, screenshot supplied |

Criteria 2, 3 and 6 remain unchecked pending these live checks. Use **Run
Extension** (F5) to test the working tree in a Development Host. A packaged
working-tree VSIX is also suitable for an installed-build check, but that is a
separate result from the requested Development Host trials.

Packaged installer: `C:\Users\darre\AppData\Local\Temp\mwnn-kanban-card-mvddaz91-1-test.vsix`.
It has version `1.0.2`, includes existing uncommitted working-tree changes and
runtime dependencies. It was subsequently installed as confirmed below; it has
not been published.
For an installed-build test, run:

```powershell
code --install-extension "$env:TEMP\mwnn-kanban-card-mvddaz91-1-test.vsix" --force
```

Installation confirmed on 2026-10-18 at the user's request. VS Code reported
successful installation. The registered extension is version 1.0.2 at
`C:\Users\darre\.vscode\extensions\darrenjmcleod.mwnn-kanban-1.0.2`.
At that installation, the extension bundle SHA256 matched the tested working-tree bundle,
and the runtime Pro dependency is present.

Run **Developer: Reload Window** before testing. The requested three
Development Host reloads and other live checks still need results.

## Interview follow-up (2026-10-18)

User-reported outcome after the local test build was installed: "Still not working"
(source: user in interview chat, 2026-10-18). The installed production bundle was
previously verified to match the working-tree build. The report does not specify
whether the VS Code window was reloaded, the initial Codex state, composer
contents or warning. No individual scenario result above is changed on this
unspecified report. First-attempt delivery remains unresolved; this is reported
behavior, not an independently verified UI observation.

Further user-reported detail (interview chat, 2026-10-18): "Just a blank session.
Maybe just wait longer for it to load." This identifies the observed outcome as
a blank session. Waiting longer is the user's suggested remedy, not a verified
fix or measured readiness interval. Warning behavior, reload confirmation and
initial Codex readiness remain unanswered. Individual scenario results above
remain unchanged pending those details.

Asked "Did VS Code show a warning notification when the blank session opened?",
the user answered "Yes" (source: user-reported in interview chat, 2026-10-18).
A warning notification is therefore reported; its wording remains unanswered.
This does not independently verify the message or establish that it was actionable.
Reload confirmation and initial Codex readiness also remain unanswered.

Asked "What did the warning notification say?", the user supplied this exact
text (source: user-reported in interview chat, 2026-10-18):

> Could not hand off "add model name to the x cli running pill on the card" to Codex (ChatGPT): Codex did not acknowledge the prompt; open Codex and inspect the new-chat draft before retrying after 8 verification attempts. No activity entry was recorded. Try again after opening Codex (ChatGPT).

The reported notification gives retry guidance and reports eight unsuccessful
verification attempts and no Activity entry. These notification contents do not
independently verify the target card's Activity, composer state or readiness.
First-attempt delivery remains unresolved. Reload confirmation, initial Codex
readiness and the outcome of waiting without another assignment remain unanswered.

Asked "Before that assignment, was Codex closed, still loading, or already open
and ready?", the user answered "Still loading" (source: user-reported in interview
chat, 2026-10-18). This places the reported blank session and eight-attempt warning
in the initializing-Codex scenario. Loading duration, reload confirmation and the
outcome after loading finishes without another assignment remain unanswered.
The earlier results table is the historical verification record; this follow-up
is a user-reported initialization failure, not independently observed UI evidence.

Asked "After Codex finishes loading, does the prompt appear on its own, or does
the session stay blank without another assignment?", the user answered "Stays
blank" (source: user-reported in interview chat, 2026-10-18). Automatic delivery
therefore remains unsuccessful after loading in this reported attempt. This
does not test delaying insertion until readiness; it describes waiting after the
existing handoff has failed. Reload confirmation, loading duration and current
retry outcome remain unanswered. No first-attempt acceptance criterion is met
by this report.

Asked "Roughly how many seconds does Codex take to finish loading?", the user
answered "5" (source: user-reported in interview chat, 2026-10-18). This is an
estimate of approximately five seconds, not an independently measured duration
or evidence that a fixed five-second insertion delay would suffice. Together
with the earlier answers, this records assignment during loading followed by a
blank session and the eight-attempt warning; the session stays blank once loading
finishes. Reload confirmation and current retry outcome remain unanswered.

Asked "Had you run Developer: Reload Window after installing the test build,
before that failed attempt?", the user answered "Yes" (source: user-reported in
interview chat, 2026-10-18). Reload before the failed attempt is now confirmed by
the user. This reports a failure of the locally installed build after reload;
it does not establish a separate Development Host run or three reload trials.
Current retry outcome remains unanswered. First-attempt acceptance criteria
remain open.

Asked "With this installed build, does assigning the same card again after Codex
finishes loading deliver the complete prompt?", the user answered "Yes" (source:
user-reported in interview chat, 2026-10-18). Retry after loading therefore delivers
the complete prompt per the user. This supports failure/retry handling but does
not establish first-attempt delivery, target-card Activity correctness or the
separate already-open-on-another-conversation case. First-attempt acceptance
criteria remain open.

Asked "When Codex is already open on a different conversation, does one assignment
deliver the selected card’s complete prompt into a new chat?", the user answered
"Yes" (source: user-reported in interview chat, 2026-10-18). The already-open case
therefore has reported first-attempt success. This is not independently observed
UI evidence; absence of stale text and Activity counts were not separately
confirmed. The earlier results table remains the historical automated/manual
record; this follow-up records the subsequent user report. The initializing-Codex
failure and required successful first-attempt reload trials remain unresolved.

Asked "In that new chat, is there any stale text from the previous conversation
or another card?", the user answered "No" (source: user-reported in interview
chat, 2026-10-18). The already-open-conversation case now has user-reported
complete-prompt delivery without stale text. This remains reported evidence;
Activity counts are not separately confirmed. The initializing-Codex failure
and required successful first-attempt reload trials remain unresolved.

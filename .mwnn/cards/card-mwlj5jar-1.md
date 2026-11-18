---
id: card-mwlj5jar-1
title: Review and approve the free version marketing plan draft
column: col-mqwk2njn-4
position: -120000
assignee: { kind: human }
createdAt: 1794970605555
updatedAt: 1794971323204
---

## Description
The plan in `docs/free-version-marketing-plan.md` is marked "draft for the maker's review". Nothing in it has been applied, posted, or submitted, and Week 1 starts on the first Monday after the maker approves it. Review the proposed listing values, tactics, budgets (about 8 one-time hours, at most 2 recurring hours a week, $0), and exclusions against the private launch brief's guardrails.

## Acceptance criteria
- [x] Plan reviewed against the launch brief's messaging guardrails and budgets
- [x] Proposed listing values accepted or amended in the plan
- [x] Draft status replaced with an approval note and the Week 1 start date (first Monday after approval)

## Activity
- 2026-11-17 Claude Code: imported from plan. Import key: `docs/free-version-marketing-plan.md#status:review-and-approve-the-free-version-marketing-plan-draft`

### 2026-11-18T03:03:37.873Z - AI-guided interview started in Claude Code
Opened an interview chat in Claude Code. Answers are recorded below as they are given; this entry is not evidence that any acceptance criterion is met.

- 2026-11-17 Claude Code: verified evidence — reviewed `docs/free-version-marketing-plan.md` against the private brief `e:\mwnn-kanban-pro\docs\marketing\README.md` (Messaging guardrails, Positioning, Key messages 1, 2, 5, Canonical links, Success metrics) and `package.json` 1.0.18.
  - Guardrails: no conflicts found. One extension (no Pro listing; "Pro unlocks inside the same extension"), privacy (proposed description uses only the approved "not sent to MWNN" claim; flags the current over-broad description), asks (stars/reviews/upvotes excluded), organic only / no UTM, tracking links or telemetry, and no prices, trial, or two-unit claims appear in the plan. Listing claims trace to brief messages 1 and 2.
  - Budgets: one-time tactics T1–T9 sum to 8 h (Weeks 1–4: 3 + 2.5 + 1.5 + 1 h); cash $0; average recurring 105 min/wk (T4 10 + T5 10 + T6 45 + T7 30 + T9 10), under the 2 h cap.
  - Finding to confirm: the Steady-state routine's peak week exceeds the cap. A week that has the weekly sweep and issue replies (75 min), a release (15 min), the fortnightly tip/referrers slot (20 min), and the first-Monday monthly review (30 min) totals 140 min. Minor inconsistency: T9 budgets 5 min fortnightly for referrers while the routine folds referrers into the same 20-min slot as T5's tip post (T5 alone is 10 min/wk = 20 min/fortnight).
  - `package.json` current `displayName`, `description`, `keywords`, `categories` match the plan's "Current" column. The local `@vscode/vsce` has no hard-coded category list, so the `AI` category still needs the check the plan already notes.
- 2026-11-17 Interview: Q: Is the 2-hour recurring cap a weekly average or a hard per-week limit? A: "Hard cap, shrink the sweep in review weeks" — user-reported by the maker in interview chat, 2026-11-17.
  - Applied to `docs/free-version-marketing-plan.md`: T6 recurring now "45 min/wk (20 min in monthly-review weeks)"; Totals line now states ~1 h 40 min/wk average and at most 2 h in any single week (hard cap); Steady-state Weekly bullet cuts the sweep to 20 min in monthly-review weeks. Verified evidence: peak week is now 20 + 30 + 15 + 20 + 30 = 115 min (120 min even if T9's 5-min referrer check is counted separately), within the cap.
- 2026-11-17 Interview: Q: Accept the proposed listing values (displayName, description, keywords, categories, GitHub description/website/topics) as written, or amend? A: "Accept them all as written" — user-reported by the maker in interview chat, 2026-11-17.
  - Applied to `docs/free-version-marketing-plan.md`: Listing audit heading now "values accepted, not yet applied", with a note that the maker accepted every value as written on 2026-11-17 and they are applied in Weeks 1–2 (T1, T3). Table values unchanged.
- 2026-11-17 Interview: Q: Approve the plan today (Tue 2026-11-17), making Week 1 start Mon 2026-11-23? A: "Yes, approved today — Week 1 starts 2026-11-23" — user-reported by the maker in interview chat, 2026-11-17.
  - Applied to `docs/free-version-marketing-plan.md`: the "draft for the maker's review" status line is replaced with "approved by the maker on 2026-11-17. Week 1 starts Monday 2026-11-23", and the First four weeks intro now names that date. Verified evidence: 2026-11-17 is a Tuesday and 2026-11-23 is the next Monday (Python `datetime`); `grep` finds no remaining "draft for the maker's review" text in the plan.
- 2026-11-17 Claude Code: interview summary. All three acceptance criteria are met: (1) plan reviewed against the brief's guardrails and budgets, verified evidence, with the peak-week overrun fixed per the maker's hard-cap answer; (2) listing values accepted as written (user-reported) and noted in the plan; (3) draft status replaced with the approval note and the Week 1 start date 2026-11-23 (user-reported approval, verified edit). No unresolved exceptions. Open note, not a criterion: the `AI` category still needs the `vsce` check before the Week 2 release, as the plan states. Card left in its current column; the assignee is unchanged.
STATUS: DONE

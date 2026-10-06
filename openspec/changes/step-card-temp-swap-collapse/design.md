## Context

Source-verified on main 9c247cf6. Planning trace evidence: `.concertino/runs/HEL-1294/evidence/premise-validation.md`.

- `usePipelineDetailPage.handleInsertStep` (hooks/usePipelineDetailPage.ts:734) splices a `makeStep` temp step
  (`id: "step-N"`, state/stepNarrowing.ts:384) into `steps`. It then awaits `createPipelineStep` and
  `syncStepsFromServer()`, and only then replaces the whole list with server steps (real ids, :716-720).
  `handleAddLaneStep` (:803) follows the same shape (`makeStep(opType, parentStepId)`, create, sync at :850).
- Step cards are keyed by `step.id` (PipelineRiverView.tsx:350, LaneColumn.tsx:198/243). `expanded` is local
  `useState(false)` in StepCard.tsx, and the editor body and the Remove button render only when it is expanded
  (StepCard.tsx:357, :411).
- `useStepCardState.persist` returns early on `isTempStepId(step.id)`, so an edit made on a temp card never PATCHes.
- CI failure 37357274199: the expand input fired at 540835, the editor mounted (SecondaryInputPicker's on-mount
  `fetchSources` hit GET /data-sources at 540872), and the resync GET /steps resolved at about 540888. The snapshot
  at 541127 shows the toggle `aria-expanded="false"`, and the "Right source" combobox never appeared. The 5s PATCH
  waiter (spec :86) was simply the first timer to fire.

## Goals / Non-Goals

**Goals:** confirm the root cause with a probe before fixing it. Make "add a step, then open it" deterministic for
users and for the e2e spec without touching the spec's assertions or timeouts. Use an RTL test that is red without
the fix. Measure the before and after rate under contention. Get N≥20 consecutive greens.

**Non-Goals:** see proposal.md. In particular: no edits to `playwright.config.ts`, `ci.yml`, or any other spec. The
AI-draft create-on-completion swap (handleStepConfigChange :1035 also swaps the temp id for the real id, so it has the
same remount) is not fixed here.

## Decisions

**D1. Root cause must be probe-confirmed before any product edit (systematic-debugging law).**
- P1, deterministic: add an uncommitted probe spec at an exact path, `e2e/hel1294-probe.spec.ts`. It is a copy of
  hel958 plus `page.route` that delays only `GET **/api/pipelines/<id>/steps` *after* the step POST, by about 1500ms.
  Expected on unfixed code: the expand click lands on the temp card, the card collapses when the delayed GET resolves,
  and "Right source" never appears. Record the trace and the aria-expanded value. A control run with no delay must
  pass. If P1 does not reproduce the failure, STOP and return with the evidence. Do not fix anything on an
  unconfirmed hypothesis.
- P2, contention rate before the fix: run `nice -n 19 npx playwright test e2e/hel958-join-step-editor.spec.ts
  --repeat-each=30 --workers=2`, alongside the state-surface guard specs that share HEL-1288's shard 4 where they can
  be identified, under background CPU load. Use at most 3 `nice -n 19` busy-loop processes wrapped in `timeout`,
  record their PIDs, and kill them by exact PID. Record failures/N. A local rate of 0 is acceptable to report
  honestly. P1 is the reproduction of record, and CI's 1-of-7 on main is the historical rate.

**D2. Fix in the product: a step whose optimistic create is in flight is not expandable.**
`usePipelineDetailPage` keeps a `creatingStepIds` state (`ReadonlySet<string>`). `handleInsertStep` and
`handleAddLaneStep` add the temp id before `createPipelineStep` and remove it in a `finally` that runs after
`syncStepsFromServer()` settles, so the window covers both POST and resync. The draft early-return
(`requiresCompleteConfigForCreate`) never enters the set. The set flows to StepCard as a boolean `isCreating`
prop, computed at each render site as `creatingStepIds.has(step.id)`, so `React.memo`'s shallow compare still
holds. While `isCreating` is true, the expand toggle renders `disabled`, so it cannot be activated by pointer or
keyboard. The executor enumerates every render site with `grep -n "<StepCard"` and threads the prop to each one.
None may be missed.
- Why not a stable React key across the temp→real swap? It keeps the card open, but an edit made while the id is
  still temp still no-ops. The resync then replaces `step.config`, which resets the local editor state, so the edit
  is lost silently. The test would still flake, only more narrowly. Fixing that also needs a flush-on-reconcile
  mechanism across 26 op handlers, which is a much larger surface for a timing fix.
- Why not derive `isCreating` from `isTempStepId && !requiresCompleteConfigForCreate`? A failed create keeps its
  temp step forever (existing convention, :776-784). With that derivation it could never be expanded, so its Remove
  button, which lives in the body, would be unreachable. That would be a regression. An explicit in-flight set
  clears on failure.
- Why not fix only the test (wait for the resync GET)? The product defect is real: an open editor collapses and edits
  vanish on a slow network. The ticket requires a product fix plus an RTL test when the cause is a product bug.

**D3. The e2e spec is unchanged.** Playwright's click auto-waits for an enabled element and re-resolves the locator
after the temp card is replaced, so `getByRole("button", {name: "Join tables"}).first().click()` now lands on the
persisted card. No assertion, timeout, or retry is touched.

**D4. Tests (red without the fix).** Add an RTL test at the page or hook level using the existing
usePipelineDetailPage/PipelineDetailPage test harness and service mocks. Add a step whose create resolves and whose
`fetchPipelineSteps` resync is held on a deferred promise.
(a) Assert that the new card's toggle is disabled and that clicking it shows no editor.
(b) Resolve the resync, then assert the toggle is enabled, opening it shows the editor, and an edit PATCHes the real
id.
(c) Assert that a failed create re-enables the toggle.
(d) Assert that an AI draft stays expandable.
Prove (a) is red by temporarily reverting the product change and recording the failing output. Add a lane-add case
if the harness supports it, and otherwise cover lane add at the hook level.

**D5. Verification after the fix.** P1 now passes; record the trace showing the click waited for the enabled
persisted card. P2 is re-run under identical load with N≥20 (use 30) and must have zero failures. Then delete the
probe spec by exact path. CI must run at most once at a time, on this PR's own run. The 20+ consecutive greens come
from the local runs. The CI e2e on the PR is the additional HEL-1288-style measurement.

## Risks / Trade-offs

- The card is not interactive for one POST plus GET round trip, usually around 150ms. This is acceptable and matches
  the existing "Draft — not yet saved" chip. Styling the disabled toggle must follow DESIGN.md's disabled pattern,
  with no new tokens.
- Other RTL or e2e tests that expand a card while its create mock is pending will now see a disabled toggle. The full
  jest suite and the pipeline e2e specs must be run. A test change made only to accommodate the fix is a red flag
  (see MISTAKES.md): justify it, or rethink.

## Planner Notes

- Self-approved: the root-cause hypothesis is taken from the CI trace and gated on P1 (D1). The fix scope is limited
  to the two temp-id create paths. The AI-draft swap is noted as a follow-up and not filed.
- Gate-chain: no `.husky/**` or pre-commit script is touched.

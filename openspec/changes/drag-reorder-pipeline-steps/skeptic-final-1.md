## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth re-established independently** (not trusting evaluation-1.md/evaluation-2.md's
claims without re-checking):
- `git diff 608bf25f...HEAD --stat` — 28 files, matches `files-modified.md`'s claimed scope; no
  unclaimed files touched.
- Read the full diffs for every backend file (`PipelineStepProtocol.scala`, `package.scala`,
  `PipelineStepRoutes.scala`, `PipelineStepRepository.scala`, `PipelineService.scala`, the new
  schema file) and every frontend file (`pipelineService.ts`, `PipelineDetailPage.tsx`,
  `PipelineRiverView.tsx`, `StepCard.tsx`, `PipelineDetailPage.css`) — not summaries, the actual
  diff content.

**Backend — fresh run, this session:**
- `sbt "testOnly com.helio.api.PipelineStepRoutesSpec"` → **34/34 pass**, including all 7 new
  reorder tests (200 + persistence-survives-reload, 404 unknown pipeline, 403 viewer, 3×422
  non-permutation variants, failed-reorder-leaves-positions-unchanged). Read the test bodies —
  non-tautological, real assertions on `position` values and id order.
- Traced the atomicity/ACL/validation claims directly against code, not the report's prose:
  `PipelineService.reorderSteps` (`PipelineService.scala:655-687`) mirrors `deleteStep`'s
  editor/owner-via-`requireEditorAccess` pattern exactly, masks non-visible pipelines as 404 via
  `findByIdShared`, validates `stepIds` via set-equality + length before calling the repo (422
  otherwise), and only then calls `reorderInternal`.
  `PipelineStepRepository.reorderInternal` (`PipelineStepRepository.scala:189-206`) runs
  `DBIO.sequence(updates).transactionally` — genuinely one transaction, matching Decision 2.
  `PipelineStepRoutes.scala` is a thin shell (`PUT` under `path("order")`, `entity(as[...])`,
  `ServiceResponse.run`) — no inline FQNs, no business logic in the route.
- `schemas/reorder-pipeline-steps-request.schema.json` is additive; `npm run check:schemas` →
  clean (59 schemas / 45 protocol files checked, in sync).

**Frontend — fresh run, this session:**
- `npm run lint` → clean (zero-warnings policy).
- `npm run format:check` → clean.
- `npx jest` (full suite, not just targeted) → **1788/1788 pass, 177 suites** — matches the
  evaluator's claimed count exactly (independently reproduced, not trusted on assertion).
- Read `PipelineRiverView.test.tsx`, `StepCard.test.tsx`'s new describe blocks, and
  `PipelineDetailPage.test.tsx`'s "reorder (HEL-407)" block in full — all are substantive,
  non-tautological (e.g. the CR1 regression test asserts the *exact* corrected id order
  `["b","c","a","d"]` for the 4-step scenario the evaluator found live in cycle 1).
- Manually re-derived `moveStep`'s post-fix math for the CR1 fix
  (`draggedIndex < overIndex ? overIndex - 1 : overIndex`) against the diff in
  `PipelineRiverView.tsx` — confirmed correct for downward drags, confirmed upward drags need no
  adjustment (nothing before the dragged item's original index shifts on removal).
- CSS diff (`PipelineDetailPage.css`) is 100% token-based (`var(--space-*)`, `var(--app-*)`,
  `var(--text-xs)`) — no hardcoded values anywhere in the new rules, confirming CR2 from cycle 1
  is genuinely fixed and no new violations were introduced.

**Live UI verification** (dev 5839 / backend 8746, via `start-servers.sh` +
`assert-phase.sh servers` → `PASS servers`). Built a fresh test pipeline (`HEL-407 skeptic
reorder pipeline` / `HEL-407 skeptic reorder source`, 2 fields, 1 row) rather than trusting the
evaluator's leftover `HEL-407 eval reorder test` pipeline:
- **Header restructure**: screenshot confirms the drag handle (grip icon) + Move up/down chevrons
  render as a genuine sibling cluster next to the (unchanged) expand-toggle button, in both light
  and dark theme — token-driven, consistent with `SidebarItemList`'s icon-button sizing
  precedent. No design-standard violations spotted.
- **Keyboard reorder**: clicked "Move step up" — order swapped correctly, Move-button
  disabled/enabled state at the new boundaries updated correctly, expand/collapse state
  unaffected by the click.
- **Real native `DragEvent` drag** (dispatched genuine `DragEvent`s with a `DataTransfer`, not
  the jsdom-simulated `fireEvent` the unit tests use — this exercises the actual browser DnD
  wiring end-to-end): dragged the "Pivot" step's handle and dropped it on the "Rename column"
  section → order changed correctly to `[Pivot, Rename]`. Confirmed `PUT
  .../steps/order` fired (200) via `browser_network_requests`.
- **Persistence across reload**: reloaded the page after both the keyboard-move and the
  drag-move — order survived both times (`GET` on load reflects the new order each time).
- **Newly-invalid-step scenario (the spec's own scenario, and the one the task brief flagged for
  scrutiny)**: with steps `[Pivot(index=full_name, column=score, values=score), Rename(raw_name→
  full_name)]` (Pivot references a column only `Rename` produces), reordered Pivot above Rename.
  Confirmed via direct `fetch('/api/pipelines/:id/analyze')` that the backend correctly
  re-computes `"validationError": "Unknown field(s): 'full_name'"` for the now-invalid Pivot step
  — the analyze-refresh mechanics (Decision 8, "no new code") genuinely work. **However**, nothing
  in the UI displays this — see Change Request 1 below.
- Console: only the pre-existing, unrelated `404` on `.../schedule` (matches both evaluation
  reports' note) — no new errors from any interaction.
- Cleanup: deleted the test pipeline and data source (`DELETE` with the required
  `X-Helio-Requested-With` CSRF header), removed the screenshots I took, stopped both dev
  processes (verified `ss -ltnp` shows the ports free) — did **not** touch the evaluator's
  pre-existing `HEL-407 eval reorder test` / `Skeptic Test *` leftovers (not mine to clean up).

### Acceptance criteria — traced

1. "Steps can be reordered by drag and by keyboard; the new order persists and survives reload."
   **Met** — traced to code + live-reproduced both paths + reload persistence, above.
2. "Analyze + previews refresh after reorder, surfacing any newly-invalid step." **Not fully
   met** — the *refresh* half is solid (traced to code + live network evidence), but the
   *surfacing* half fails for the general case. See Change Request 1.
3. "Follows DESIGN.md; frontend tests cover reorder → persisted order + analyze refresh." **Met**
   — token-only CSS, tests traced above cover exactly this.
4. "Backward compatible... additive batch endpoint only." **Met** — new schema file, existing
   routes/wire shapes untouched, `check:schemas` clean.

### Verdict: REFUTE

### Change Requests

1. **AC2 is not actually satisfied for the general case — `validationError` is only ever
   rendered for the `compute` op, so a reorder-invalidated step gives the user zero visible
   feedback for ~19 of ~20 step types.**
   `StepCard.tsx:89-91`'s own doc-comment says as much: "This step's analyze-time
   `validationError`, if any (**currently only rendered by the "compute" op's editor** — see
   `ComputeFieldConfig`)." Confirmed by reading the full op-type switch
   (`StepCard.tsx:330-390`): `validationError` is passed to `ComputeFieldConfig` only
   (`StepCard.tsx:354`); every other branch (`select`/`rename`/`cast`/`filter`/`aggregate`/
   `limit`/`sort`/`splittext`/`extractheadings`/`chunkbytokencount`/`datebucket`/`pivot`/
   `window`/`unpivot`/`dedupe`/`fillnull`/`stringops`/`union`/`lookup`/`assert`) silently drops
   it. `git blame` confirms this scoping predates HEL-407 (commit `822debe02`, 2026-07-11) — it
   is not a regression this diff introduced.
   **But it is squarely this ticket's problem to close**, because reordering is the *new*
   capability that makes a picker-constrained step (whose config a user can normally only set to
   already-valid values via a dropdown/checkbox list) reach an invalid state at all. I
   live-reproduced exactly the spec's own scenario with a representative non-`compute` step
   (Pivot referencing a column its now-later sibling Rename produces): the backend correctly
   computes `validationError: "Unknown field(s): 'full_name'"` (verified via direct
   `GET /api/pipelines/:id/analyze`), but the rendered UI shows only a blank/unselected "Index
   field" picker with **no error text, badge, or any visual cue** that the step is broken —
   see the "Newly-invalid-step scenario" evidence above. This directly fails both the ticket's
   AC2 ("surfacing any newly-invalid step") and the delivered `specs/pipeline-step-reorder/
   spec.md`'s own scenario ("the moved step surfaces its validation error through the existing
   per-step validation display" — no such display exists for Pivot, or for any op besides
   `compute`).
   **Fix**: render `validationError` generically in `StepCard`'s expanded body — reuse the
   already-shared `InlineError` component (`frontend/src/shared/chrome/InlineError.tsx`,
   currently imported only by `ComputeFieldConfig.tsx:16`) once, op-type-agnostically (e.g.
   immediately after `StepSchemaDiffChips` at `StepCard.tsx:325-329`, gated on
   `validationError` being truthy), rather than only inside the `compute` branch. This is a
   small, surgical, in-scope addition — not the broad "expand every per-op editor" refactor
   CLAUDE.md's scope-discipline rule would otherwise caution against — and it is the minimum
   needed to make the ticket's own AC2 true for the general case, not just for `compute` steps.
   Add a regression test asserting a step with a `validationError` renders `InlineError`'s text
   regardless of `opType`.

2. **`design.md` Decision 8 overclaims a "badges" mechanism that does not exist anywhere in the
   codebase.** Decision 8 states newly-invalid steps "surface through the existing
   `validationError` plumbing (**badges/editors**) with zero additions." Exhaustive
   `grep -rln "badge\|Badge" frontend/src/features/pipelines/` turns up only unrelated run-status/
   schedule-status badges — there is no per-step-validation badge mechanism, "existing" or
   otherwise. This false claim went unchallenged across all three design-gate skeptic rounds
   (`skeptic-design-1/2/3.md` — none scrutinize Decision 8's parenthetical). Correct the doc to
   accurately describe the actual (narrower, `compute`-only, pre-existing) scope once Change
   Request 1 is resolved, so the artifact doesn't continue to assert a UI affordance that was
   never built.

### Non-blocking notes

- Evaluation-2.md's own noted non-blocking observation (the `overIndex !== draggedIndex` guard
  vs. `targetIndex !== draggedIndex` for the harmless redundant-PUT no-op case) still applies —
  confirmed present in the current diff, still genuinely non-blocking (idempotent, correct final
  state, no AC/spec scenario requires suppressing it).
- The evaluator's `HEL-407 eval reorder test` pipeline (`63130b24-78f3-41b1-b934-cac6c7130f0e`)
  and other `Skeptic *` test fixtures remain in the shared dev DB from prior review cycles — not
  cleaned up by this round either (not introduced by me; flagging for whoever does eventual DB
  hygiene, per the project's known "stray test fixtures" pattern).

## 1. Red-first proof (superseded mechanism — see design.md Decision 13)

- [x] 1.1 Instead of frozen on-disk fixtures, the old `foldLeft` fold's per-step body was extracted
      verbatim into a shared `evalOneStep` helper reused unchanged by both the retained
      `executeWithStepCounts` and the new `executeTree` — the old engine's behavior was never
      destructively modified, so a live comparison is possible instead of a point-in-time capture.
      `executeWithStepCounts` is confirmed test-only in production (design.md Decision 13,
      investigation 1) and its Scaladoc now says so explicitly, so it will not be deleted as
      apparent dead code and take the parity proof with it.
- [x] 1.2 Wrote `InProcessPipelineEngineTreeWalkSpec`'s "AC1" cases: `executeTree` vs.
      `executeWithStepCounts` for (a) a single-step trunk, (b) a multi-step trunk including a
      disabled step, and (c) identical `StepExecutionException` attribution for a failing step.
      Confirmed failable by mutation, not merely by construction (design.md Decision 13,
      investigation 2: reverting the disabled-step stepCounts-skip turned case (b) red; reverted
      and re-confirmed green).

## 2. Engine contract (design.md Decisions 1, 2, 8, 9)

- [x] 2.1 Add `NodeOutcome` and extend `PipelineExecutionOutcome` with `nodeOutcomes` as a
      defaulted, additive field (`rows`/`stepCounts`/`sourceRowCount`/`primaryStats` unchanged in
      name and meaning — no rename).
- [x] 2.2 Implement the whole-tree Phase-1 graph invariant pre-flight check (using `childrenOf`
      partitioned by `position == 0`/`>= 1`, over every node including the root); define
      `InvalidGraph` and reject before any step evaluates.
- [x] 2.3 Implement the tree walk: root node's own tails first, then trunk fold (reusing the
      existing fold body verbatim per segment for parity) with `childrenOf`-derived tail roots at
      each trunk node evaluated as independent short folds seeded from that node's frame.
- [x] 2.4 Update `InProcessExecutionBackend` to call the tree walk and populate `nodeOutcomes`.
- [x] 2.5 Fix `SparkJobSubmitter`'s `PipelineExecutionOutcome` construction site only if the new
      field's default does not already keep it compiling (verify first — design.md states it
      should require no change).
- [x] 2.6 Confirm parity test (1.2) is green.
- [x] 2.7 Test: `InvalidGraph` rejected for a node with 2 position-0 children, and for a tail node
      with a position>=1 child of its own; no step evaluates in either case.

## 3. Disabled-step splice (design.md Decision 7)

- [x] 3.1 Remove `PipelineRunService.scala:242`'s `allSteps.filter(_.enabled)` pre-filter — pass
      the full step list (disabled included) to `backend.execute`.
- [x] 3.1a Also remove `previewStep`'s own `.filter(_.enabled)` at `PipelineRunService.scala:279`
      on the resolved root-to-target path (task 5.4) — a second, independent instance of the same
      bug (design.md Decision 7 round-2 addendum). Do not touch the separate, unrelated guard that
      rejects previewing a disabled step itself (task 3.5).
- [x] 3.2 Implement in-place skip in the tree walk: a disabled node is not evaluated; its incoming
      frame passes through unchanged to its own trunk child and tail roots.
- [x] 3.3 Test: a disabled step with a child on the trunk is skipped in place, chain unbroken.
- [x] 3.4 Test: a disabled step with a tail child is skipped in place, tail still evaluates from
      the correct (pass-through) frame.
- [x] 3.5 Test: `previewStep`'s existing "disabled step itself is rejected" guard
      (`PipelineRunService.scala` preview path) still holds unchanged.

## 4. Materialized-node persistence (design.md Decisions 3, 4)

- [x] 4.1 On successful run completion, for each materialized node (per `outputs.node_step_id`),
      call `NodeSnapshotRepository.overwriteRows` (per-node transactional replace), sequenced only
      after the full tree walk has completed successfully.
- [x] 4.2 For each Output on a materialized node, derive `schema` via
      `SchemaInferenceEngine.inferShallowFromJsObjects` over that node's row set, convert
      `Seq[InferredField]` -> `Vector[SchemaField]`, and persist it via
      `OutputRepository.updateSchemaInternal`.
- [x] 4.3 Test: two Outputs on one node share one snapshot row set
      (`PipelineRunServiceSpec`, "two Outputs on one node share one snapshot row set" —
      skeptic-final-2.md CR1; previously checked with no such test present, fixed cycle 3).
- [x] 4.4 Test: only materialized nodes appear in `node_snapshots` after a run
      (`PipelineRunServiceSpec`, "only materialized nodes appear in node_snapshots after a run" —
      skeptic-final-2.md CR2; previously checked with no such test present, fixed cycle 3).
- [ ] 4.5 Test: a failed run leaves every materialized node's prior snapshot untouched.
- [ ] 4.6 Test/document explicitly: cross-node atomicity is NOT provided (a mid-sequence failure
      after node A's write succeeds leaves A updated, B not) — this is a stated non-goal, not a bug.

## 5. Dry run + corrected previewStep prefix (design.md Decision 5)

- [x] 5.1 Extend the tree walk with a non-persisting branch (`persist: Boolean` or equivalent);
      return per-Output preview rows for a dry run.
- [x] 5.2 Test: dry-run preview rows equal the live-run snapshot for the same input
      (`PipelineRunServiceSpec`, "a dry run's per-node rows equal a live run's node_snapshots
      rows for the same input" — evaluation-1.md CR7).
- [x] 5.3 Test: a dry run writes nothing to `node_snapshots` or `outputs.schema`.
- [x] 5.4 Replace `previewStep`'s `sortedSteps.take(k + 1)` positional slice with the
      root-to-target-step path (walk `parentStepId` back to root, evaluate that chain); do not
      pre-filter that path by `enabled` (see 3.1a) — the engine's in-place skip handles disabled
      ancestors.
- [x] 5.5 Test: previewing a trunk step downstream of a tailed node no longer folds that tail's
      steps into the previewed prefix (the bug design.md identifies in today's code).
- [ ] 5.6 Test: previewing a step whose ancestor chain contains a disabled step still resolves
      correctly (distinct from task 3.5, which covers previewing a disabled step itself).

## 6. Per-node SSE / assertions / analyze (design.md Decision 6, 11)

- [x] 6.1 Add `nodeId: Option[String]` to `RunStatusEvent`; add the `"node-progress"` status value,
      NOT added to `RunStatusEvent.TerminalStatuses`.
- [x] 6.2 Add an `onNodeProgress` callback parameter (defaulted to a no-op) to
      `PipelineExecutionBackend.execute`; the tree walk invokes it once per node completed;
      `PipelineRunService` wires it to `publish(pidStr, RunStatusEvent("node-progress", nodeId =
      ..., rowCount = ...))`. `SparkJobSubmitter` leaves it uninvoked (no per-node concept).
- [x] 6.3 Confirm task "5.2 assertion re-keying" is a no-op (`pipeline_run_assertions.step_id`
      already exists and already disambiguates trunk vs. tail steps) — no migration, no code
      change; state this in the PR rather than silently skipping.
- [ ] 6.4 Extend `PipelineAnalyzeService` to project schema per node (trunk and tails), per
      design.md Decision 11.
- [x] 6.5 Frontend (design.md Decision 6 round-2 correction — a REAL required change, not
      optional): widen `SseRunStatus` to include `"node-progress"`; add `nodeId`/`nodeRowCount`
      fields to `RunEventsState`; change `usePipelineRunEvents`'s update logic so a `node-progress`
      event updates ONLY the new per-node fields, never `status`/`rowCount` — this keeps
      `PipelineDetailFooter.tsx`'s existing five-branch render and `PipelineDetailPage.tsx:749-752`'s
      row-count display correct with zero changes to either file.
- [x] 6.6 Test (unit or Playwright): tail-node SSE `node-progress` events and assertion rows are
      asserted directly, not merely inferred from trunk behavior; a test asserts a `node-progress`
      event does NOT change the footer's displayed run status or row count.

## 7. Empty-set aggregate (design.md Decision 10)

- [x] 7.1 Add the single new top-level branch in `AggregateStep.apply`: `rows.isEmpty &&
      groupByFields.isEmpty` -> one row, `count = 0L`, every other requested fn = `null`. Leave the
      existing `rows.groupBy(...)` branch (and its existing `nums.sum = 0.0`-for-empty-group
      behavior within a real group) completely unchanged.
- [x] 7.2 Test: empty `groupBy`, zero input rows -> exactly one row with `count = 0`.
- [x] 7.3 Test: empty `groupBy`, zero input rows, `sum`/`avg`/`min`/`max` requested -> one row with
      each `null`.
- [x] 7.4 Test (anti-over-fix guard, explicit): non-empty `groupBy`, zero input rows -> zero output
      rows, unchanged from today.
- [x] 7.5 Test: a real (non-empty) group with an all-null aggregation field still yields today's
      existing values (`sum = 0.0`, `avg`/`min`/`max = null`) — proves 7.1 did not touch this path.

## 7a. Frontend widening (design.md Decision 6 round-2 correction)

- [x] 7a.1 `usePipelineRunEvents.ts`: widen `SseRunStatus`, add `nodeId`/`nodeRowCount` state
      fields, route `node-progress` events to only those fields (see task 6.5 — same work, cross-
      referenced here so it is not missed when scanning by section number).

## 8. HEL-334 (design.md Decision 12)

- [x] 8.1 No code task — confirmed satisfied by construction once section 4 lands. State this
      explicitly in the PR description; do not silently omit the ticket bullet.

## 9. Spec deltas

- [x] 9.1 `pipeline-run-execution`: MODIFIED position-ordering, partial-execution,
      schema-snapshot-to-Type-Registry, and dry-run-no-Type-Registry-write requirements (see
      design.md "Spec-delta scope").
- [x] 9.1a `pipeline-run-status-ui`: ADDED requirement(s) covering `node-progress` handling in
      `usePipelineRunEvents` (round 2 CR1 fix) — the hook exposes `nodeId`/`nodeRowCount` without
      disturbing `status`/`rowCount`/the terminal-close contract.
- [x] 9.2 `pipeline-aggregate-op`: MODIFIED "Empty groupBy collapses all rows to one" with the
      zero-input-rows sub-case, keeping the anti-over-fix guard scenario explicit.
- [x] 9.3 `pipeline-run-sse`: MODIFIED event-enumeration requirement (add `node-progress`); ADDED
      per-node `nodeId`/row-count requirement.
- [x] 9.4 `pipeline-analyze-api`: resolved per evaluation-1.md CR4 by DELETING the delta file
      (task 6.4's `PipelineAnalyzeService` per-node schema projection was never implemented this
      cycle) — shipping the delta without the code would publish a false requirement on archive.
      The requirement is handed to HEL-906 ("capabilities-at-node") as a named follow-up task
      instead (see execution-progress.md).
- [x] 9.5 `pipeline-execution`: ADDED requirements scoped to tree walk / snapshot semantics /
      dry-run / `InvalidGraph` / aggregate fix only (no analyze-service requirement here).

## 10. Verification gates (evidence discipline — coordinator addition)

- [x] 10.1 Before citing `sbt test`, `check:scala-quality`, or any frontend check as evidence,
      confirm what it actually scans (HEL-880/HEL-768/HEL-927 precedent: root `npm test` finds
      zero helio-mcp tests in a worktree; `check:no-credential-leak` never reads test resources).
- [x] 10.2 `sbt test` green; classify any failure per HEL-924 rather than reporting a raw count —
      prefer `sbt 'set Test/parallelExecution := false' test` for a clean number.
- [x] 10.3 `check:scala-quality` clean.
- [x] 10.4 Re-confirm parity test (1.2) still green after ALL other changes (section 3-9), not just
      after section 2.
- [ ] 10.5 Prove the `InvalidGraph`, snapshot-atomicity, and empty-set-aggregate guards each
      failable by mutation: back the fix out, watch it go red, restore.
- [ ] 10.6 If any test is data-correctness-shaped, reuse
      `backend/src/test/resources/db/fixtures/hel904-real-dump.sql` rather than a hand-built
      fixture.
- [x] 10.7 UI gate: NOT N/A (round 2 correction) — this ticket has one real, small frontend
      surface (task 6.5/7a.1, `usePipelineRunEvents`'s `node-progress` handling). Run
      `npm run typecheck`, `npm run lint`, and the relevant Jest tests for that hook/footer; state
      this explicitly rather than defaulting to the ticket's original "backend-only" framing.

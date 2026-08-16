## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

Read fresh (no reliance on prior reports' narrative): `ticket.md`, `proposal.md`, `design.md`,
`tasks.md`, and all eight `specs/*/spec.md` deltas (the one ADDED `pipeline-assert-fail-policy` +
seven MODIFIED deltas). Cross-checked every concrete code claim against the actual current source,
not the narrative:

- **`PipelineRunService.scala`** (read in full, 524 lines): confirmed `onRunSuccess` is currently
  `Future[Unit]` (line 375), `assertionResults`/`AssertionSink` already threaded and unconditionally
  persisted via `persistAssertions` (matches 419-B baseline design.md assumes), `executeRun`'s
  Success branch (lines 321-333) is exactly the shape design.md describes, and
  `updateLastRun`/`updateRunTerminal` signatures (`PipelineRepository.scala:276`,
  `PipelineRunRepository.scala:85`) accept `rowCount: Option`/`errorLog: Option` exactly as
  Decision 3's snippet uses them.
- **`domain/AssertionResult.scala`**: `severity`/`passed`/`kind`/`field`/`message` fields exist
  exactly as `blockingFailures.filter(...)` and `summarizeBlockingFailures` require.
- **Migrations**: `V22__pipelines.sql` — `last_run_status TEXT CHECK (... IN ('succeeded','failed'))`;
  `V24__pipeline_runs.sql` + `V28__...dry_run_status.sql` — `pipeline_runs.status` CHECK already
  includes `'failed'`; `PipelineRunRegistry.scala:23` — `TerminalStatuses` already includes
  `"failed"`. All confirm Decision 1/6 ("reuse `\"failed\"`, no migration") needs no schema change.
- **`PipelineProtocol.scala`**: `RunResultResponse` is currently 5 fields, `jsonFormat5` (line 110) —
  confirms the `jsonFormat5` → `jsonFormat7` claim is accurate, and the two new fields would be
  trailing/defaulted, so the one positional call site (`previewStep`, line 176) and the existing
  round-trip test (`AggregatorRegressionSpec.scala:107`) stay compatible.
- **`BoundPanelService.scala`** (read in full): `runPipeline`'s `case Right(_) => createPanel(...)`
  and the `cleanup(Some(outputDataTypeId), inlineSourceIdOf(...), user)` helper exist exactly as
  Decision 8 describes (line numbers drifted slightly — 204-221 vs. the doc's 213-221 — but the
  described shape is accurate).
- **`PipelineProposalService.scala`** (read in full): `pipelineRunService.submit(...).flatMap { case
  Left(err) => rollbackAll(...); case Right(runResult) => Future.successful(Right(...)) }` (lines
  324-337) matches Decision 8's "same shape as its existing `Left` branch" claim — and confirms this
  service has **no** stage-tagging mechanism anywhere (`grep stageError` returns nothing in this
  file, unlike `BoundPanelService`).
- **`CombinedProposalService.scala`**: confirmed it composes `pipelineProposalService.apply(...)`'s
  `Either` result completely unchanged (`case Left(err) => Future.successful(Left(err))`), and the
  existing `combined-proposal-apply` base spec's "Atomic combined apply" requirement already commits
  to "composing only the existing `PipelineProposalService` ... unchanged" — confirms no delta is
  needed there, as proposal.md claims.
- **Spec-delta fidelity**: for all seven MODIFIED deltas, diffed the delta's requirement header
  against `openspec/specs/<cap>/spec.md`'s real header text (exact match in all seven) and confirmed
  every pre-existing scenario is preserved verbatim with only new scenarios appended — no existing
  scenario was silently dropped or reworded in a way that changes its meaning.
- **Frontend impact**: confirmed `frontend/src/features/pipelines/services/pipelineService.ts`'s
  `RunResult` interface already omits fields present on the wire (e.g. `runId`), so the two new
  `blocked`/`blockedReason` fields need no frontend type change, consistent with "no frontend
  changes" in proposal.md. Additionally verified `PipelineDetailPage.tsx`'s existing SSE handler
  already gates `markDataTypeRowsStale` on `event.status === "succeeded"` — since a blocked run now
  publishes `"failed"` (Decision 1), the existing panel-staleness invalidation correctly does NOT
  fire for a blocked run, with zero code changes needed. Good corroborating evidence the "reuse
  `failed`" decision composes cleanly with already-shipped UI.
- **Test feasibility**: `PipelineRunServiceSpec.scala` already has `AssertRule`/`AssertConfig`
  fixtures (`passingAssertRule`, line 124) trivially adaptable to a failing rule; a route-level
  rollback spec (`PipelineApplyProposalRollbackSpec.scala`) and `BoundPanelRoutesSpec.scala` already
  exist as natural homes for tasks 5.6/5.7.

### Verdict: REFUTE

The mechanism itself (Decision 8, the `Future[Unit]` → `Future[Boolean]` change, the
`jsonFormat5` → `jsonFormat7` wire change, and the claimed shape of `BoundPanelService`/
`PipelineProposalService`'s existing cleanup/rollback helpers) checks out against the real code —
round 3's fix is sound. But independent review of the round-3-added spec deltas surfaced one new,
concrete, actionable defect that blocks execution as currently written.

### Change Requests

1. **`specs/pipeline-proposal-apply/spec.md`'s new "A run blocked by an error-severity assertion
   rolls back the same as a run failure" scenario (lines 19-24) claims behavior the design doesn't
   plan to implement and the code doesn't have.** It reads: "the response is an error **naming the
   run stage**..." — but `PipelineProposalService` has no stage-tagging mechanism anywhere (confirmed
   by `grep -n "stageError"` returning nothing in that file, unlike `BoundPanelService.stageError`,
   which genuinely does prefix errors with `"[stage] message"`). This "naming the ... stage" phrasing
   appears to be copy-pasted from the `bound-panel-composition` delta (where it's accurate) without
   adjusting for the fact that `PipelineProposalService` doesn't have an equivalent mechanism. Three
   independent pieces of evidence confirm this is wrong, not just imprecise:
   - The **sibling scenario one paragraph above it, in the same requirement, in the same file**
     ("A run failure rolls back the pipeline...") — describing the exact same service's exact same
     error-return code path for a genuine (non-blocked) run failure — deliberately uses different,
     accurate language: "the response is an error **carrying the run failure's message**." No
     stage-naming claim there.
   - **design.md Decision 8** itself describes the planned `PipelineProposalService` change as
     `case Right(r) if r.blocked => rollbackAll(...).map(_ => Left(...))` — "**same shape as its
     existing `Left` branch**" — i.e., passing through a plain `ServiceError`, not adding a new
     stage-tag.
   - **tasks.md task 5.7** — the task that is supposed to implement/verify this exact scenario —
     correctly does NOT claim stage-naming either: "the response is an error (not `201`/success with
     a `run` field), and resource counts are unchanged."
   So three of the four design artifacts (design.md, tasks.md, and the sibling scenario in the same
   spec file) agree the response is just "an error," while only this one new scenario invents a
   "naming the run stage" claim nothing in the plan implements. Left as-is, this either (a) misleads
   whoever writes task 5.7's test into asserting on a stage tag that will never appear (test failure
   on accurate code), or (b) gets silently ignored, leaving the spec permanently wrong about what
   `POST /api/pipelines/apply-proposal` actually returns for a blocked run.
   **Required fix**: reword the scenario's THEN clause to match the sibling scenario's accurate,
   established phrasing for this same service — e.g. "the response is an error (not a success
   response with a `run` field pointing at an empty DataType), and counts of sources, pipelines,
   pipeline steps, and data types are all unchanged from before the call" — dropping "naming the run
   stage" entirely, since `PipelineProposalService` has no stage-naming mechanism to name it with.

### Non-blocking notes

- **design.md Decision 8's `Future[Boolean]` return type under-specifies how `blockedReason` reaches
  the caller.** The prose says `executeRun` "captures that boolean ... and builds the response with
  `blocked = <captured>, blockedReason = <captured summary, when blocked>`" — but a `Future[Boolean]`
  alone doesn't carry a summary string, so `executeRun` would have to either (a) re-filter
  `assertionSink.results` and call the private `summarizeBlockingFailures` helper a second time
  (redundant with the identical computation already done once inside `onRunSuccess` for the
  persisted `errorLog`), or (b) the return type should really be something like
  `Future[Option[String]]` (`None` = not blocked, `Some(summary)` = blocked reason), which would
  carry both the boolean and the reason in one value with no duplicate helper call. Not blocking —
  both resolutions produce the identical wire output and a competent implementer will trivially pick
  one — but worth tightening in a Decision-8 addendum before/while task 4.2 is implemented, since two
  downstream call sites (`BoundPanelService`, `PipelineProposalService`) depend on `blockedReason`
  being populated correctly.
- Everything else independently re-verified — the eight spec deltas' preserved-scenario fidelity, the
  reused-status/no-migration decision, the dry-run exemption, the alert-evaluation skip, and the
  `combined-proposal-apply` no-delta reasoning — held up against the real code with no other
  discrepancies found.

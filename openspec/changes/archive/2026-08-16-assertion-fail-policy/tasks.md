## 1. Backend: fail-policy decision + errorLog summarization

- [x] 1.1 `services/PipelineRunService.scala`: add a private
      `summarizeBlockingFailures(failures: Vector[AssertionResult]): String` helper (design.md
      Decision 2) — joins each blocking failure's `kind`/`field`/`message` into one readable line, e.g.
      `"Run blocked: N error-severity assertion(s) failed — ..."`.
- [x] 1.2 `onRunSuccess`: compute `blockingFailures = assertionResults.filter(r => r.severity == "error"
      && !r.passed)` as the first line of the method body (design.md Decision 3).

## 2. Backend: blocked-run branch

- [x] 2.1 When `blockingFailures.nonEmpty`: publish `RunStatusEvent("failed", errorLog =
      Some(summary))` (not `"succeeded"`).
- [x] 2.2 Run only `updateMeta` (`pipelineRepo.updateLastRun(..., "failed", ..., rowCount = None,
      ...)`), `updateRun` (`pipelineRunRepo.updateRunTerminal(..., "failed", ..., rowCount = None,
      errorLog = Some(summary), ...)`), and `assertionsInsert` (`persistAssertions(runId,
      assertionResults)` — the FULL vector, unconditional, exactly as 419-B already does).
- [x] 2.3 Skip `schemaUpsert`, `rowsUpsert`, `binaryRefsUpsert`, and `alertEvaluation` entirely for this
      branch (design.md Decisions 3-4) — the prior DataType snapshot must be byte-for-byte unchanged.

## 3. Backend: unchanged-path guard

- [x] 3.1 When `blockingFailures.isEmpty`: run the existing succeeded path exactly as it is today — no
      behavior change for an all-passing or warn-only run. Confirm via a diff review that this branch is
      a verbatim move, not a rewrite.

## 4. Backend: surface the block outcome to first-run-on-creation callers (design.md Decision 8 — scope
      widened at the design gate's third round)

- [x] 4.1 `api/protocols/PipelineProtocol.scala`: add `blocked: Boolean = false` and
      `blockedReason: Option[String] = None` to `RunResultResponse`; bump `runResultResponseFormat` from
      `jsonFormat5` to `jsonFormat7`.
- [x] 4.2 `services/PipelineRunService.scala`: change `onRunSuccess`'s return type from `Future[Unit]` to
      `Future[Option[String]]` (`None` = not blocked, `Some(summary)` = blocked — the same
      `summarizeBlockingFailures` output already computed in task 1.1/1.2, returned directly rather than
      recomputed). `executeRun`'s dispatch captures it (`onDryRunSuccess` wrapped `.map(_ => None)` — dry
      runs are never "blocked") and builds the response with `blocked = <captured>.isDefined`,
      `blockedReason = <captured>`.
- [x] 4.3 `services/BoundPanelService.scala` (`runPipeline`): add a `case Right(r) if r.blocked =>` guard
      before the existing `case Right(_) =>`, calling the existing `cleanup(Some(outputDataTypeId), ...)`
      path and returning `Left(stageError("run", ServiceError.UnprocessableEntity(...)))` — same shape as
      the existing `Left` branch, using `r.blockedReason`.
- [x] 4.4 `services/PipelineProposalService.scala` (the `submit(...)` dispatch inside `apply` — round 6's
      non-blocking nit: this is NOT named `applyProposal`, correcting an earlier stale reference here):
      add the equivalent `case Right(r) if r.blocked =>` guard, calling the existing
      `rollbackAll(pipelineId, summary.outputDataTypeId, resolved, user)` path.
- [x] 4.5 `services/HookTriggerService.scala` (`submitNewRun`, design.md Decision 8a — completes the
      `.submit(` call-site audit round 3 started; found at round 5, not a new scope question): change
      `.map(_.map { result => HookTriggerResponse(..., "succeeded") })` to report
      `status = if (result.blocked) "failed" else "succeeded"`. No rollback needed here — a hook-triggered
      run always re-runs an existing pipeline, so the prior DataType snapshot is already correct. Update
      the adjacent inline comment (currently asserts `"succeeded" is the only status a Right result here
      can represent"`, which this change makes false) and `schemas/hook-run-response.schema.json`'s
      top-level `description` field (round 6's non-blocking nits — cheap to fold in alongside this same
      edit).

## 5. Tests

- [x] 5.1 `PipelineRunServiceSpec` (or equivalent): a run with a failing `error`-severity assertion does
      NOT call `upsertFieldsFromRows`/`overwriteRows`/`overwriteForDataType`/`evaluateForDataType`; the
      DataType's prior rows/schema are unchanged (per spec.md's scenarios).
- [x] 5.2 Same spec: a run with only `warn`-severity failures (or all-passing) DOES update the DataType
      normally, unchanged from pre-ticket behavior.
- [x] 5.3 Same spec: the blocked run's terminal status is `"failed"` and its `errorLog` names the
      failing rule's kind/field — not the generic exception-path placeholder.
- [x] 5.4 Same spec: ALL evaluated assertion results (passing, warn, and the blocking error) are
      persisted for a blocked run, not only the blocking one.
- [x] 5.5 Same spec: a dry run with a failing error-severity assertion still completes with status
      `"dry_run"` — the fail policy does not apply to `onDryRunSuccess`.
- [x] 5.6 `POST /api/panels/bound` with a pipeline whose `assert` step has a failing error-severity rule:
      the response is `4xx`/`5xx` naming stage `"run"`, and afterward neither the pipeline nor any inline
      source created by the call exists (per `bound-panel-composition`'s new scenario).
- [x] 5.7 `POST /api/pipelines/apply-proposal` with a proposal whose steps include a failing
      error-severity `assert` rule: the response is an error (not `201`/success with a `run` field), and
      resource counts are unchanged from before the call (per `pipeline-proposal-apply`'s new scenario).
- [x] 5.8 `POST /api/hooks/run` for a pipeline whose `assert` step has a failing error-severity rule:
      the response is `200 OK` with `status: "failed"` (not `"succeeded"`), and the pipeline's prior
      DataType snapshot is unchanged (per `external-run-hooks`'s new scenario).
- [x] 5.9 `sbt test` passes (full suite).

## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all 8 spec delta files in
  `openspec/changes/assertion-fail-policy/`.
- Confirmed the round-4 fix landed correctly: `specs/pipeline-proposal-apply/spec.md`'s "A run blocked by
  an error-severity assertion rolls back the same as a run failure" scenario now says "an error carrying
  a message describing the assertion failure" — no stage-naming claim, matching its sibling scenario and
  `design.md` Decision 8's own text (no stage-tagging mechanism is invented for `PipelineProposalService`).
- Confirmed the round-4 return-type tightening is consistent everywhere it's referenced:
  `design.md` Decision 8 and `tasks.md` task 4.2 both say `onRunSuccess`'s return type changes
  `Future[Unit]` → `Future[Option[String]]` (not `Future[Boolean]`).
- Read `PipelineRunService.scala` in full (524 lines) and confirmed every concrete claim design.md makes
  about it: `onRunSuccess` (lines 375-436) runs `schemaUpsert`/`rowsUpsert`/`binaryRefsUpsert`/
  `alertEvaluation`/`updateMeta`/`updateRun`/`assertionsInsert` unconditionally today, `publish(...,
  "succeeded")` is literally the first statement in the method body (line 385), `AssertionResult` has
  exactly the `severity: String`/`passed: Boolean`/`kind: String`/`field: Option[String]`/
  `message: Option[String]` shape the filter/summarizer decisions depend on
  (`domain/AssertionResult.scala:15-23`), and `assertionSink.results` is threaded through
  `executeRun`/`onDryRunSuccess`/`onRunSuccess` exactly as described.
- Confirmed `RunResultResponse` currently has 5 fields / `jsonFormat5`
  (`api/protocols/PipelineProtocol.scala:57-63,110`) and that both existing constructor call sites
  (`PipelineRunService.scala:176,328`) and the one test call site (`AggregatorRegressionSpec.scala:107`)
  all omit `runId` or later fields positionally — appending two new trailing defaulted fields to reach
  `jsonFormat7` is genuinely backward-compatible as design.md claims.
- Confirmed `PipelineRunRegistry.TerminalStatuses = Set("succeeded", "failed", "dry_run")`
  (`api/routes/PipelineRunRegistry.scala:23`) and `pipelines.last_run_status`'s existing
  `CHECK (last_run_status IN ('succeeded', 'failed'))` (`V22__pipelines.sql:6`) — both cited accurately by
  Decision 1 as the reason a new status value would ripple further than this ticket's scope.
- Read `BoundPanelService.scala` and `PipelineProposalService.scala` around the `submit(...)` call sites
  design.md's Decision 8 targets, and confirmed `cleanup(Some(outputDataTypeId),
  inlineSourceIdOf(sourceId, inlineSource), user)`, `stageError(stage, err)`, and
  `rollbackAll(pipelineId, summary.outputDataTypeId, resolved, user)` all exist with exactly the
  signatures Decision 8's code snippets assume.
- Traced every AC in `ticket.md` to a task + spec scenario: AC1→task 5.1/`pipeline-assert-fail-policy`
  scenario 1, AC2→task 5.2/scenario 2, AC3→task 5.3/"terminal status and error summary" requirement,
  AC4→Decisions 1/6 (satisfied vacuously — no migration, matching the ticket's own "otherwise no
  migration" phrasing), AC5→task 5.8.
- Checked capability-spec Purpose/other-requirement text in `pipeline-proposal-apply`,
  `bound-panel-composition`, `alert-evaluation-engine`, `pipeline-run-execution`, and
  `datatype-row-snapshot` for any *unmodified* requirement whose "on success" framing would still
  contradict the blocked-run outcome — found none; the untouched requirements in those files describe
  only the happy path and defer failure-path behavior to the requirements this change *does* modify.

### A design gap I found: a third `submit()` caller has the identical unconditional-success defect Decision 8 set out to fix, and it is undiscussed anywhere in this change

Decision 8 (round 3) audited `pipelineRunService.submit(...)`'s callers and found two — `BoundPanelService.runPipeline`
and `PipelineProposalService`'s apply path — that treat *any* `Right(...)` as unconditional proof the
DataType was written, and fixed both. I grep'd every caller of `.submit(` in `backend/src/main/scala/`
(`grep -rn "\.submit(" backend/src/main/scala/ | grep -v PipelineRunService.scala`) and found **four**,
not two:

1. `BoundPanelService.scala:215` — covered by Decision 8 / task 4.3.
2. `PipelineProposalService.scala:324` — covered by Decision 8 / task 4.4.
3. `PipelineSchedulerService.scala:113` (`fire`) — **not a gap**: its `.flatMap { _ => ... }` discards the
   `Either` result entirely and never reports run outcome to any external caller; the already-corrected
   `pipeline_runs`/`pipelines.last_run_status` rows (Decisions 1-7, unconditional regardless of this
   caller) are the only thing downstream readers see.
4. `HookTriggerService.scala:71-89` (`submitNewRun`, backing `POST /api/hooks/run`) — **a real,
   unaddressed instance of the exact same defect class**. Its mapping is:

   ```scala
   .map(_.map { result =>
     // executeRun's only success (Right) branch always corresponds to a
     // completed, successful run -- a failed run returns Left instead
     // ... so "succeeded" is the only status a Right result here can represent.
     HookTriggerResponse(result.runId.getOrElse(pipelineId.value), pipelineId.value, "succeeded")
   })
   ```

   That comment's invariant is exactly what this ticket breaks: after this change, `submit()` can return
   `Right(result)` where `result.blocked = true` and the DataType was **not** written. Once implemented,
   a hook-triggered run blocked by a failing error-severity assertion will still return `200 OK` with
   `status: "succeeded"` to the external caller.

   This is not an internal detail — `POST /api/hooks/run` is a documented, schema-governed external
   contract (`openspec/specs/external-run-hooks/spec.md`, Purpose: "lets an external scheduler (cron,
   systemd, Cloud Scheduler) or automation launch a pipeline rebuild"), and
   `schemas/hook-run-response.schema.json`'s own description states `"status" is "succeeded" for a
   freshly-triggered run` with no failure carve-out. An unattended external scheduler polling this field
   has no other synchronous signal that the run was rejected — it would have to separately poll
   run-history to discover the truth, defeating the point of a hook contract meant to report the trigger's
   outcome directly. This is the identical failure mode Decision 8 itself calls "worse than
   `PipelineRunService`'s own re-run case ... it directly contradicts the ticket's own stated purpose",
   just in a third location. `git grep -i hook` across the entire change directory (`design.md`,
   `proposal.md`, `tasks.md`, `ticket.md`, all 8 `specs/*/spec.md`) returns **zero** matches — this isn't a
   deliberate, documented exclusion, it's an omission from round 3's audit.

   Unlike the two covered callers, no rollback is needed here (a hook re-runs an *existing* pipeline —
   Decisions 1-7 already protect the prior snapshot); the fix is narrowly the `status` string itself:
   `if (result.blocked) "failed" else "succeeded"`, mirroring how `pipeline-run-execution`'s own modified
   spec already treats a blocked run (transport-level `200`, semantic `"failed"`) rather than adding a new
   route/rollback path. `HookTriggerResponse` needs no wire-shape change (`status` is already a bare
   string, not an enum) — but `external-run-hooks/spec.md` needs a `MODIFIED Requirements` delta (a 9th
   spec delta) with a scenario, `tasks.md` needs an implementation task alongside 4.3/4.4, and a test
   alongside 5.6/5.7 (`POST /api/hooks/run` against a pipeline whose run is blocked returns
   `status: "failed"`, not `"succeeded"`), and the stale invariant-claiming comment at
   `HookTriggerService.scala:81-84` needs correcting.

### Verdict: REFUTE

### Change Requests

1. **`design.md`**: Add a decision (or extend Decision 8) auditing `HookTriggerService.submitNewRun`
   (`backend/src/main/scala/com/helio/services/HookTriggerService.scala:71-89`) as a third
   `pipelineRunService.submit(...)` caller with the unconditional-`Right`-means-success defect. Specify
   the fix: branch on `result.blocked`, report `HookTriggerResponse(..., status = "failed")` when blocked
   instead of the current unconditional `"succeeded"`; correct the now-false comment at lines 81-84
   claiming `"succeeded"` is the only representable status. No rollback/cleanup needed here (unlike
   `BoundPanelService`/`PipelineProposalService`) — this caller re-runs an existing pipeline, so the prior
   snapshot is already protected by Decisions 1-7; only the misreported status string needs fixing.
2. **`proposal.md`**: Add `external-run-hooks` to the Modified Capabilities list, with a one-line
   rationale matching the pattern already used for the other six modified capabilities (e.g. "`POST
   /api/hooks/run` already treats any `Right(...)` from `submit()` as `status: 'succeeded'` — extended so
   a blocked run reports `status: 'failed'` instead").
3. **`specs/external-run-hooks/spec.md`** (new file, 9th spec delta in this change): add a `MODIFIED
   Requirements` delta for "External trigger endpoint launches a pipeline run" carving out the blocked
   case, with a scenario: a hook-triggered run whose `assert` step fails with error severity still returns
   `200 OK` but with `status: "failed"`, not `"succeeded"`.
4. **`tasks.md`**: add an implementation task under section 4 (alongside 4.3/4.4) for the
   `HookTriggerService` fix, and a test task under section 5 (alongside 5.6/5.7) asserting `POST
   /api/hooks/run` against a pipeline whose run is blocked by a failing error-severity assertion returns
   `status: "failed"`.

### Non-blocking notes

- `tasks.md` task 4.4 refers to "the `submit(...)` dispatch inside `applyProposal`" — `PipelineProposalService`'s
  public entry point is actually named `apply` (the `submit(...)` call itself lives inside the private
  `createPipeline` helper it calls). Harmless since there is exactly one `submit(...)` call in the file, but
  worth tightening the wording when this task is next touched.

## Skeptic Report — design gate (round 6, skeptic-design-6.md)

### What I verified (with evidence)

**The specific round-6 re-verification request** — independently ran (not trusted from the
orchestrator's description):

```
$ grep -rln "\.submit(" backend/src/main/scala/
backend/src/main/scala/com/helio/api/routes/PipelineRunSubmitRoutes.scala
backend/src/main/scala/com/helio/services/BoundPanelService.scala
backend/src/main/scala/com/helio/services/HookTriggerService.scala
backend/src/main/scala/com/helio/services/PipelineSchedulerService.scala
backend/src/main/scala/com/helio/services/PipelineProposalService.scala
```

Exactly 5 files, matching design.md Decision 8a's enumeration exactly. Read each call site in
full to confirm the *characterization*, not just the count:
- `PipelineRunSubmitRoutes.scala:27` — thin shell, `ServiceResponse.run(runService.submit(...)) { result => StatusCodes.OK -> result }`; serializes the full `RunResultResponse` unconditionally, which is correct per the (unmodified-in-this-respect) `pipeline-run-execution` contract that the direct route always returns `200 OK` regardless of blocked status.
- `BoundPanelService.scala:215` — `case Right(_) => createPanel(...)` treats any `Right` as success (confirmed at lines 213-221); this is exactly Decision 8's target, task 4.3.
- `PipelineProposalService.scala:324` — `case Right(runResult) => Future.successful(Right(PipelineProposalApplyResponse(...)))` treats any `Right` as success (confirmed at lines 323-334); Decision 8's other target, task 4.4.
- `PipelineSchedulerService.scala:112-113` — `.submit(...).transform{...}.flatMap { _ => ... }` — the `Either` result is bound to `_` and discarded before rescheduling; confirmed no behavioral dependency on blocked/succeeded/failed. No fix needed, as claimed.
- `HookTriggerService.scala:70-84` (`submitNewRun`) — `.map(_.map { result => HookTriggerResponse(result.runId.getOrElse(...), pipelineId.value, "succeeded") })`, with the exact stale inline comment design.md quotes verbatim ("`succeeded` is the only status a `Right` result here can represent"). Confirmed this is the round-5 fix's target (Decision 8a / task 4.5) and is otherwise untouched pre-fix.

This enumeration is accurate and complete — round 5's "two-vs-three" gap and round 2's "five-vs-three" gap are both closed; no sixth caller exists.

**Full independent re-read of every artifact** (not limited to the round-5 diff):
`ticket.md`, `proposal.md`, `design.md` (all 8 decisions + 8a), `tasks.md` (all 5 sections), and
all 9 `specs/*/spec.md` delta files (`pipeline-assert-fail-policy` [new], `pipeline-run-execution`,
`pipeline-run-sse`, `alert-evaluation-engine`, `datatype-row-snapshot`, `pipeline-list-api`,
`bound-panel-composition`, `pipeline-proposal-apply`, `external-run-hooks`).

**Code-level claims checked against the actual worktree source** (not taken on the design doc's word):
- `AssertionResult` (`domain/AssertionResult.scala:15-23`) has exactly the `kind`/`field`/`severity`/`passed`/`message` shape the filter and summarizer decisions depend on.
- `PipelineAnalyzeService.scala:470` confirms `severity` is validated to be exactly the string `"warn"` or `"error"` — the filter predicate `r.severity == "error"` in Decision 3 is well-founded, not a guess at an enum shape.
- `PipelineRunService.scala`'s `executeRun` (252-334), `onDryRunSuccess` (351-373), and `onRunSuccess` (375-436) match every structural claim design.md makes: `onRunSuccess` runs `schemaUpsert`/`rowsUpsert`/`binaryRefsUpsert`/`alertEvaluation`/`updateMeta`/`updateRun`/`assertionsInsert` unconditionally today; `publish(..., "succeeded")` is the literal first statement; the `response` value is built before the `onRunSuccess`/`onDryRunSuccess` follow-up runs (confirming the described "capture the `Option[String]` and build the response after" refactor is a real, necessary restructuring, not just a signature change).
- `RunResultResponse` (`api/protocols/PipelineProtocol.scala:57-63`) has exactly 5 fields today; `runResultResponseFormat` is `jsonFormat5` (line 110) — confirms the jsonFormat5→jsonFormat7 claim.
- `PipelineRunRegistry.TerminalStatuses = Set("succeeded", "failed", "dry_run")` (line 23) and `pipelines.last_run_status`'s `CHECK (last_run_status IN ('succeeded', 'failed'))` (`V22__pipelines.sql`) and `pipeline_runs.status`'s `CHECK (... IN ('queued','running','succeeded','failed','dry_run'))` (`V24`/`V28`) all confirm Decision 1/6's "`\"failed\"` already satisfies every constraint, no migration needed" claim. Latest migration on this branch is `V84__pipeline_run_assertions.sql` — no conflict since none is planned.
- `pipelineRepo.updateLastRun` and `pipelineRunRepo.updateRunTerminal`'s real signatures match the parameter lists design.md's Decision 3/tasks.md's 2.2 assume exactly (including `rowCount: Option[Long]`/`Option[Int]` and `user: AuthenticatedUser`).
- `RunStatusEvent(status, rowCount, errorLog)`'s real constructor matches `RunStatusEvent("failed", errorLog = Some(summary))`.
- `BoundPanelService.runPipeline` (190-220) and `PipelineProposalService.createPipeline` (306-337) both confirmed to have exactly the `case Right(_) =>`-treats-any-success shape Decision 8 describes, with `cleanup(...)`/`rollbackAll(...)` already present with the signatures Decision 8's snippets assume.

**Spec-delta correctness (openspec mechanics)** — for all 9 deltas, confirmed:
- Every `### Requirement:` heading in a `MODIFIED Requirements` delta exactly string-matches an existing heading in `openspec/specs/<capability>/spec.md` (no typo'd/non-matching modification target).
- Every MODIFIED delta reproduces **all** of the base requirement's original scenarios verbatim, appending new scenarios rather than silently dropping any (checked `pipeline-run-execution`, `pipeline-run-sse`, `alert-evaluation-engine`, `datatype-row-snapshot`, `pipeline-list-api`, `bound-panel-composition`, `pipeline-proposal-apply`, `external-run-hooks` base files side-by-side against their deltas).
- `pipeline-assert-fail-policy` has no pre-existing base spec (confirmed absent from `openspec/specs/`) — correctly filed as `ADDED Requirements` only.
- `proposal.md`'s Modified Capabilities list (7 named + `external-run-hooks`, 8 total) plus the 1 new capability = 9, matching the 9 `specs/*/` directories exactly — no orphaned delta, no capability claimed-but-missing.

**Acceptance-criteria trace** (`ticket.md`), independently re-derived:
- AC1 (blocked run preserves prior snapshot) → `pipeline-assert-fail-policy` scenario 1 + `datatype-row-snapshot` delta + task 5.1.
- AC2 (warn-only completes normally) → `pipeline-assert-fail-policy` scenario 2 + task 5.2.
- AC3 (discoverable via run-history) → "terminal status and error summary" requirement + task 5.3; satisfied by correct `status`/`errorLog` data alone since 419-D (UI) is explicitly out of scope and the existing run-history route already surfaces these fields for any run.
- AC4 (migration only if new status) → Decisions 1/6, vacuously satisfied (no new status, no migration) — consistent with the CHECK-constraint evidence above.
- AC5 (`sbt test` passes, no FQNs) → task 5.9; confirmed no FQN-style (`com.helio....`) code snippets anywhere in `design.md`/`tasks.md` that would model the wrong pattern for an implementer.

**No placeholders/TBD**: `grep -rniE "TODO|TBD|FIXME|figure out|to be determined|placeholder"` across all planning artifacts returns only the deliberate "not a generic placeholder" phrasing (describing what the design explicitly avoids), no unresolved markers.

**Scope discipline**: confirmed no frontend changes are needed or planned — `frontend/src/features/pipelines/services/pipelineService.ts`'s `RunResult` interface doesn't consume the two new wire fields, and no frontend code references `POST /api/hooks/run` at all, consistent with `proposal.md`'s "backend only" framing.

**Prior-round fixes verified landed, not just claimed**: round 4's stage-tagging correction is present verbatim in `specs/pipeline-proposal-apply/spec.md` (no stage-naming claim, matches its sibling scenario); round 3's Decision 8 code/spec deltas are present and internally consistent with the real `BoundPanelService`/`PipelineProposalService` code; round 5's Decision 8a, the `external-run-hooks` 9th delta, `proposal.md`'s addition of `external-run-hooks` to Modified Capabilities, and tasks.md's 4.5/5.8 are all present and match the actual `HookTriggerService.scala` code precisely, including the exact stale-comment text round 5 quoted.

### Verdict: CONFIRM

The design is sound, internally consistent, and — after six rounds — the `.submit()` call-site
audit is now independently confirmed exhaustive and correctly enumerated. Every concrete
code-level claim in `design.md` checks out against the real worktree source; every spec delta is
mechanically well-formed (correct MODIFIED targets, no dropped scenarios) and traces back to a
real behavioral change this ticket introduces; all 5 acceptance criteria are covered by a
task + spec scenario; no scope drift, no missing contract update of consequence, no placeholders.

### Non-blocking notes

1. `tasks.md` task 4.4 still describes the fix site as "the `submit(...)` dispatch inside
   `applyProposal`" — `PipelineProposalService`'s public entry point is actually named `apply`
   (`PipelineProposalService.scala:79`); the `submit(...)` call itself lives inside the private
   `createPipeline` helper. Flagged non-blocking in round 5 and still unfixed; harmless since
   there's exactly one `submit(...)` call in the file, but worth a wording pass whenever this task
   is next touched.
2. Neither `design.md` Decision 8a nor `tasks.md` task 4.5 explicitly calls out correcting the
   now-stale inline comment at `HookTriggerService.scala:81-84` ("`succeeded` is the only status a
   `Right` result here can represent") that round 5 asked to have fixed alongside the behavioral
   change. The comment sits directly inside the exact code block task 4.5 has the implementer
   rewrite, so a competent implementer will very likely correct it as a natural side-effect of
   touching that block — but it's not written down as its own line item, so it's worth a one-line
   mention if this task list is revised again.
3. `schemas/hook-run-response.schema.json`'s description text ("`status` is `\"succeeded\"` for a
   freshly-triggered run... " with no failure carve-out) becomes literally inaccurate after this
   change, even though the field's *type* (a bare `string`, no enum) doesn't need to change and so
   no schema-shape delta is required. Same category as note 2 — a documentation-string staleness,
   not a contract break, but a clean pass would update the description alongside the `.scala` fix.
4. `ticket.md`'s Flyway guidance ("next available VNN... main at V59") is stale (`V84` is now the
   latest on this branch); moot under Decision 1/6 since no migration is planned, and already
   flagged non-blocking in round 1 — repeating here only so it isn't rediscovered as new in a
   future round.

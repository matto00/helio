## Context

419-B (HEL-509) already threads `assertionResults: Vector[AssertionResult]` into both `onDryRunSuccess`
and `onRunSuccess` (`PipelineRunService.scala:330-331`), and already persists every result unconditionally
via `persistAssertions` regardless of pass/fail. `onRunSuccess`'s current body (lines 375-436) runs five
independent effects unconditionally on any successful pipeline execution: `schemaUpsert`
(`upsertFieldsFromRows`), `rowsUpsert` (`dataTypeRowRepo.overwriteRows` — a full replace, not a merge),
`binaryRefsUpsert`, `alertEvaluation` (`AlertEvaluationService.evaluateForDataType`, HEL-466), and the
terminal-status/history writes (`updateMeta`, `updateRun`, `assertionsInsert`). This ticket inserts a
decision point before the first four.

## Goals / Non-Goals

**Goals:**
- An `error`-severity assertion failure blocks the DataType schema/row/binary-ref writes; the previous
  snapshot stays exactly as it was.
- A `warn`-only (or all-passing) run is completely unaffected — same behavior as today.
- The block is discoverable via the run's terminal status + `errorLog`, without any new route or UI.

**Non-Goals:**
- A new alert trigger tied to assertion failures (HEL-430's job, later).
- Any Run History UI change (419-D).

## Decisions

**1. No new `pipeline_runs.status` value — reuse `"failed"`.** The ticket offers two options: reuse
`"failed"` with a descriptive `errorLog`, or introduce a distinct status (`blocked`/`assertion_failed`)
via a Flyway migration. A new status value would ripple into `RunStatusEvent.TerminalStatuses`
(`PipelineRunRegistry.scala:23` — already closed over `Set("succeeded", "failed", "dry_run")`) and the
frontend's `RunStatus`/`PipelineRunRecord.status` type unions — both out of this ticket's stated scope
(419-D owns Run History UI). `"failed"` already satisfies every acceptance criterion: it's a real
terminal status, it's already a registered SSE terminal status, and `pipelines.last_run_status`'s own
CHECK constraint (`V22__pipelines.sql`) already allows only `'succeeded'`/`'failed'` — introducing a
third value there would need its own migration too. Reusing `"failed"` needs none of that; the
`errorLog` content (Decision 2) is what actually makes the failure *reason* discoverable, which is what
the acceptance criteria ask for, not a new enum value.

**2. `errorLog` for a blocked run is a real, structured summary — not a generic placeholder.** The
existing exception-failure path (`runFuture.transformWith`'s `Failure` branch) uses a generic
`"Pipeline execution failed"` message specifically because HEL-311's discipline is about *raw exceptions*:
don't leak stack-trace/internal detail to the client, log it server-side instead. A blocked run is not an
exception — it's a deliberate, structured business outcome, and the assertion's own `message` field
(populated by HEL-509's evaluation logic with safe, descriptive text like "3 of 10 rows have a null
value") is exactly the kind of client-safe content HEL-311 permits surfacing directly. `errorLog` is
built by a new private helper, `summarizeBlockingFailures(failures: Vector[AssertionResult]): String`,
joining each blocking failure's `kind`/`field`/`message` into one readable line
(e.g. `"Run blocked: 1 error-severity assertion failed — notNull(email): 3 of 10 rows have a null
value"`) — this is what lets 419-D's future Run History UI explain *why* a run was blocked, per the
ticket's own acceptance criterion.

**3. `onRunSuccess` branches into two paths at the top, before any write.** Compute
`val blockingFailures = assertionResults.filter(r => r.severity == "error" && !r.passed)` as the very
first line. If non-empty: publish `RunStatusEvent("failed", errorLog = Some(summary))` (not
`"succeeded"`), run only `updateMeta`/`updateRun` (both `"failed"`, `rowCount = None` — mirroring the
existing exception-failure branch's own `rowCount = None` convention, since nothing new was written) and
`assertionsInsert` (unconditional, all results — pass, warn, and error alike, exactly as 419-B already
does). Skip `schemaUpsert`, `rowsUpsert`, `binaryRefsUpsert`, and `alertEvaluation` entirely. If empty:
run the existing succeeded path completely unchanged (this is a pure insertion, not a rewrite of the
happy path).

**4. Alert-rule evaluation (HEL-466) is also skipped on a blocked run — a self-approved, tightly-scoped
extension of "preserve last-good data."** `alertEvaluationService.evaluateForDataType` evaluates
threshold rules against `resultRows` — the just-computed rows from *this* run, not the DataType's
persisted state. On a blocked run, those rows are never written; evaluating alert thresholds against
data that was deliberately rejected and never became "the current DataType" would fire alerts referencing
values the dashboard never actually showed. This is not the same thing as the ticket's own out-of-scope
item ("raising an external alert on failure... a natural future trigger") — that's about a *new* alert
mechanism reacting to the assertion failure itself; this decision is about *withholding* the existing,
unrelated threshold-alert evaluation from running against not-actually-persisted data, which is closer to
a correctness fix than new functionality.

**5. Dry runs are exempt from the block policy entirely — no code path change needed in
`onDryRunSuccess`.** A dry run never calls `schemaUpsert`/`rowsUpsert`/`binaryRefsUpsert` in the first
place (it only returns a preview); there is nothing to "protect" by blocking. Assertion results are
already persisted for a dry run (419-B), so a user dry-running a pipeline can already see which rules
would fail via `pipeline_run_assertions`, without this ticket needing to touch `onDryRunSuccess` at all.

**6. No Flyway migration in this change.** Follows directly from Decision 1 — `"failed"` needs no schema
change anywhere it's referenced. Per the ticket's own acceptance criterion 4's conditional phrasing
("otherwise no migration"), this is the expected outcome of this design, not an omission.

**7. Five existing capabilities' specs need `MODIFIED Requirements` deltas — found across two rounds at
the design gate.** `openspec/specs/pipeline-run-execution/spec.md` and
`openspec/specs/pipeline-run-sse/spec.md` (round 1) both make unconditional claims this change directly
contradicts (`last_run_status`/`pipeline_runs.status` = `"succeeded"` on any exception-free execution;
the DataType schema always being written; the `succeeded` SSE event always following exception-free
completion) — each gets a `MODIFIED Requirements` delta in this change directory carving out the
blocked-run exception, rather than leaving `proposal.md`'s Modified Capabilities section blank.
`openspec/specs/alert-evaluation-engine/spec.md`'s "Evaluation never fails the triggering pipeline run"
requirement (round 1) is the debatable case: its existing text says a run that *fails* before the
row-write step produces no evaluation — but a blocked run *succeeds* (reaches `onRunSuccess`) and is
withheld before that same step for a policy reason, not an exception, which the existing wording doesn't
literally cover even though the Purpose statement's "freshly-written rows" framing already implies the
right behavior. Resolved by extending that requirement's text and adding one scenario, rather than
leaving the connection implicit. Round 2 found the same "unconditional success ⇒ write X" pattern
duplicated in two more places the round-1 fix didn't reach: `openspec/specs/datatype-row-snapshot/spec.md`
(the `data_type_rows` table itself — the exact table ticket.md's AC1 names — governed by its own
capability separate from `pipeline-run-execution`'s DataType *schema* requirement) and
`openspec/specs/pipeline-list-api/spec.md` (which independently restates the `pipelines.last_run_status`
claim already carved out once in `pipeline-run-execution`, in its own "Backend pipelines table exists"
requirement). Both get the identical carve-out treatment. This recurring pattern — the same underlying
fact duplicated verbatim across multiple capability specs, each needing its own delta — is itself worth
noting for a future ticket in this area: a single "run outcome" concept is currently documented in at
least five places.

**8. `RunResultResponse` gains `blocked: Boolean = false` and `blockedReason: Option[String] = None` —
found at the design gate's third round, human-authorized scope widening.** Round 3 found that
`BoundPanelService.runPipeline` (`BoundPanelService.scala:213-221`) and `PipelineProposalService`
(`PipelineProposalService.scala:323-334`) both treat *any* `Right(...)` from
`pipelineRunService.submit(...)` as unconditional proof the DataType was written, proceeding to
`createPanel`/returning success with no rollback. Since these are first-run-on-creation flows (a brand
new pipeline via `POST /api/panels/bound` or `POST /api/pipelines/apply-proposal`), there is no
prior-good-data snapshot to fall back on — a blocked first run would leave the DataType with zero
rows/no schema, yet both services would still treat it as success. This is worse than
`PipelineRunService`'s own re-run case (Decisions 1-7), where the *old* snapshot at least survives, and
it directly contradicts the ticket's own stated purpose ("bad data never reaches bound panels/metrics").

Fix: `onRunSuccess`'s return type changes from `Future[Unit]` to `Future[Option[String]]` — `None` when
not blocked, `Some(summary)` (the SAME `summarizeBlockingFailures` output already computed at the top of
the method, Decisions 2-3) when blocked — so the method's return value carries both "was it blocked" and
"why" in one value, with no second computation of the summary anywhere else. `executeRun`'s dispatch
(`isDry` ? `onDryRunSuccess` : `onRunSuccess`) captures that `Option[String]` — `onDryRunSuccess` is
wrapped `.map(_ => None)` (dry runs are never "blocked," Decision 5, unchanged) — and uses it to build
`RunResultResponse(..., blocked = <captured>.isDefined, blockedReason = <captured>)`. This is the "have
`PipelineRunService` surface the block outcome directly" option (vs. a repo lookup): no extra DB
round-trip, no dependency on `pipelineRunRepo` being non-null (nullable in some deployments/tests per
this file's own constructor defaults), no race (the block decision and its persistence already complete,
synchronously in the `Future` chain, before `submit()`'s own `Future` resolves).

`BoundPanelService.runPipeline` and `PipelineProposalService`'s equivalent call site both gain one new
guard, checking `runResult.blocked` on the `Right` case — a bounded extension of existing branching
logic (per the human's own framing), reusing each service's already-existing `cleanup`/`rollbackAll`
compensating-transaction paths exactly as they already handle a `Left`:
- `BoundPanelService`: `case Right(r) if r.blocked => cleanup(Some(outputDataTypeId), ...).map(_ =>
  Left(stageError("run", ServiceError.UnprocessableEntity(r.blockedReason.getOrElse(...)))))` — same
  shape as the existing `Left` branch, just reached via a different condition.
- `PipelineProposalService`: `case Right(r) if r.blocked => rollbackAll(pipelineId,
  summary.outputDataTypeId, resolved, user).map(_ => Left(...))` — same shape as its existing `Left`
  branch.

Wire format: `PipelineProtocol.scala`'s `runResultResponseFormat` moves from `jsonFormat5` to
`jsonFormat7` to cover the two new fields — both default-valued, so no existing caller/test that
constructs a `RunResultResponse` positionally-with-defaults breaks.

Two more capability specs need `MODIFIED Requirements` deltas for the same reason as Decision 7's five:
`bound-panel-composition`'s "A mid-chain failure names its stage and triggers compensating cleanup"
already treats a run failure as a `"run"`-stage rollback trigger; `pipeline-proposal-apply`'s "Full
rollback on any mid-apply failure" already treats "the run itself" failing as a rollback trigger — both
extended so a blocked run (which returns `Right`, not `Left`) is treated identically.
`combined-proposal-apply` needs no delta: its own "Atomic combined apply" requirement explicitly composes
`PipelineProposalService`'s Either result "unchanged," so it inherits this fix transitively with no code
or spec change of its own.

**8a. `HookTriggerService.submitNewRun` is the third (and, per an exhaustive grep of every
`.submit(` call site, final) caller with the same defect — found at the design gate's fifth round,
completing round 3's audit rather than reopening the scope question round 3 already resolved.**
`grep -rln "\.submit(" backend/src/main/scala/` names exactly five call sites:
`PipelineRunSubmitRoutes` (the direct HTTP route — correctly unaffected, Decision 3's contract), 
`BoundPanelService`/`PipelineProposalService` (fixed by Decision 8 above), `PipelineSchedulerService`
(discards the `Either` entirely via `.flatMap { _ => ... }` before scheduling the next tick — already
correctly indifferent to blocked/succeeded/failed, no fix needed), and `HookTriggerService.submitNewRun`
— which unconditionally maps any `Right(result)` to `HookTriggerResponse(..., status = "succeeded")`,
with its own inline comment asserting the exact invariant this ticket makes false ("`succeeded` is the
only status a `Right` result here can represent"). Unlike `BoundPanelService`/`PipelineProposalService`,
this caller needs **no rollback** — `POST /api/hooks/run` always re-runs an *existing* pipeline (per
`external-run-hooks`'s own Purpose: "launch a pipeline rebuild"), so a blocked run correctly leaves the
prior-good DataType snapshot in place already; the only defect is the reported `status` string being
wrong. Fix: `submitNewRun`'s `.map(_.map { result => ... })` reads `result.blocked` (Decision 8's new
field) and reports `status = if (result.blocked) "failed" else "succeeded"`.

## Risks / Trade-offs

- [Blocked-run `rowCount = None`, not `Some(0)` or the computed-but-rejected row count] → deliberate,
  surfaced explicitly here rather than left buried in Decision 3's prose: a blocked run's `row_count`
  column mirrors the existing execution-failure convention (`rowCount = None`) since nothing was written
  to the DataType — there is no "current row count" to report, only a rejected candidate. 419-D's future
  Run History UI inherits this: a blocked run shows no row-count number, the same as a crashed run, only
  distinguishable via `errorLog` content and `pipeline_run_assertions`.
- [Skipping `alertEvaluation` on a blocked run (Decision 4) is not explicitly requested by the ticket] →
  grounded directly in the ticket's own "preserve last-good data" requirement extended one step further;
  the alternative (firing alerts against rejected data) is a correctness bug this design avoids
  introducing, not a feature being added.
- [Reusing `"failed"` (Decision 1) means a blocked run and a genuinely-crashed run share one status
  value] → the two remain distinguishable via `errorLog` content (Decision 2) and, going forward,
  `pipeline_run_assertions` itself (419-B) — a blocked run always has at least one persisted
  `error`-severity `passed = false` row; a crashed run has none. 419-D can use this distinction without
  needing a new status value.

## Planner Notes

- Self-approved Decisions 1, 3, 4, 5, 6 — each resolves an ambiguity the ticket explicitly left open
  ("e.g. ... or a distinct status if the design doc introduces one") in the minimal-scope direction,
  grounded in the actual `RunStatusEvent`/`pipelines.last_run_status` constraints already in the
  codebase. Decision 4 is the one furthest from the ticket's literal text — called out explicitly above
  for the design-gate skeptic to scrutinize directly.

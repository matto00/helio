## Context

Live incident (HEL-755): applying a `CombinedProposal`/`PipelineProposal` with a nested inline
`rest_api` source pointed at a non-resolving hostname returned a bare `502` and created nothing.

Tracing the flow (`backend/src/main/scala/com/helio/services/PipelineProposalService.scala`):

1. `resolveRestSource` → `sourceService.createRest` → `CreateSourceEnvelope.build` (already
   `Either`-safe: a connector fetch failure becomes `CreateSourceResponse(fetchError = Some(err))`,
   never a thrown exception).
2. `handleInlineCreated` (lines 250-264, shared by `rest_api`/`sql`) sees `fetchError = Some(err)` and
   **deletes the just-created source**, returning `Left(ServiceError.BadGateway(err))`. This IS a typed
   error (`ServiceResponse.completeError` gives it a JSON body), so the "bare 502" the incident reported
   is this typed-but-destructive response, not a raw unhandled exception — the two candidates the ticket
   asked to trace ("does something downstream abort on `fetchError`?" / "does the first run hit
   `RestApiConnector.fetch` unsafely?") resolve to: yes, `handleInlineCreated` aborts; the first-run
   candidate is not reached in this exact incident because `handleInlineCreated` already short-circuits
   first.
3. **A second, independent finding, load-bearing for the fix**: `PipelineRunService.runPipeline`
   (`PipelineRunService.scala:134-139`) and `InProcessPipelineEngine.loadRows`
   (`InProcessPipelineEngine.scala:105-111`) both categorically reject `RestSource`/`SqlSource` —
   `"Only static and csv are currently supported"` — **regardless of connectivity**. This is documented,
   intentional, pre-HEL-755 behavior (`PipelineProposalService.scala`'s own D6 comment: "run failure
   (including the rest_api/sql Spark-submission rejection) is 'a failure at any step' — full rollback").
   Confirmed live in `PipelineApplyProposalRollbackSpec.scala`'s `"roll back ... when the run fails"`
   test, which uses `RestSuccessUrl` (a healthy fetch) and still asserts full rollback.

   Consequence: fixing only step 2 (stop deleting on `fetchError`) is not sufficient — `createPipeline`
   would then reach its unconditional `pipelineRunService.submit` call, which rejects `rest_api`/`sql`
   unconditionally, triggering the *same* `rollbackAll` via a different, DNS-independent path. Both
   must be fixed together for the ticket's stated goal ("user lands on a real pipeline") to hold.

Real execution support for `rest_api`/`sql` base sources doesn't exist anywhere in the pipeline engine
today (confirmed in both `PipelineRunService` and `InProcessPipelineEngine`) — that is a materially
larger, pre-existing platform gap, not something this ticket implements.

## Goals / Non-Goals

**Goals:**
- An unreachable/misconfigured inline `rest_api`/`sql` source no longer deletes itself or the pipeline
  during apply.
- A pipeline whose resolved source kind the engine can't execute (`rest_api`/`sql`, healthy or not) is
  still created, with the "not run" state reported via the existing `blocked`/`blockedReason` fields on
  `RunResultResponse` (HEL-570) — no new wire fields, no schema change — AND durably persisted as a real
  `pipeline_runs` row, so it survives a page reload and is visible without relying on the apply response
  alone (see D3 — round-1 skeptic REFUTE finding, below).
- `static`/`csv` sources: zero behavior change (their eager-run + rollback-on-failure path is untouched).

**Non-Goals:**
- Implementing real Spark/in-process execution for `rest_api`/`sql` sources — filed as **HEL-758**
  (`https://linear.app/helioapp/issue/HEL-758`), not fixed here.
- Persisting a NEW durable connection-status field on `DataSource` itself, or any new frontend UI — D3
  below persists the reason as an ordinary `pipeline_runs` row using existing repository methods, which
  the pipeline list's/detail footer's existing `lastRunStatus` badge and the Run History modal already
  render with zero frontend changes.

## Decisions

**D1 — `handleInlineCreated` proceeds on `fetchError` instead of deleting.** Add `fetchError:
Option[String] = None` to the private `ResolvedSource` case class; on `Some(err)`, return
`Right(ResolvedSource(sourceId, responseForClient = Some(csr.source), createdByThisCall = true,
companionDataTypeIds = Vector.empty, fetchError = Some(err)))` instead of deleting + `Left`.
Alternative considered: surface `fetchError` only on the response without changing control flow — no,
the delete-and-abort IS the control-flow bug; the field is the vehicle for D2's message, not the fix.

**D2 — Skip the eager run for an execution-unsupported source kind, report `blocked`.** Add `kind:
String` to `ResolvedSource`, populated at each resolution site (`ds.kind` for the existing-sourceId
branch; `DataSourceKind.RestApi`/`.Sql`/`.Static` for each inline branch — `handleInlineCreated` takes
`kind` as a new parameter from its two callers). In `createPipeline`, after `addSteps` succeeds, branch
on `PipelineRunService.SparkUnsupportedKinds.contains(resolved.kind)` (a new `val
SparkUnsupportedKinds: Set[String] = Set(DataSourceKind.RestApi, DataSourceKind.Sql)` on
`PipelineRunService`'s companion object, single-sourcing the same set `runPipeline`/`previewStep`
already hardcode as `RestSource`/`SqlSource` pattern matches — those two call sites are left as their
existing exhaustive sealed-trait matches, unchanged, to minimize diff/risk; the new constant exists so
`PipelineProposalService` doesn't duplicate the kind list as a third copy):
  - **True** → skip `pipelineRunService.submit` entirely; call the new `PipelineRunService.recordUnrunnable`
    (D3) to get back a `RunResultResponse`, then return `Right(PipelineProposalApplyResponse(source =
    resolved.responseForClient, pipeline = summary, outputDataTypeId = summary.outputDataTypeId, run =
    <that response>))`. `reason` is `resolved.fetchError`-derived when present (`s"Could not fetch from
    the source: ${err}. Fix the source configuration, then trigger a run from the pipeline once ${kind}
    execution is supported."`) else a fixed explanatory string ("$kind sources aren't executed
    automatically yet — this pipeline was created without a run.").
  - **False** → existing logic, byte-for-byte unchanged.
Alternative considered: make `run` an `Option` on `PipelineProposalApplyResponse` and add a distinct
`skipped`/`unsupported` variant — rejected: widens the wire contract (frontend/schema/every consumer)
for no behavioral gain over reusing `blocked`/`blockedReason`, which HEL-570 already established as
"a run that didn't produce output, here's why."

**D3 — Persist the blocked run as a real `pipeline_runs` row (round-1 skeptic REFUTE finding).** The
original draft of this design stopped at D2's in-memory `RunResultResponse` and claimed the existing Run
History UI would surface it — false: `PipelineRunService`'s only `pipeline_runs` writes
(`insertRun`/`updateRunTerminal`) live inside `executeRun`, reached only via `submit` → `runPipeline`,
which D2 deliberately bypasses, so nothing was ever written and Run History showed the generic "No runs
recorded yet" empty state. Fix: add `PipelineRunService.recordUnrunnable(pipelineId: PipelineId, reason:
String, user: AuthenticatedUser): Future[RunResultResponse]`, mirroring the existing `onBlockedRun`
persistence pattern (HEL-570) minus the assertion-specific parts: generate a `runId`/`now`, `insertRun`
(best-effort, `recoverWith`-guarded like every other call site in this file), `updateRunTerminal(runId,
"failed", now, rowCount = None, errorLog = Some(reason), user)`, `pipelineRepo.updateLastRun(pipelineId,
"failed", now, rowCount = None, user)`, then return `RunResultResponse(rows = Vector.empty, rowCount = 0,
runId = Some(runId.value), blocked = true, blockedReason = Some(reason))`. `PipelineProposalService`
calls this instead of constructing a `RunResultResponse` literal. This makes the reason durable (survives
reload) and, as a side effect of reusing `updateLastRun`, the pipeline's `lastRunStatus` becomes
`"failed"` — already rendered as a red "Failed" badge/chip by `PipelineListTable.tsx`'s `StatusBadge` and
`PipelineDetailFooter.tsx` (verified: both already read `PipelineSummary.lastRunStatus`), and the run row
itself appears in `RunHistoryModal.tsx` via its existing generic "failed run with `errorLog`" rendering —
zero frontend changes needed, unlike the rejected D2 alternative above which really would have needed one.

**D4 — `ConnectionTest`/`testConnection` pre-validation (ticket's "consider using it") — deferred, not
adopted.** `CreateSourceEnvelope.build` is already `Either`-safe; pre-validating with `testConnection`
before the real fetch would change *when* a failure is detected, not *whether* it's handled safely —
no additional safety, plus a second network round-trip. Out of scope for this fix.

## Risks / Trade-offs

- [Risk] A pipeline created via apply-proposal against a `rest_api`/`sql` source now sits permanently
  un-run (nothing currently lets it be run — `POST /api/pipelines/:id/run` hits the identical
  `PipelineRunService` gate). → Mitigation: this is strictly better than today's alternative (silent
  full deletion); `blockedReason` says so honestly, D3 persists it durably, and **HEL-758** tracks real
  execution support as a separate, non-blocking follow-up.
- [Risk] Broadening the "don't roll back" condition to *every* `rest_api`/`sql` apply (not just the
  `fetchError` case reported in the incident) is a larger behavior change than the literal bug report.
  → Mitigation: necessary — D2's own analysis shows the healthy-fetch case rolls back today for the
  identical reason (Spark-submission rejection), so *not* fixing it would leave the ticket's stated
  acceptance criterion ("user lands on a real pipeline") unmet for the exact scenario reported.
- [Risk] Reusing `updateLastRun`/`insertRun`/`updateRunTerminal` for a run that was never actually
  attempted could read as misleading (the pipeline "ran and failed" vs. "was never run"). → Mitigation:
  `errorLog`/`blockedReason` state plainly that the source kind isn't executed automatically yet or that
  the fetch failed — same honesty bar the assert-blocked-run precedent (HEL-570) already set for "a run
  record exists, here's why it didn't produce output."

## Planner Notes

- Self-approved: filing a follow-up ticket for "implement real pipeline execution for `rest_api`/`sql`
  sources" rather than treating it as in-scope here — it's a substantial, pre-existing feature gap
  (confirmed absent in both `PipelineRunService` and `InProcessPipelineEngine`), not a "root-cause and
  fix an unsafe path" bug fix. Filed as **HEL-758**.
- Self-approved: broadening the fix to cover the healthy-fetch/existing-sourceId `rest_api`/`sql` cases
  (D2), not just the literal DNS-failure scenario — see Risks above for why the narrower fix wouldn't
  actually satisfy the ticket's stated acceptance criteria.
- **Round-1 design-gate skeptic REFUTE, addressed**: the original draft (a) asserted, in completed-past
  tense, that a follow-up ticket "was filed alongside this change" before it actually existed — now
  actually filed as HEL-758, cited above, no longer a false claim; (b) claimed `blockedReason` was
  "already visible via existing Run History UI" for D2's skip case, which the skeptic traced end-to-end
  and found false (no `pipeline_runs` row was ever written for that case, and neither review page renders
  `run.blocked` today) — addressed by D3 above, which persists a real run row using existing repository
  methods so the existing `lastRunStatus` badge/Run History UI genuinely does surface it, no longer just
  a claim.

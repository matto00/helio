## Context

419-B (`PipelineRunRepository.listAssertionsByRun`/`listAssertionsByRunInternal`) persists every
evaluated `AssertionResult` per run. 419-C blocks a run's DataType write on any error-severity failure,
reusing the existing `"failed"` status (no dedicated `"blocked"` status exists). `PipelineRunRecord`
(`PipelineProtocol.scala`) and `RunHistoryModal.tsx` currently carry no assertion data at all.

Panels reach their bound DataType via `getDataTypeId(panel)` (`panelNarrowing.ts`) — already used by
`PanelCard.tsx` for the `dataAsOf` freshness line. Investigating that existing field revealed it is
**only ever populated on the public/shared dashboard route** (`PublicDashboardRoutes.scala`); every
authenticated panel-list call site (`DashboardRoutes`, `PanelRoutes`, `DashboardContentsRoutes`,
`DashboardProposalRoutes`, `CombinedProposalService`, `BoundPanelService`, plus several
patch-set/undo-preview call sites) constructs `PanelResponse.fromDomain(p)` with no second argument,
defaulting to `None` — meaning the authenticated dashboard-editing view a user actually works in never
even sees `dataAsOf` today. This matters directly to this ticket's own data-path decision below.

`PipelineRepository.findLastRunAtByOutputDataTypeId` is the closest existing precedent for "given a
DataTypeId, look up pipeline-run-derived metadata": a system-context method taking only a `DataTypeId`,
with its own doc comment stating the ACL gate is enforced by the *caller* ("the panel response
assembler... caller can only reach panels they are allowed to see"), not by this method itself.

## Goals / Non-Goals

**Goals:**
- Every run in Run History shows a real pass/fail-by-severity summary with failing rules' messages
  expandable, without requiring a second modal or navigation.
- A panel bound to a DataType whose latest run had an error-severity assertion failure shows an
  informational badge, cheaply (no N-per-panel request storm for a dashboard with many panels).

**Non-Goals:**
- Retrofitting `dataAsOf` onto every authenticated panel-list call site — a real, separately-scoped gap
  this ticket's own investigation surfaced but does not fix (out of this ticket's stated scope).
- Any change to the blocking policy itself (419-C) — this ticket only reads what already persists.

## Decisions

**1. `AssertionSummary` is a new, non-optional field on `PipelineRunRecord`, zero-valued (not
`Option`-wrapped) when a run had no assert steps.** Mirrors the existing `stepRowCounts: Map[String,
Long] = Map.empty` convention (empty-collection default, not `Option`) rather than introducing a new
"maybe absent" pattern the frontend would need a null-check for. Shape:
```scala
final case class AssertionFailureDetail(kind: String, field: Option[String], severity: String, message: Option[String])
final case class AssertionSummary(passed: Int, warnFailed: Int, errorFailed: Int, failures: Vector[AssertionFailureDetail])
```
`failures` carries only the FAILED results (passing ones are just a count) — the UI's expandable list
only ever needs to explain a failure, never a pass.

**2. `history()` fetches assertions per run via a bounded `Future.traverse`, not a bulk join.**
`PipelineRunRepository.deleteOldRuns(..., keepN = 10)` and `deleteOldDryRuns(..., keepN = 10)` each
independently cap their own kind of run at 10 rows (real and dry runs are pruned separately), so
`history()` returning at most ~20 runs (10 real + 10 dry) means at most ~20 concurrently-issued
(`Future.traverse` runs its futures concurrently, not sequentially) `listAssertionsByRunInternal` calls
per history request — a small, fixed upper bound either way, not a scaling risk. A bulk
"assertions for N run ids in one query" method would be a legitimate optimization but is not warranted
by this ticket's own bound; introducing one here would be unrequested scope.

**3. One criterion — "does the latest run have an error-severity failed assertion" — covers both AC
clauses ("had error-severity assertion failures" and "was blocked").** 419-C's blocking is *always*
caused by exactly that condition (design.md Decision 3 of HEL-570's own change: `blockingFailures =
assertionResults.filter(r => r.severity == "error" && !r.passed)`), so checking the persisted
`pipeline_run_assertions` for the latest run directly is both necessary and sufficient — no need to also
inspect `pipeline_runs.status`/`errorLog` (which, post-419-C, can't distinguish "blocked by assertion"
from "crashed for an unrelated reason" anyway, since both reuse `"failed"`).

**4. A new, dedicated `GET /api/types/:id/assertion-status` route — not piggybacking `PanelResponse`.**
The ticket explicitly offers both options; piggybacking is rejected specifically because of the Context
section's finding: `dataAsOf` (the one existing precedent for "derived pipeline-run metadata riding
along on a panel response") is wired into exactly one of at least seven `PanelResponse` construction
sites, and adding a second such field would mean auditing and updating all seven to avoid silently
under-populating it for most authenticated views — a large, unbounded-feeling blast radius for what this
ticket needs. A small dedicated route, by contrast, has exactly one call site to wire (frontend fetch),
mirrors `GET /api/types/:id/rows`'s existing per-DataType read shape and ACL pattern precisely, and
degrades safely (a panel simply shows no badge if the fetch hasn't resolved yet, rather than needing
every panel-list response reshaped).

**5. New repository method `PipelineRunRepository.findLatestRunIdByOutputDataTypeIdInternal(dataTypeId:
DataTypeId): Future[Option[PipelineRunId]]`, living in `PipelineRunRepository` (not
`PipelineRepository`).** It needs to join `pipelines` (to resolve `output_data_type_id → pipeline_id`)
with `pipeline_runs` (to find the latest by `started_at desc`) — `PipelineRunRepository` already holds
both `pipelinesTable` and `runsTable` as private vals for exactly this cross-table-lookup reason
(confirmed by reading the existing `pipelineOwnedAction`/`listByPipeline` methods), so this is a natural
addition there rather than introducing a new cross-repository dependency. System-context (privileged) —
same posture as `findLastRunAtByOutputDataTypeId`, ACL enforced by the caller. **The query MUST filter
out dry runs** (`r.status =!= "dry_run"`, the exact precedent `deleteOldRunsInternal` already uses two
methods away in this same file) — found at the design gate's first round. Dry runs persist real rows
into `pipeline_run_assertions` (419-B's `onDryRunSuccess` always calls `persistAssertions`, confirmed by
`V84__pipeline_run_assertions.sql`'s own migration comment: "succeeded, failed (partial results), or a
successful dry run"), so without this filter, a user merely *previewing* an assert rule via a dry run
after the last real run would flip a panel's badge to "invalid data" even though the panel's actual
bound, persisted data never changed — directly undermining this ticket's own "closing the trust loop"
purpose. "Latest run" for this method means the latest *non-dry* run.

**6. `PipelineRunService.assertionStatusForDataType(dataTypeId: DataTypeId): Future[AssertionStatusResponse]`**
composes Decision 5's lookup with `listAssertionsByRunInternal`: no latest run → `invalid = false,
failedRuleCount = 0`; otherwise `invalid = <any error-severity, failed result>`,
`failedRuleCount = <count of such results>`.

**7. `DataTypeRoutes.scala`'s new route enforces ACL via the existing `dataTypeService.findById(id,
user)` call** (the same check `/rows` and the bare `GET /:id` already use in this file) before
delegating to Decision 6's service method — mirrors `findLastRunAtByOutputDataTypeId`'s own stated
pattern ("ACL gate is enforced at the [caller] layer") exactly, just with the caller being this route
instead of the panel response assembler.

**8. Frontend: `dataTypesSlice` gains a small `assertionStatusByDataTypeId: Record<string,
{invalid: boolean; failedRuleCount: number} | undefined>` cache and a thunk that fetches once per
distinct `dataTypeId` and is a no-op if already present/in-flight** — `PanelCard.tsx` dispatches the
fetch (keyed by `getDataTypeId(panel)`) on mount/panel-list-change, so N panels bound to the same
DataType share one network request, not N.

**9. Badge styling uses DESIGN.md's existing `--app-warning`/`--app-error` intent tokens** — no new
color values. Placed in the existing `panel-grid-card__footer` row, alongside the established
`panel-grid-card__type-badge`, following that exact chip pattern (span + BEM modifier class) rather than
inventing a new badge component.

**10. `RunHistoryModal.tsx`'s existing per-row expand toggle is broadened, not duplicated.** Today it
only renders (`run.status === "failed" && run.errorLog`). It becomes `(run.status === "failed" &&
run.errorLog) || run.assertions.failures.length > 0` and the expanded body renders both the existing
`errorLog` `<pre>` (when present) and a new failing-rules list (when `assertions.failures` is
non-empty) — one toggle, not two, since both represent "why did/didn't this run go as expected."

## Risks / Trade-offs

- [`history()`'s bounded N+1 (Decision 2)] → acceptable given the existing 10-row retention cap; revisit
  only if that cap itself ever changes.
- [Two backend read surfaces for closely-related data (`history()`'s per-run summary vs. the dedicated
  per-DataType status route)] → deliberate, not accidental: Run History is inherently per-run
  (`AssertionSummary` on `PipelineRunRecord`), while the panel badge is inherently per-DataType
  ("what's true right now") — collapsing them into one shape would force one of the two call sites to
  fetch data it doesn't need.

## Planner Notes

- Self-approved Decisions 3, 4, 5, 7, 8, 9, 10 — each resolves an ambiguity the ticket explicitly left
  open ("determine the cleanest data path... expose a small read... or piggyback"), grounded in the
  actual `PanelResponse`/`PipelineRepository`/`DataTypeRoutes`/DESIGN.md precedent traced in Context, not
  invented from scratch.

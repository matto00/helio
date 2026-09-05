## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Root cause is real and correctly identified (not accepted on faith).** Read
  `backend/src/main/resources/db/migration/V99__prevent_zero_root_pipelines.sql` directly. It
  defines `hel913_prevent_zero_root_pipelines()` (plpgsql, `SECURITY DEFINER`) whose body ends in
  a bare `RAISE EXCEPTION 'HEL-913: this delete would leave pipeline(s) [%] with zero roots ...'`
  — a plpgsql `RAISE`, i.e. SQLSTATE `P0001`, not `23503`. It is attached as
  `AFTER DELETE ON pipeline_roots REFERENCING OLD TABLE AS deleted_roots FOR EACH STATEMENT`, and
  its JOIN only matches pipelines that still exist with zero remaining roots. That is exactly the
  sole-root-cascade signature the probe reports, and exactly why other sources deleted cleanly.
- **FK theory is genuinely refuted, and I did not resurrect it.**
  `grep -rn source_data_source_id backend/.../db/migration/` shows `V98__pipeline_roots.sql:320`
  `ALTER TABLE pipelines DROP COLUMN source_data_source_id;`. So the only remaining data-source
  reference is `pipeline_roots.data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE
  CASCADE` (`V98:~78`). A cascading FK cannot raise `23503` here. The design's premise holds.
- **The 500 path is as described.**
  `DataSourceRepository.delete` (`.../persistence/sources/DataSourceRepository.scala:216-217`) is
  `ctx.withUserContext(user.id.value)(table.filter(_.id === id.value).delete).map(_ > 0)` — no
  error mapping. `DataSourceService.delete` (`.../services/sources/DataSourceService.scala:561+`)
  just `flatMap`s it. The route (`.../api/routes/sources/DataSourceRoutes.scala:89-90`) is
  `ServiceResponse.runNoContent(...)`. Nothing in that chain handles a failed Future → 500. The
  corrected file path in ticket.md is right; the original ticket path was stale.
- **Scope decision is actually implemented, not just asserted.** design.md Decision 1 and
  tasks.md 2.1 both explicitly forbid reusing
  `WorkspaceTeardownRepository.sourceDependentPipelineConflict`. I read that method
  (`WorkspaceTeardownRepository.scala:115-131`): its SQL is
  `JOIN pipeline_roots r ON r.pipeline_id = p.id WHERE r.data_source_id = ... LIMIT 1` — it does
  match ANY referencing pipeline, so the design's warning is accurate and necessary. tasks.md 1.3
  adds a multi-root-deletes-204 control test that would catch an accidental `any-reference`
  implementation. Scope is correctly honored; I did not reopen it.
- **No migration.** The change touches service/route/repository only; tasks.md 5.3 makes
  "`git diff --stat` shows nothing under `db/migration/`" an explicit verification step with an
  escalate-don't-write instruction. Consistent with the shared-dev-Postgres constraint.
- **Red-first discipline.** tasks.md 1.2 requires the 409 test be captured red (as a 500) before
  the fix and the output pasted, per `.concertino/laws/verification-before-completion.md`.
- **AC coverage traced.** AC1 (structured 409) → spec delta scenario 1 + tasks 3.1/4.1; AC2
  (probe-confirmed) → probe.md + task 1.1 re-run; AC3 (regression test red first) → task 1.2;
  AC4 (logged cause, non-leaky body) → Decision 4, task 3.3, spec scenario 4. Spec delta correctly
  extends the existing `openspec/specs/datasource-edit-delete/spec.md` capability.
- **Out-of-scope items respected.** HEL-989 (multi-root silent panel loss) and HEL-974 (RLS-
  independent trigger) are both named as Non-Goals and not folded in.

### Verdict: REFUTE

One blocking defect: the service→route seam for the structured body does not typecheck as
specified, and the design's own cited precedent solves it a different way. This is the exact seam
the spec's wire-shape scenarios depend on, so leaving it two-way-readable will cost an execution
round.

### Change Requests

1. **design.md Decision 3 / tasks.md 3.1 specify an impossible carrier.** Both say the service
   returns `ServiceError.Conflict` "carrying the structured conflict (kind/id/name/reason)". But
   `backend/src/main/scala/com/helio/services/ServiceError.scala:23` is
   `final case class Conflict(message: String)`, and the file's header comment states the variant
   set is "intentionally a small, closed set". Four fields cannot travel in it. Worse, the
   precedent Decision 3 cites — `DashboardAuthoringRoutes.scala:56-62` — does **not** extend
   `ServiceError`; it threads a *wrapper*, `AuthoringError(kind, err, _)`, and calls
   `ServiceResponse.statusCodeFor(err)` on the wrapped `ServiceError`. So the design names one
   mechanism in prose and a structurally different one by reference.
   Pick one explicitly and write it into Decision 3 + task 3.1: either (a) a wrapper result type
   in the sources package carrying the conflict payload alongside a `ServiceError`, mirroring
   `AuthoringError` (and note that `DataSourceService.delete`'s signature changes from
   `Future[Either[ServiceError, Unit]]`, with the route's `runNoContent` replaced by a bespoke
   completion); or (b) a new `ServiceError` variant carrying the four fields — in which case say
   so, and justify widening a deliberately closed set. Do not leave this to the implementer: the
   third reading available today ("stuff all four fields into the `Conflict` message string") is
   the one that silently violates spec scenario 1's field-level body assertions, and it is the
   only reading that satisfies the current text literally.

### Non-blocking notes

- **File deletion precedes the row delete.** `DataSourceService.delete` runs `deleteFileF` (the
  CSV/text/pdf/image backing-file removal) *before* `dataSourceRepo.delete`. tasks.md 3.4 covers
  the pre-check path ("do not delete the backing file for a source whose delete is going to be
  rejected") — good, and it implies the pre-check must sit before `deleteFileF`, which is worth
  saying in those words. It does **not** cover Decision 2's race path: if the pre-check passes and
  the trigger then raises, the file is already gone and the surviving row points at nothing. That
  is pre-existing (the 500 leaves the same wreckage), so it is not a blocker for this ticket, but
  it deserves a sentence in Risks or a spinoff rather than silence.
- **The 409 body has no `message` field.** `TeardownConflictResponse`
  (`api/protocols/workspace/WorkspaceProtocol.scala:13`, `jsonFormat4`) is exactly the four fields,
  and generic clients — the frontend's axios error path and the MCP tool that filed this ticket —
  typically read `error.response.data.message`. They will get `undefined` and render an empty
  reason, which is a milder version of the original complaint. Consider whether `reason` alone is
  enough for the reporting caller, or whether a `message` field should ride along.
- `frontend/src/features/sources/services/dataSourceService.ts:186` (`deleteSource`) does nothing
  with the response body today. Correctly out of scope per the proposal, but the 409 will surface
  to a user through `SourceDetailPanel` as a generic failure until someone renders it.

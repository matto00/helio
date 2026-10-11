## Context

HEL-1469 (archive `openspec/changes/archive/2026-10-10-single-call-create-orphan-source/`) fixed single-call `POST /api/pipelines` with a pure pre-flight (`PipelineCreatePreflight`) plus a compensating delete of call-created inline sources (`PipelineCreateWrites.compensatingInlineSources` -> `DataSourceService.delete`), and patch-set mid-set rollback (`PatchSetApplyRollback.deleteInlineRootSources`). Its Non-Goals list the paths this change closes.

Current code (origin/main bcb0e8919, verified by reading -- see `.concertino/runs/HEL-1475/evidence/premise-validation.md`):

- **addRoot** (`PipelineRootWrites.addRoot`): pipeline lookup -> editor check -> `resolveOneRootSourceId` (an inline root is CREATED and committed here, via `resolveInlineRootSourceId` -> `SourceService.createSql`/`createRest` or `DataSourceService.createStatic`) -> `dataSourceRepo.findByIdOwned` re-lookup -> `pipelineRootRepo.add` (its own `withUserContext` DBIO: pipeline-name `.head`, `PipelineCycleGuard.checkAddReadAction`, insert). Nothing compensates a failure after creation.
  - **The named trigger looks unreachable.** `checkAddReadAction` -> `PipelineCycleValidator.checkNoCycle` searches from each of the pipeline's own write targets to `{newReadSource}` through existing write edges. A freshly-created source has no inbound write edge, so no path can reach it. The leak is real for every OTHER post-creation failure (re-lookup `None`, pipeline deleted concurrently -> `.head` failure, DB error).
- **Implicit Connector** (`SourceService.createRest`, `(None, Some(url))` branch): `connectorRepo.create` (credential row + connector row) BEFORE `createRestWithConfig`'s source insert. `DataSourceService.delete` never touches it. So every existing compensation path (HEL-1469 create, patch-set rollback, `PipelineProposalService.cleanupSource`) leaves the Connector behind. `POST /api/sources` itself also leaves it if the source insert fails.
- **Post-insert failure**: `SourceService.createSql`/`createRestWithConfig` insert, then `CreateSourceEnvelope.build` (`inferSchema`; a `Left` becomes `fetchError` and the source is intentionally KEPT; a `Right` calls `upsertInferredSchema`). A failed Future from `inferSchema` or `upsertInferredSchema` leaves the inserted row, and its id never reaches the caller -- no caller-side compensation can see it.
- **`DataSourceService.createStatic` is NOT a leak (verified, design gate round 1):** it writes the source row, its declared schema and its rows in ONE transaction (`DataSourceRepository.insertDatasetSource` -> `insertDatasetSourceAction`); only a fire-and-forget audit runs afterwards. Out of scope; recorded as "verified not a leak", like the cycle guard.
- **Patch-set undo** (`PatchSetUndoService`, `("pipeline","create") => restoreCreateUndo(... pipelineService.delete ...)`): deletes only the pipeline.
- **`deleteInlineRootSources`**: `request.roots.zip(summaryRoots)` silently truncates on a length mismatch, and silently drops an inline root whose summary entry has no `dataSourceId`.

## Goals / Non-Goals

**Goals:** AC1-AC3, AC5, AC6 of `ticket.md`; each leak path measured red first.

**Non-Goals:**
- **Patch-set undo (path 4)**: a product call (the user may have bound other things to the source since apply). Not decided here; no behaviour change. Follow-up ticket for the owner. Not an assumed product call.
- Crash-atomicity (path 6): documented, not fixed (the one-transaction alternative was rejected in HEL-1469 Decision 2 for the same reasons: cross-service DBIO API and network I/O under an open transaction).
- `DataSourceService.createStatic`: verified one transaction, not a leak (see Context).
- The public `PipelineProposalService.rollback(response, user)` implicit Connector (Decision 1): follow-up.
- The other `DataSourceService` create paths (`createCsv`, `createCsvUrl`, text/pdf/image upload and URL) share the insert -> `upsertInferredSchema` shape (and write a file before the insert) but are not inline-root kinds; follow-up ticket.
- Any change to a success response, an existing error status or message, the API shape, or the schema. No migration.
- Deleting existing orphans in prod (prod data): read-only count query only; cleanup is a follow-up.

## Decisions

### Decision 1 -- One shared cleanup helper that knows about the implicit Connector

Add a small service-layer helper (name at the executor's discretion, e.g. `InlineSourceCleanup`, in `services/sources/`) with one entry point:

`deleteCallCreated(id: DataSourceId, implicitConnector: Boolean, user, context: String): Future[Boolean]`

1. If `implicitConnector`, read the source first (`dataSourceRepo.findByIdOwned`) and capture its `RestSource` config `connectorId` (must be read BEFORE the source is deleted).
2. `DataSourceService.delete(id, user)` (as the user; RLS preserved; HEL-989 reference check kept).
3. Only if step 2 succeeded and a connector id was captured: delete the Connector through the existing guarded path (`ConnectorEntityService.delete` or `ConnectorRepository.delete` with the real `dependentCount`) so a Connector still referenced elsewhere is refused (409) and kept, and its credential row goes with it.
4. Returns `true` only if everything it attempted succeeded. Every failure (Left or exception) is logged with ids and the error message only, and is never thrown -- it must never replace the caller's original error.

`implicitConnector` is decided by the CALLER from the request shape alone: an inline root whose canonical kind is `rest_api` with `restConfig.url` defined and no `connectorId`. That shape always makes `createRest` synthesize a new Connector, so the Connector is call-created by construction; a request naming a `connectorId` never passes `true`, so a user's explicit Connector can never be deleted by this helper.

**Guarded Connector delete, explicitly.** The helper MUST call the dependents-guarded delete with the REAL dependents count (`ConnectorEntityService.delete`, or `ConnectorRepository.delete` passed the same `countRestSourcesReferencing`-based `dependentCount` that `ApiRoutes` wires) -- never a bare `connectorRepo.delete(id, user)`, whose default `dependentCount` is always zero. **Second safeguard:** the Connector is deleted only if its name equals `"Auto: " + <the deleted source's name as read in step 1>` (the exact name `createRest` synthesizes); otherwise log and keep it. **Order:** source first, then Connector (the Connector delete would be refused while the source still references it).

Callers switched to it: `PipelineCreateWrites.deleteInlineSources` (track the flag alongside each created id), new `addRoot` compensation (Decision 2), `PatchSetApplyRollback.deleteInlineRootSources` (flag from `request.roots(i)`), and `PipelineProposalService`'s internal apply-failure cleanup (`rollbackSourceOnly` and every other path that holds a `ResolvedSource`): carry the flag on `ResolvedSource`, set when a `createdByThisCall` REST root's proposal config uses `url` without `connectorId` (`validateRestConfig` accepts `url`).

**Descoped: the public `PipelineProposalService.rollback(response, user)`** (called by `CombinedProposalService` and `FirstRunDashboardService` after a SUCCESSFUL apply, when a later phase fails). It only receives the API response, which cannot carry the flag without an API-protocol change; it keeps today's behaviour (source deleted, implicit Connector may remain) and becomes a follow-up ticket. `FirstRunDashboardService` uses caller-owned CSV sources (no REST), so its exposure is nil today.

The doc comment on the helper states the not-crash-atomic risk (AC6).

*Alternative rejected:* return the implicit Connector id from `createRest` on `CreateSourceResponse`. That is an API protocol type; adding an internal field risks it reaching JSON.

### Decision 2 -- addRoot compensates every post-creation failure

In `addRoot`, after `resolveOneRootSourceId` returns `Right(dsId)` for an inline request (`req.type` defined), run the rest (`findByIdOwned`, `pipelineRootRepo.add`, its `.recover`) under the same compensation shape as HEL-1469's `compensatingInlineSources`: on a `Left` or a failed Future, call the Decision 1 helper, then return the ORIGINAL `Left` or re-raise the ORIGINAL exception. An existing-`sourceId` root never triggers a delete. Reuse (or generalize) `compensatingInlineSources` rather than writing a second copy.

Ordering is unchanged: pipeline lookup and editor check already precede creation, so 404/403 never create anything.

**Cycle guard:** the executor must try to reproduce the ticket's named trigger (an inline root on a pipeline that has an `upsertsource` write target) and record the result. Expected: accepted (201), since no cycle can reach a fresh id -- report "does NOT leak via the cycle guard" with the measured evidence. The post-creation red test uses fault injection on the real route (e.g. a `PipelineRootRepository` subclass whose `add` fails), counting by exact owner id.

### Decision 3 -- Creating services clean up after their own post-insert failure

- `SourceService.createSql` and `createRestWithConfig`: wrap everything after `dataSourceRepo.insert` succeeds in `transformWith`; on `Failure(ex)`, delete the inserted row (repository-level delete under the user's context is enough -- nothing can reference an id that was never returned), then re-raise `ex` unchanged. A `Left` from `inferSchema` stays `fetchError` (success; the source is kept).
- `SourceService.createRest` bare-`url` branch: if anything after `connectorRepo.create` fails (the source insert itself, or the post-insert failure above), also delete the just-created Connector (guarded delete; after the source is gone it has no dependents), then re-raise.
- Cleanup failures are logged (ids + message only) and never replace the original exception.

This also closes the same gap on `POST /api/sources` directly.

### Decision 4 -- deleteInlineRootSources reports what it cannot line up

Replace the silent `zip` truncation. Pairing is positional, so when it cannot be trusted nothing is deleted:
- **Count mismatch** (`summaryRoots.size != request.roots.size`): log a warning (edit index, request root count, summary root count; no source names), delete NOTHING, report the edit `unrecoverable`. (A mispaired position could otherwise delete a source the user already had and then its explicit Connector.)
- **Counts match, but an inline root's summary entry has no string `dataSourceId`**: warn, skip that entry, delete the other inline entries through the Decision 1 helper, report `unrecoverable`.
- Otherwise delete every inline entry through the helper, as today. The pipeline-delete-fails branch is unchanged (no source delete, `unrecoverable`) and gets a test.

### Decision 5 -- Proof

Red on the whole pre-fix tree first, then green; counts are `data_sources` and (for REST bare-url cases) `connectors` rows `WHERE owner_id = <exact test user id>`, before and after, through the real route where the route can reach the failure:

1. addRoot: inline dataset root, `add` fault-injected -> original error, source count unchanged. Plus the cycle-guard reproduction attempt (expected not reachable; record evidence).
2. Implicit Connector: single-call `POST /api/pipelines` with a bare-url REST inline root that fails after creation (a post-creation class from HEL-1469, e.g. Output `fieldMapping` column absent, or the simple path's later unknown root) -> source AND connector counts unchanged. Same for addRoot and patch-set mid-set rollback. A guard case: a REST inline root naming an existing `connectorId` -> that Connector survives compensation.
3. Post-insert failure: `POST /api/sources` (sql and rest) with a fault-injected `upsertInferredSchema` (or `inferSchema` failed Future) -> original error, counts unchanged. A bare-url case where the source insert itself fails -> connector count unchanged. A regression guard: a fetch error still keeps the source.
4. Patch-set: count-mismatch case (warning, NO delete, `unrecoverable`), missing-`dataSourceId` case (warning, others deleted, `unrecoverable`), and pipeline-delete-fails case (no source delete, `unrecoverable`).

REST cases need a local HTTP stub and the test egress overrides existing specs already use; SQL needs whatever existing `SourceService` specs use for an admitted test host. If a case cannot be reached through the real route, prove it at service level with real repositories and say why.

Live probe on the dev server (throwaway user, exact-id cleanup) only where a path is reachable without fault injection; otherwise state that the spec is the evidence.

### Decision 6 -- Prod orphan visibility (read-only)

Provide, for the PR body, a read-only `SELECT count(*)` for (a) implicit Connectors (`name LIKE 'Auto: %'`) with no data source referencing them, and (b) an upper bound of unreferenced inline-root-shaped sources, clearly labelled as an upper bound (an unreferenced source can be intentional). Verify each query runs on the embedded/dev schema. No delete, no migration.

## Risks / Trade-offs

- [Not crash-atomic] -> documented at the helper; unchanged class of risk from HEL-1469.
- [Deleting a Connector] -> only ever one the caller's own request shape guarantees was synthesized by this call, and only through the dependents-guarded delete.
- [`deleteInlineRootSources` now reports `unrecoverable` where it used to report `rolledBack` on a mismatch] -> the old report was false when a source stayed behind.
- [Post-insert cleanup races a concurrent reference] -> impossible for an id never returned to any caller.

## Migration Plan

None. Rollback = revert the commit.

## Context

See proposal.md (Why). Current write ordering in `PipelineService.create` (origin/main 625e1deff):

1. Pure checks: `name`, non-empty `roots`, `tag`.
2. Root resolution, sequential in request order (`resolveRootSourceIds` simple path / `resolveRootDataSources` transactional path) via `resolveOneRootSourceId`. An inline root (`type` present) is **created and committed here** through `SourceService.createSql`/`createRest` or `DataSourceService.createStatic` -- each its own write (sql/rest also do an outbound schema fetch after the insert, `CreateSourceEnvelope.build`).
3. Transactional path only: `resolveStepRootIndex`/`resolveOutputRootIndex` (pure), `validateStepCrossOwnerRefs` (read-only), `resolveSecondarySourceSchemas` + `analyzeNodes` (read-only/pure).
4. One Slick transaction (`pipelineRepo.runTransactionally(user.id)` -> `DbContext.withUserContext`, RLS-enforced): `createAction` -> `buildStepsAction` (duplicate clientId, step type, `parentStepId`, `PipelineStep.rawConfigProblem` 422, decode 400, lane forward-ref) -> `buildOutputsAction` (name, `OutputKind`, `nodeStepClientId`, `OutputConfigValidation`/`OutputCompare`/`PayloadOptIn`, `fieldMapping` slot + column existence).
   Simple path instead: `pipelineRepo.create` (may `Left` with 404/400).

Every failure in 3-4 (and a later root's failure in 2) leaves step 2's inline sources committed. Root cause confirmed by reading; red tests will measure it.

Patch-set: `PatchSetApplyResolvers.resolvePipelineCreate` pre-checks roots + `rawConfigProblem` only; `PatchSetApplyForward` then calls `pipelineService.create`, inheriting the leak for every other class.

## Goals / Non-Goals

**Goals:** no data source created by a single-call create survives a 4xx/5xx response from that call; request-only failure classes create nothing at all; patch-set pipeline-create pre-flights the same request-only checks.

**Non-Goals:**
- Moving inline source creation into the pipeline's Slick transaction (see Decision 2).
- `POST /api/pipelines/:id/roots` (`addRoot`) with an inline root that then fails (cycle guard) -- same family, separate endpoint; reported as a follow-up candidate, not fixed here.
- Bare-`url` inline `rest_api` root's implicit "Auto: <name>" Connector (+ credential write, `SourceService.scala:119-170`): `DataSourceService.delete` does not remove it, so Decision 2's compensation for a POST-creation failure leaves that Connector behind. None of the request-only classes (the observed incident and all three AC classes) reach creation any more, so only the residual post-creation classes with that specific root shape are affected. Follow-up candidate (needs a connector-ownership/reference decision of its own).
- `SourceService.createSql`/`createRest` returning a failed Future AFTER their own `dataSourceRepo.insert` committed (schema fetch/upsert failure): the id never reaches the caller, so no caller-side compensation can see it. Pre-existing in `SourceService` itself and equally reachable via `POST /api/sources`; follow-up candidate, not fixed here.
- Patch-set UNDO of a successfully-applied pipeline create (`PatchSetUndoService` `restoreCreateUndo` deletes only the pipeline): whether undo should also remove an inline source the apply created is a product question (the user may have bound other things to it since); follow-up candidate. Mid-set ROLLBACK (same apply call) IS fixed here -- Decision 3a.
- HEL-1441 items 1-2 (undo/V118). Item 3 is answered (single-call create already applies HEL-1313 key validation); not absorbed.
- Changing any status code or error message of an existing single-error failure class on the direct `POST /api/pipelines` route. (The patch-set apply/preview change in Decision 3 is deliberate and stated there.)

## Decisions

### Decision 1 -- Validate-first: a pure request pre-flight before any write

Extract a pure function (companion-level, so `PatchSetApplyResolvers` can call it) that runs every check needing only the request (root SHAPE checks live in root pass (a) -- the "Exact sequence" below is authoritative on ordering): step root indices, Output root indices, and -- in request order, steps then Outputs, same messages and status codes as today's in-transaction checks -- duplicate clientId, step type, `parentStepId` resolvable to an earlier clientId, `rawConfigProblem` (422), decode (400), lane forward reference (400); Output `nodeStepClientId` resolvable, blank name, `OutputKind`, and config-only Output validation (`OutputConfigValidation.validate`, `OutputCompare.validateConfig`, `PayloadOptIn.validateConfig`). The schema-dependent `fieldMapping` slot/column checks stay where they are (need the node schema).

The in-transaction checks are **kept unchanged** as defense in depth (the transaction path must stay self-consistent if a future caller bypasses the pre-flight); the pre-flight must reuse the same helpers so the two cannot diverge in message or status. Executor may factor shared per-step/per-Output check functions used by both.

**Lane-check ordering (C4).** Today `validateStepCrossOwnerRefs.validateLane` runs the request-scoped lane checks for EVERY step (exists-in-request -> 422 "Lane reference '<id>' does not exist in this request", self -> 400, ancestor -> 400) before `buildStepsAction`'s forward-lane-reference 400 ever runs. The pre-flight preserves that: pass 1 runs the pure lane checks for every step (same helper, same messages/statuses), pass 2 runs the per-step `buildStepsAction`-shaped checks (incl. forward reference) in request order, then Outputs. The ownership half of `validateStepCrossOwnerRefs` (read-only lookups of join/union/lookup right-sources) still runs after the pre-flight and before inline creation.

Then reorder root resolution into two passes: (a) existing-`sourceId` roots ownership-checked read-only, in request order, plus the pure inline-spec checks; (b) only after (a), the pre-flight, and `validateStepCrossOwnerRefs` pass, create inline sources.

**Exact sequence (both paths):**
1. Pure top-level checks (unchanged): `name`, non-empty `roots`, `tag`.
2. Root pass (a), request order, read-only: per root, shape checks (sourceId/type exclusivity, blank sourceId 400, inline `name`/config presence, recognized/supported inline kind incl. csv 422), and for an existing `sourceId` the ownership lookup (404). No writes.
3. Transactional path only -- request pre-flight (pure): step root indices, Output root indices, lane pass 1 (every step), step pass 2 (request order), Output checks (request order).
4. Transactional path only -- ownership half of `validateStepCrossOwnerRefs` (read-only).
5. Root pass (b): create inline sources in request order, tracking ids. From here on every failure triggers Decision 2's compensation.
6. Transactional path: `findByIdOwned` re-lookups of created inline ids, `resolveSecondarySourceSchemas`/`analyzeNodes`, the transaction. Simple path: `pipelineRepo.create`.

Root shape/ownership errors therefore still precede step/Output errors (so an unknown root plus a refused step config still returns today's 404).

*Alternative rejected:* pre-flight alone. It cannot cover schema-dependent `fieldMapping` column checks against an inline sql/rest source (schema known only after the source's own fetch), the cycle guard, DB errors, or a later inline root's creation failing -- the AC demands "any 4xx/5xx".

### Decision 2 -- Compensating delete of call-created inline sources for every post-creation failure

**Relation to the HEL-906 ruling.** `PipelineService.create`'s doc records that HEL-906's coordinator ruled out create-then-compensate (cycle 4) in favour of one composed `DBIO` transaction. That ruling covered the pipeline, root, step and Output rows -- rows proven to compose into one `.transactionally` under `withUserContext`. It did not cover inline sources, which (as shown in the rejected alternative below) cannot join that transaction without a new cross-service API and network I/O under an open transaction. The pipeline/step/Output rows stay fully transactional, unchanged; compensation applies only to the inline source rows created outside it. Both docstrings this makes untrue are updated (the `create` doc's "ONE Slick transaction ... not a create-then-compensate delete" narrative gains the inline-source exception; `resolveOneRootSourceId`'s "no ... undo step to track" note is corrected).

**Failed Futures.** Cleanup runs on a `Left` AND on a failed Future (`recoverWith`) of every post-creation call (`findByIdOwned` re-lookup, `resolveSecondarySourceSchemas`, the simple path's `pipelineRepo.create`, the transaction). For a failed Future the ORIGINAL exception is re-raised after cleanup (never swallowed or converted to a different error); for a `Left` the original `Left` is returned.

Track the ids of inline sources created in pass (b). If any subsequent step returns `Left` or fails (later inline root creation, `findByIdOwned` re-lookup, `resolveSecondarySourceSchemas`, the transaction's `PipelineCreateValidationFailure`/cycle/DB error, the simple path's `pipelineRepo.create` `Left`, or any unexpected exception), delete each created id via `DataSourceService.delete(id, user)` -- the same path and precedent as `PipelineProposalService.cleanupSource` (HEL-989) -- **before** returning the original error. Cleanup failure is logged (source id + error message only) and never replaces the original error. Runs as the user (RLS preserved); the pipeline never committed, so the source has no root reference and the HEL-989 409 refusal cannot fire.

*Alternative rejected:* one transaction spanning source creation. Inline source creation is owned by `SourceService`/`DataSourceService` as `Future` APIs with an outbound HTTP/SQL schema fetch after the insert; folding it into the pipeline's `DBIO` needs a new cross-service `DBIO` source-insert API and would hold a DB transaction (and connection, under `withUserContext`) open across network I/O. That is exactly the "cross-service transaction that doesn't exist yet" the driver said to escalate; Decision 1 + 2 meets the AC without it, so it is not pursued. If the design gate judges compensation insufficient, that becomes an escalation, not a silent choice.

### Decision 3 -- Patch-set resolve reuses the pre-flight (deliberate behavior change on the patch-set path)

`resolvePipelineCreate` replaces its local `rawConfigProblem` loop with the shared pre-flight (prefixing `edit $index: ` as today), so unknown step type and bad Output config are refused at resolve time with nothing applied. **This intentionally changes the patch-set surface:** today such an edit resolves, then fails at forward apply, reported as HTTP 200 with a `failure` (`PatchSetApplyService.scala:126-129`); and PREVIEW (which shares `resolveAll`) returns a 200 projection for it. After this change both apply and preview refuse it with the 4xx of its class and an `edit N: ` prefix -- the same move HEL-1402 already made for refused step configs on this exact resolver ("surfaced at resolve time (422, nothing applied) ... instead of a forward-apply failure reported as HTTP 200"). C4 covers the direct route only; this change is stated and tested (tasks 1.2, 1.4). Apply-time failures are covered by Decision 2 inside `pipelineService.create`.

### Decision 3a -- Patch-set mid-set rollback also removes the inline sources

`PatchSetApplyRollback`'s `ResolvedAction.PipelineCreate` branch deletes only the pipeline, so a successful inline-root pipeline-create edit followed by a failing LATER edit in the same apply call orphans the source while reporting the edit `rolledBack`. After the pipeline delete succeeds, also delete (via `DataSourceService.delete(id, user)`) each root source whose request root was inline (`type` defined), identified by position from the forward outcome's `resultingState` summary `roots` (request order; `pipelineRepo.createAction` preserves it). If the pipeline delete itself fails, NO source delete is attempted (the source is still referenced; the edit is `unrecoverable` as today). A source delete failure marks the edit `unrecoverable` and is logged, matching the existing branch's convention.

### Decision 4 -- Proof

Embedded-Postgres route specs through the real `POST /api/pipelines` route, inline `dataset` root, counting `data_sources` rows `WHERE owner_id = <exact test user id>` before/after: one per failure class (step config 422, unknown step type 400, Output config 400), plus the post-creation class (`fieldMapping` column absent, 400 -- exercises Decision 2), plus multi-root (root 0 inline, root 1 unknown sourceId -> 404) on BOTH the simple path (no steps/outputs; today root 0 commits then `pipelineRepo.create` 404s) and the transactional path, plus lane-check regressions with an inline root (nonexistent lane ref still 422 with today's message; self-reference still today's 400), plus a service-level failed-Future case (stub repo whose post-creation call throws: source deleted, original exception re-raised), plus the patch-set apply path (resolve-time refusal) and mid-set rollback. Patch-set specs must wire `PipelineService` with real `sourceService`/`dataSourceService` (as `PipelineRootRoutesSpec` does) or the inline branch returns InternalError and nothing is ever red. Each must be measured red on the whole pre-fix tree first. A live probe on the dev server with a throwaway user (count via `GET /api/data-sources`, before/after; clean up by exact id) reproduces the original incident red-first and green after.

## Risks / Trade-offs

- [Compensation is not crash-atomic: a process death between inline source creation and the compensating delete leaves an orphan] -> request-only classes (the observed incident and all three named AC classes) never create anything (Decision 1); the residual window is only for post-creation failures and is logged. Stated, not hidden.
- [Lane checks for every step now run before the cross-owner ownership lookups of any step: an unowned join right-source (404) in step 1 plus a nonexistent lane reference (422) in step 2 reports 422 instead of 404] -> multi-error precedence only.
- [Error precedence shift: a request with both a bad inline root that would fail to create AND a bad step now reports the step error; likewise an unowned join right-source (404) in one step plus a refused config (422) in a later step now reports 422 instead of 404] -> no existing contract on cross-class precedence; root shape/ownership errors still precede step errors, and single-class requests are unchanged (C4).
- [Duplicate checks (pre-flight + in-transaction) diverging] -> both call the same helper functions; a spec asserts identical status/message for a class via both entry points.
- [Delete side effects: `DataSourceService.delete` writes an audit `data_source.delete` row; a `data_source.create` audit row from creation remains] -> acceptable and truthful audit trail.

## Migration Plan

None (no schema change). Rollback = revert the commit.

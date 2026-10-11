# HEL-1475 red evidence (pre-fix tree)

Measured on the whole pre-fix tree: `git status` showed only the four new spec files (no production file touched).
Command: `cd backend && nice -n 19 sbt "testOnly <the four specs>"`. Raw logs (kept out of the repo):
`/home/matt/Development/helio/.concertino/runs/HEL-1475/HEL-1475-red-run.log` (all four specs, `[hel1468-guard] ScalaTest summary: failed=12`)
and `...-red-run2.log` (the routes spec re-run after fixing two test-side `::uuid` casts). Both logs contain `[hel1468-guard]`.
Counts are `SELECT count(*) ... WHERE owner_id = <exact test owner id>`; "actual vs expected" is as ScalaTest printed it.

| Path | Spec / case | Pre-fix result | Reading |
|---|---|---|---|
| 1 addRoot | `InlineSourceLeakPathsRoutesSpec` "leave no data source when the root insert fails..." (500, `PipelineRootRepository.add` fault-injected) | RED: `data_sources` 2 vs expected 1 | inline source survives |
| 1 addRoot, cycle guard | same spec "NOT hit the cycle guard for a fresh inline source ... (201)" | GREEN (201, +1 source, 2 roots) | The ticket's named trigger is NOT reachable: `checkNoCycle` searches from the pipeline's write targets to the NEW read source through existing write edges; a fresh id has no inbound edge. Not a leak. |
| 2 single-call create | "be removed with its source when single-call create fails..." (400, bare-url REST root, Output fieldMapping column absent) | RED on `connectors`: 1 vs expected 0 (`data_sources` already clean, HEL-1469) | implicit "Auto:" Connector survives |
| 2 addRoot | "...when addRoot fails after the root was created (500)" | RED on `data_sources`: 7 vs 6 (Connector assertion not reached) | |
| 2 patch-set mid-set rollback | `PatchSetInlineRootRollbackSpec` "remove the implicit Connector with the source" | RED on `connectors`: 1 vs expected 0 (`data_sources` already clean: the pre-fix rollback deletes the source) | Connector survives |
| 2 production wiring | `InlineSourceLeakApiRoutesWiringSpec` (POST /api/pipelines through `ApiRoutes`) | RED on `connectors`: 1 vs 0 | proves the production `ApiRoutes` wiring, not only test wiring |
| 2 guard | explicit `connectorId` inline root compensated | GREEN pre-fix | the named Connector is never touched |
| 2 dependents | "keep the Auto Connector when a second source references it..." | RED on `data_sources` (addRoot never compensated): 10 vs 9; the Connector assertion is only meaningful once the fix lands | |
| 3 createSql | `SourceCreatePostInsertCleanupSpec` "createSql when the schema write fails" | RED: `data_sources` 1 vs 0; original `IllegalStateException` surfaced | |
| 3 createRest bare-url, schema write fails | same spec | RED: `data_sources` 2 vs 1 | |
| 3 createRest bare-url, insert fails | same spec | RED: `connectors` 2 vs 1 | Connector created before the insert |
| 3 guard | "a schema-fetch error still be a success that keeps the source, for REST and SQL" | GREEN pre-fix | fetch error stays a success |
| 5 count mismatch | `PatchSetInlineRootRollbackSpec` | RED: status `rolledBack` vs expected `unrecoverable` | `zip` truncates silently |
| 5 missing dataSourceId | same | RED: `rolledBack` vs `unrecoverable` | silently skipped |
| 5 pipeline-delete-fails | same | GREEN pre-fix (guard; branch was untested) | no source delete, `unrecoverable` |
| 5 lined-up rollback | same | GREEN pre-fix (guard) | |

## Verified NOT leaks

- **addRoot via the cycle guard**: see the GREEN row above. `PipelineCycleValidator.checkNoCycle` needs a path from one of the pipeline's own write targets to the new read source through existing write edges; a source created seconds ago has none.
- **`DataSourceService.createStatic`**: `createStatic` -> `DataSourceRepository.insertDatasetSource` -> `ctx.withUserContext(...)(insertDatasetSourceAction(...))`, which composes the source insert, the row inserts and the declared-schema update into ONE Slick action (one transaction). Only a fire-and-forget audit runs after it. Verified by reading `DataSourceRepository.scala` lines 322-354 and `DataSourceService.createStatic`; no post-insert failure window.

## Cycle 2 (evaluation-1.md change requests)

- **Pipeline-delete-fails guard made failable.** The test now deletes the real pipeline first (so the inline source is unreferenced and an attempted
  source delete WOULD drop the count), then rolls back with that id; the rollback's pipeline delete returns not-found. Mutation: at
  `PatchSetApplyRollback.scala` the `Left(err)` branch of the pipeline delete was changed to also call `deleteInlineRootSources` (still returning
  `unrecoverable`). Result: `PatchSetInlineRootRollbackSpec` guard FAILED, `3 was not equal to 4` (log `HEL-1475-c2-mutation.log`; unmutated run
  `HEL-1475-c2-green.log`, 10/10, `[hel1468-guard] failed=0`). The mutation was reverted.
- **Route-level `POST /sources`** (sql body, and REST body naming an explicit `connectorId`) over the fault-injected repository, sealed `SourceRoutes`,
  expects 500 and an unchanged `data_sources` count. With the post-insert cleanup neutralized in `SourceService` (pre-fix behaviour) it is RED:
  `6 was not equal to 4` (log `HEL-1475-c2-route-red.log`).
- **Why the `connectors` clause is service-level only:** `SourceRoutes` answers a bare-`url` REST create with 400 (HEL-828) before reaching
  `SourceService.createRest`, so no implicit Connector is ever created via `POST /api/sources`. The bare-url Connector clauses are proven on
  `SourceService.createRest` directly (internal callers: inline pipeline roots, proposal apply). The spec scenario was reworded accordingly.
- Non-blocking: the addRoot 500 body is the framework's generic sealed response, so the original exception message is not observable through the route;
  the service-level specs already assert the original exception message (`boom: ...`) is re-raised.

## Cycle 3 (skeptic-final-1.md change requests)

- **Proposal-apply implicit-Connector cleanup** (`PipelineProposalImplicitConnectorCleanupSpec`, no fault injection): `PipelineProposalService.apply` with
  a bare-url `rest_api` first root and a second root naming a non-existent `sourceId` (NotFound, rollback in `resolveAllRoots`); counts of
  `data_sources` and `connectors` by exact owner id unchanged. Mutation: `implicitConnector = cfg.url.isDefined && cfg.connectorId.isEmpty` forced to
  `false` in `resolveRestSource` -> RED, `1 was not equal to 0` on the `connectors` count (log `HEL-1475-c3-mutation.log`); unmutated GREEN
  (`HEL-1475-c3-green.log`). Mutation reverted.
- `prod-count-queries.md` query (a) relabelled as an upper bound with mixed causes (ordinary source deletes leave `Auto:` Connectors too).
- `SourceService.createRest`: the call after `connectorRepo.create` is wrapped in `Future.unit.flatMap`, so a synchronous throw there still triggers the Connector cleanup.

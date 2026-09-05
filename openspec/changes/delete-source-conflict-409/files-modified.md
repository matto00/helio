- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala` — added `soleRootDependentPipelines`, a sole-root-only dependent query (task 2)
- `backend/src/main/scala/com/helio/services/sources/DataSourceDeleteError.scala` — new file: `DataSourceDeleteError`/`DataSourceDeleteConflict` wrapper carrier (design Decision 3, mirrors `AuthoringError`)
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — `delete` now returns `Future[Either[DataSourceDeleteError, Unit]]`; pre-check runs before `deleteFileF`; defensive `P0001` mapping for the race path (task 3)
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` — added `DataSourceDeleteConflictResponse` (4 teardown-compatible fields + `message`) and its JSON format (task 4.2)
- `backend/src/main/scala/com/helio/api/package.scala` — re-export alias for `DataSourceDeleteConflictResponse`, matching the existing per-type alias pattern
- `backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala` — replaced `ServiceResponse.runNoContent` with a bespoke `completeDelete`, mirroring `DashboardAuthoringRoutes.completeAuthoring` (task 4.1)
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoService.scala` — caller update: unwrap `.err` at the `dataSourceService.delete` call site
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyForward.scala` — caller update: unwrap `.err`
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyRollback.scala` — caller update: `err.err.message` instead of `err.message`
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala` — new DELETE tests: 409 sole-root conflict (field-level body assertion), 204 multi-root control, 204 unreferenced-source control; seeding helpers mirroring `V99PreventZeroRootPipelinesMigrationSpec`

Note: `PipelineProposalService.rollback`/`rollbackSourceOnly` call `dataSourceService.delete(...).map(_ => ())`, discarding the Either entirely — no source change needed there; verified they still compile against the new return type.

## Cycle 2 (evaluation-1.md CR1/CR2)

- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — `soleRootConflict` now emits `resourceKind = "data_source"` with the SOURCE's own `id`/`name` (was `"pipeline"` with the pipeline's id/name), matching `specs/datasource-edit-delete/spec.md` and the `WorkspaceTeardownRepository` precedent; the blocking pipeline(s) are named only in `reason`/`message`. Fixes CR1. The race path (CR2) now falls out consistent automatically — both call sites pass the same `source`, so `resourceId`/`resourceName` are the source's identity on every path, never a pipeline id mislabeled under `resourceKind = "pipeline"`. Also took the non-blocking double-blank-line cleanup.
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala` — `soleRootDependentPipelines` now returns `Vector[BlockingPipeline]` (new named-field case class) instead of a positional `Vector[(String, String)]` (non-blocking suggestion).
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala` — 409 test's field-level assertions updated to `resourceKind = "data_source"`, `resourceId = sourceId`, `resourceName = "Sole Root Source"`, with the pipeline name still asserted via `reason`.

No settled constraint changed: sole-root-only scope, the `DataSourceDeleteError` wrapper carrier, the `P0001`+signature match, no migration, and the pre-check-before-`deleteFileF` ordering are all untouched.

## Root cause / probe (systematic-debugging.md)

- **Root cause:** `DataSourceService.delete` (service layer) issued a bare `dataSourceRepo.delete` with no error mapping; when the target source is a pipeline's sole root, `V99__prevent_zero_root_pipelines.sql`'s `hel913_prevent_zero_root_pipelines_trigger` raises a plpgsql exception (SQLSTATE `P0001`), which escaped as a raw `PSQLException` through `ServiceResponse.runNoContent` as a bare 500.
- **Probe:** re-ran `V99PreventZeroRootPipelinesMigrationSpec` (`sbt testOnly com.helio.infrastructure.persistence.V99PreventZeroRootPipelinesMigrationSpec`) against a fresh embedded Postgres on this branch, and separately captured the RED `DataSourceRoutesSpec` run (task 1.2) before writing any fix code.
- **Probe output:** `V99PreventZeroRootPipelinesMigrationSpec` — all 4 cases pass, confirming the trigger still raises P0001/"HEL-913"/"zero roots" for the sole-root delete and is silent for the multi-root/whole-pipeline/last-direct-root cases. `DataSourceRoutesSpec`'s new 409 test failed pre-fix with `500 Internal Server Error was not equal to 409 Conflict` — see `evidence/red-before-fix.txt`.

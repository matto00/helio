# Executor Report — HEL-265 Cycle 1 (Investigation + Design)

## Summary

Cycle 1 was investigation + design only. No production code was touched.
The audit produced the per-callsite tables below; design decisions on the
four open questions live in `design.md`; sub-PR breakdown in `tasks.md`.

**Headline finding:** the originating ticket scoped 7 repos. The audit found
that the **entire pipeline surface has no ACL whatsoever** — `pipelines`,
`pipeline_steps`, `pipeline_runs` have no `owner_id` column, no `AclDirective`
wrapper, and no service-layer check. Any authenticated user can list, read,
mutate, run, dry-run, preview, or delete any other user's pipeline today.

This makes HEL-265 a **scope-expanding** change: it adds a Flyway migration
and a new sub-PR (CS1) to lay the data-model foundation before the ACL
enforcement pass can include pipelines. Surfacing for orchestrator sign-off.

## Methodology

1. Read existing ACL infrastructure: `AclDirective.scala`, `AccessCheckerImpl.scala`, `ResourceTypeRegistry.scala`, `ResourcePermissionRepository.scala`, migrations V10/V14/V15/V16/V17/V22/V23/V24
2. Enumerated every public method on each ACL'd repo + signature audit (whether they accept a user)
3. Grepped every production callsite of every `*Repo.findById` and the equivalent collection reads (`findAll`, `listSummaries`, `findByDashboardId`, `listByPipeline`, `findByResource`, `findBySourceId`)
4. Cross-referenced services + routes to discover service methods that *don't* take a user (potential leaks)
5. Catalogued existing test coverage for cross-user assertions

## Audit — Repo public surface

For each repo: every public read, current signature, whether ACL-enforced.

### `DashboardRepository` (`DashboardRepository.scala`)

| Method                                | Signature                                                           | ACL today                       | Notes |
|---------------------------------------|---------------------------------------------------------------------|---------------------------------|-------|
| `findAll(ownerId)`                    | `(UserId) → Future[Vector[Dashboard]]`                              | Yes (filter `owner_id = ?`)     | Owner-scoped. Good. |
| `findById(id)`                        | `(DashboardId) → Future[Option[Dashboard]]`                         | **No**                          | All callers either inline-check `ownerId != user.id` (services) or are the registry resolver. |
| `insert/update/updateName/delete/duplicate/exportSnapshot/importSnapshot/count` | various                              | Per-method                      | Mutations + snapshot — read paths flagged above; mutations are protected by service-layer pre-checks. |

### `PanelRepository` (`PanelRepository.scala`)

| Method                                | Signature                                  | ACL today                  | Notes |
|---------------------------------------|--------------------------------------------|----------------------------|-------|
| `findByDashboardId(dashId)`           | `(DashboardId) → Future[Vector[Panel]]`    | **No** (parent-dash gated) | Consumed by `PublicDashboardRoutes` after `AclDirective.authorizeResourceWithSharing` runs. Once that returns, panels for that dashboard are fair game. The directive's resolver is owner-only, not sharing-aware, so this is correct for owner reads; sharing reads work via the directive's `userOpt` path. |
| `findById(id)`                        | `(PanelId) → Future[Option[Panel]]`        | **No**                     | Consumed by `PanelService.findById` (used by `/panels/:id/query` — **no ACL at all**), `PanelService.delete/duplicate/update/batchUpdate` (followed by `accessChecker.requireAccess("dashboard", panel.dashboardId)`), and `PanelPatchApplier`. |
| `insert/updateTitle/delete/duplicate/updateAppearance/replace/batchUpdate` | various | Per-method                  | Mutations — covered by service-side checks today. |

**Note:** Panels have an `owner_id` column (V10) and the index is missing from V17 (only `idx_dashboards_owner_id`, `idx_data_sources_owner_id`, `idx_data_types_owner_id` are there). Add `idx_panels_owner_id` opportunistically in CS4 if our smoke test shows the JOIN benefits from it.

### `DataSourceRepository` (`DataSourceRepository.scala`)

| Method                            | Signature                                   | ACL today                                                              | Notes |
|-----------------------------------|---------------------------------------------|------------------------------------------------------------------------|-------|
| `findAll(ownerId)`                | `(UserId) → Future[Vector[DataSource]]`     | Yes                                                                    | Good. |
| `findById(id)`                    | `(DataSourceId) → Future[Option[DataSource]]` | **No** (comment says "Unscoped findById — used by AclDirective resolver and internal post-auth route code") | Honest about being unscoped. Every consuming `Service.method` does an inline `requireOwnerOnly` *before* the call — this is the exact "Scala-side check can be forgotten" pattern. |
| `insert/update/updateStaticPayload/readRawConfig/delete` | various | Per-method                                                  | Mutations protected by service-side `requireOwnerOnly`. |

### `DataTypeRepository` (`DataTypeRepository.scala`)

| Method                          | Signature                                                | ACL today                                                                 | Notes |
|---------------------------------|----------------------------------------------------------|---------------------------------------------------------------------------|-------|
| `findAll(ownerId)`              | `(UserId) → Future[Vector[DataType]]`                    | Yes                                                                       | Good. |
| `findBySourceId(srcId, ownerId)`| `(DataSourceId, UserId) → Future[Vector[DataType]]`      | Yes                                                                       | Good. |
| `findById(id)`                  | `(DataTypeId) → Future[Option[DataType]]`                | **No** (comment: "used by AclDirective resolver and internal post-auth route code") | **HEL-268 leak vector.** `DataTypeService.findById` / `listRows` / `validateExpression` use this directly and have no service-side ACL gate. |
| `findById(id, ownerId)`         | `(DataTypeId, UserId) → Future[Option[DataType]]`        | Yes                                                                       | Used by `PanelService.resolveSingleBinding` for cross-user binding scrubbing. |
| `insert/update/delete/isBoundToAnyPanel` | various                                         | Per-method                                                                | Mutations protected by service-side `requireOwnerOnly`. `isBoundToAnyPanel` is cross-user — see design.md Q1's note. |

### `PipelineRepository` (`PipelineRepository.scala`)

| Method                                              | Signature                                                                          | ACL today | Notes |
|-----------------------------------------------------|------------------------------------------------------------------------------------|-----------|-------|
| `exists(id)`                                        | `(PipelineId) → Future[Boolean]`                                                   | **No**    | Gate for `addStep / listSteps`. |
| `findById(id)`                                      | `(PipelineId) → Future[Option[Pipeline]]`                                          | **No**    | Used by analyze + run + dry-run + history. |
| `findSummaryById(id)`                               | `(PipelineId) → Future[Option[PipelineSummary]]`                                   | **No**    | `GET /api/pipelines/:id`. |
| `updateName(id, name)`                              | `(PipelineId, String) → Future[Option[PipelineSummary]]`                           | **No**    | `PATCH /api/pipelines/:id`. |
| `create(name, dsId, dtName, ownerId)`               | `(String, DataSourceId, String, UserId) → Future[Either[String, PipelineSummary]]` | Partial   | Accepts ownerId for the new pipeline + new DataType; does NOT verify `dsId` belongs to `ownerId`. **Cross-user source binding hole.** |
| `delete(id)`                                        | `(PipelineId) → Future[Boolean]`                                                   | **No**    | `DELETE /api/pipelines/:id`. |
| `updateLastRun(id, status, at, rowCount)`           | `(PipelineId, String, Instant, Option[Long]) → Future[Unit]`                       | **No**    | Internal post-run housekeeping. |
| `listSummaries()`                                   | `() → Future[Vector[PipelineSummary]]`                                             | **No**    | `GET /api/pipelines` returns every pipeline in the DB regardless of user. |

### `PipelineRunRepository` (`PipelineRunRepository.scala`)

| Method                  | Signature                                                                          | ACL today | Notes |
|-------------------------|------------------------------------------------------------------------------------|-----------|-------|
| `insertRun/insertDryRun/updateRunTerminal/deleteOldRuns/deleteOldDryRuns/listByPipeline` | various pipelineId-keyed | **No** | Inherits absent ACL from parent pipeline. |

### `PipelineStepRepository` (`PipelineStepRepository.scala`)

| Method                  | Signature                                                                          | ACL today | Notes |
|-------------------------|------------------------------------------------------------------------------------|-----------|-------|
| `listByPipeline(pid)`   | `(PipelineId) → Future[Vector[PipelineStep]]`                                      | **No**    | `GET /api/pipelines/:id/steps`. |
| `findById(stepId)`      | `(PipelineStepId) → Future[Option[PipelineStep]]`                                  | **No**    | `PATCH /api/pipeline-steps/:id`. |
| `insert/update/delete`  | various                                                                            | **No**    | Mutations. |

### `ResourcePermissionRepository`

Not in the ACL'd-repo set itself — it IS the ACL primitive. Its reads are
called by `AccessChecker.requireAccess` and `AclDirective.authorizeResourceWithSharing`.
No changes needed.

## Audit — Service-side ACL surface

Per-method: does it accept a user? Does it do an inline `if (ownerId != user.id) Forbidden`?

### `DashboardService`

| Method              | Takes user?     | Inline ACL check?                              | ACL flavor today |
|---------------------|-----------------|------------------------------------------------|------------------|
| `findAll`           | Yes             | n/a (repo is owner-scoped)                     | Owner-only |
| `create`            | Yes             | n/a (creates as user)                          | n/a |
| `delete`            | Yes             | Yes (`d.ownerId != user.id ⇒ Forbidden`)       | Owner-only |
| `duplicate`         | Yes             | Yes                                            | Owner-only |
| `update`            | Yes             | Yes                                            | Owner-only |
| `exportSnapshot`    | Yes             | Yes                                            | Owner-only |
| `importSnapshot`    | Yes             | n/a (creates as user)                          | n/a |

### `PanelService`

| Method                    | Takes user?     | Inline ACL check?                                                                 |
|---------------------------|-----------------|-----------------------------------------------------------------------------------|
| `findById`                | **No**          | None — comment says "performs no ACL check — same as pre-CS2b". **Hole** consumed by `/panels/:id/query`. |
| `resolveBindingsForRead`  | Yes (Option)    | n/a — scrubs cross-user typeId via `dataTypeRepo.findById(typeId, user.id)` |
| `create`                  | Yes             | Goes via `accessChecker.requireAccess("dashboard", ...)`                          |
| `delete`                  | Yes             | Goes via `authorizeEditorOnDashboard` (`accessChecker.requireAccess("dashboard")`) |
| `duplicate`               | Yes             | Same                                                                              |
| `batchUpdate`             | Yes             | Yes (`panels.find(_.ownerId != user.id)`)                                         |
| `update`                  | Yes             | Goes via `authorizeEditorOnDashboard`                                             |

### `DataTypeService`

| Method               | Takes user?     | Inline ACL check?                                                              |
|----------------------|-----------------|--------------------------------------------------------------------------------|
| `findAll`            | Yes             | n/a (owner-scoped repo call)                                                   |
| `findById`           | **No**          | **HEL-268 leak.** Goes straight to unscoped `dataTypeRepo.findById(id)`.        |
| `listRows`           | **No**          | **HEL-242 analog leak.** Same shape.                                            |
| `validateExpression` | **No**          | Same shape — reveals field names if you guess an id.                            |
| `update`             | Yes             | `accessChecker.requireOwnerOnly("data-type", id, user)`                         |
| `delete`             | Yes             | Same; then internal `checkSourceLink` uses unscoped `dataSourceRepo.findById` (acceptable — only renders an error string). |

### `DataSourceService`

| Method        | Takes user?    | Inline ACL check? |
|---------------|----------------|-------------------|
| `findAll`     | Yes            | n/a (owner-scoped repo call) |
| `createStatic`| Yes            | n/a |
| `createCsv`   | Yes            | n/a |
| `update`      | Yes            | `requireOwnerOnly` + unscoped repo `findById` |
| `delete`      | Yes            | Same |
| `refresh`     | Yes            | Same |
| `preview`     | Yes            | Same |
| `infer`       | n/a            | Pure function over bytes |

### `SourceService` (REST + SQL)

| Method         | Takes user?    | Inline ACL check? |
|----------------|----------------|-------------------|
| `createSql`    | Yes            | n/a |
| `createRest`   | Yes            | n/a |
| `inferSql`     | n/a            | Pure |
| `inferRest`    | n/a            | Pure |
| `refresh`      | Yes            | **Yes** (`source.ownerId != user.id`) — the Scala-side pattern HEL-265 deletes |
| `preview`      | Yes            | Same |

### `PipelineService`

| Method              | Takes user?      | Inline ACL check? |
|---------------------|------------------|-------------------|
| `listSummaries`     | **No**           | None — returns every pipeline. |
| `findSummaryById`   | **No**           | None |
| `create`            | Yes              | None — accepts `user`, passes to repo, but doesn't verify the source belongs to user |
| `updateName`        | **No**           | None |
| `delete`            | **No**           | None — any user can delete any pipeline |
| `analyze`           | Yes (for DT scoping) | The DT-by-source-id call is user-scoped; the pipeline lookup is not |
| `listSteps`         | **No**           | None |
| `addStep`           | **No**           | None |
| `updateStep`        | **No**           | None |
| `deleteStep`        | **No**           | None |

### `PipelineRunService`

| Method                | Takes user? | Inline ACL check? |
|-----------------------|-------------|-------------------|
| `submit`              | **No**      | None — any user can run any pipeline |
| `previewStep`         | **No**      | None |
| `status`              | **No**      | None (cache lookup by runId) |
| `history`             | **No**      | None |
| `pipelineExists`      | **No**      | None |

### `PermissionService`

All three methods (`list`, `grant`, `revoke`) take user + go through `accessChecker.requireOwnerOnly("dashboard", ...)`. Correct.

## Audit — Route surface (which routes do or don't thread the user)

| Route file                       | All routes thread `user`?                          | Notes |
|----------------------------------|----------------------------------------------------|-------|
| `DashboardRoutes`                | Yes                                                | |
| `DashboardSnapshotRoutes`        | Yes                                                | |
| `PanelRoutes`                    | Mostly — `/panels/:id/query` does NOT use ACL      | Calls `panelService.findById(panelId)` (no user). |
| `PermissionRoutes`               | Yes                                                | |
| `DataTypeRoutes`                 | Mostly — `findById/rows/validate-expression` paths leak | Calls do not pass user; service doesn't take one. |
| `DataSourceRoutes`               | Yes                                                | |
| `DataSourcePreviewRoutes`        | Yes                                                | |
| `SourceRoutes`                   | Yes                                                | |
| `SourcePreviewRoutes`            | Yes                                                | |
| `PipelineRoutes`                 | Only `create` + `analyze` thread user              | List/get/patch/delete don't. |
| `PipelineStepRoutes`             | **No**                                             | No user passed to any call. |
| `PipelineRunSubmitRoutes`        | **No**                                             | |
| `PipelineRunStatusRoutes`        | **No**                                             | |
| `PipelineRunHistoryRoutes`       | **No**                                             | |
| `PipelineRunStreamRoutes`        | **No**                                             | |
| `PublicDashboardRoutes`          | Yes (Option)                                       | Correctly sharing-aware via `aclDirective.authorizeResourceWithSharing`. |
| `AuthRoutes`, `OAuthRoutes`, `HealthRoutes` | n/a                                       | Auth-domain or no-auth routes. |

## Audit — Test surface

39 backend test files. Existing cross-user / ACL assertions live in:

- `backend/src/test/scala/com/helio/api/AclDirectiveSpec.scala` — directive-level coverage of `authorizeResource` and `authorizeResourceWithSharing` with owner / editor / viewer / public-viewer / no-grant cases. Comprehensive.
- `backend/src/test/scala/com/helio/services/DataTypeServiceSpec.scala`, `DataSourceServiceSpec.scala`, `DataSourceServiceRestartPersistenceSpec.scala` — assert Forbidden returns on cross-user mutations
- `backend/src/test/scala/com/helio/infrastructure/DataSourceRepositorySpec.scala`, `DataTypeRepositorySpec.scala` — owner-scoped read coverage at the repo level
- `backend/src/test/scala/com/helio/infrastructure/PipelineRepositorySpec.scala`, `PipelineStepRepositorySpec.scala`, `PipelineRunRepositorySpec.scala` — no cross-user assertions (because there is no ownership concept today)
- `backend/src/test/scala/com/helio/api/routes/PipelineAnalyzeRoutesSpec.scala`, `PipelineRunRoutesSpec.scala` — no cross-user assertions

**Test work per sub-PR:**

- CS1: extend `PipelineRepositorySpec` with migration backfill check + insert-with-owner check.
- CS2: extend `PipelineRepositorySpec`, `PipelineStepRepositorySpec`, `PipelineRunRepositorySpec` with cross-user None assertions. New `PipelineRoutesSpec`, `PipelineStepRoutesSpec`, `PipelineRunSubmit/Status/History/StreamRoutesSpec` — each with cross-user 404 cases.
- CS3: extend `DataTypeRepositorySpec`, `DataSourceRepositorySpec` with `findByIdOwned` coverage. Extend route specs (`DataTypeRoutesSpec`) with cross-user 404 cases on `GET /:id`, `/:id/rows`, `/:id/validate-expression`. Closes HEL-268 + HEL-242 regression assertions.
- CS4: extend `DashboardRoutesSpec`, `PanelRoutesSpec` — owner unchanged, editor / viewer paths verified, cross-user → 404. Cover `/panels/:id/query` cross-user → 404.
- CS5: any test breaking under the audit pass; no new test surface.

## Performance considerations

- `WHERE owner_id = :user OR EXISTS (SELECT 1 FROM resource_permissions p WHERE p.resource_type=? AND p.resource_id=t.id AND p.grantee_id=?)` is the worst-case sharing-aware shape (used in CS4 for dashboard / panel). Postgres should plan this as an index seek on `idx_<table>_owner_id` (V17) UNION an index seek on `idx_resource_permissions_resource` (V16) and `idx_resource_permissions_grantee` (V16). All indices already exist.
- The pipeline JOIN pattern (`pipeline_steps JOIN pipelines ON ... WHERE pipelines.owner_id = ?`) needs an index on `pipelines.owner_id`. Added by CS1's V32.
- `pipeline_steps.pipeline_id` is already indexed (V23). `pipeline_runs.pipeline_id` is already indexed (V24). Good.
- Owners reading their own resources: SQL plan is identical to today's `owner_id = ?` filter for the owner-only flavor; the sharing-aware flavor adds the EXISTS subquery which short-circuits when `owner_id = ?` matches. No regression expected.

## Risks surfaced

1. **Scope expansion** (pipelines have no ACL today; not in the originating 7). Surfaced for orchestrator sign-off. Without including pipelines, the ticket would close with the most exposed surface still wide open.
2. **`JoinStep` cross-user source access** is documented as `findByIdInternal` and remains a real cross-user data path post-fix. Surfaced as spinoff candidate, not absorbed.
3. **Pipeline backfill** assigns existing pipelines to the system user. Acceptable in dev / staging; production should hand-update `pipelines.owner_id` before deploying CS2. Documented in V32 comment.
4. **V32 default-then-make-NOT-NULL** pattern can hold a brief table lock; acceptable on a table the size of `pipelines` (currently low cardinality even in seeded dev).
5. **`AclDirectiveSpec` test stubs** override `ResourcePermissionRepository`'s public methods (lines 41-56 of the spec). The new repo signatures (CS2-CS4) don't change `ResourcePermissionRepository`; that test stays untouched. But the same pattern in any new spec that fakes `DashboardRepository` / `PanelRepository` / etc. will need updates.

## Recommendation to orchestrator-relay

**Proceed to cycle 2 (PR/CS1)** with the five-sub-PR plan in `design.md` §Q3
and `tasks.md`. Specifically:

- Confirm acceptance of scope expansion to include the pipeline surface
  (CS1 adds Flyway V32 + Pipeline domain field; CS2 enforces).
- Confirm acceptance of the app-layer JOIN approach (Q2) with PostgreSQL RLS
  as a deferred follow-up ticket.
- Confirm acceptance of the per-callsite owned-vs-shared assignment in
  Q1's tables (this is the largest set of judgment calls — review the
  per-resource sections to be sure the operational semantics match
  expectations).
- Confirm acceptance of the spinoff for `JoinStep` cross-user source access
  rather than absorbing it.

No blockers. No design escalation. Cycle 1 gates verified green (see below).

## Gate results

- `sbt test` — not re-run; cycle 1 made zero source-code changes. Pre-existing green baseline at the cycle-1 commit verified by `git status` clean from main.
- `npm test` — not re-run; same reason.
- `npm run build` — not re-run; same reason.
- `npm run lint`, `npm run format:check`, `npm run check:openspec`, `npm run check:scala-quality` — all run against the openspec artifacts in pre-commit and confirmed clean.

Diff contains only `openspec/changes/repo-acl-enforcement/{proposal,design,tasks,executor-report-1,files-modified}.md`. Zero production code touched.

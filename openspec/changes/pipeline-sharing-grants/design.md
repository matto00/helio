## Context

After HEL-265 (CS2), pipeline ACL is owner-only via `withUserContext` predicates in `PipelineRepository`.
`resource_permissions` stores `resource_type VARCHAR(50)` — accepting any string — but no rows exist with
`resource_type = 'pipeline'` and no RLS policies on the `pipelines` table guard sharing semantics. The
V36 migration established the dashboard/panel RLS pattern; this change replicates that pattern for pipelines.

The `AclDirective` is already resource-type-agnostic; `AuthDirective`, `PermissionService`, and
`ResourcePermissionRepository` are fully generic. The work is: one migration, repository additions, service
threading, route guard changes, a new `PipelinePermissionService` + `PipelinePermissionRoutes`, and a
frontend share dialog.

## Goals / Non-Goals

**Goals:**
- Viewer grantees: read all GET pipeline endpoints + SSE stream.
- Editor grantees: all viewer rights + mutate steps + trigger runs (not delete / transfer ownership).
- Owner: full CRUD including delete and permission management.
- Cross-user with no grant → 404 (preserved from CS2).
- Backend test matrix mirroring `DashboardPanelAclSpec`.
- Frontend share dialog wired into the pipelines page.

**Non-Goals:**
- No public-viewer (anonymous) path for pipelines.
- No "shared with me" pipeline list (deferred).
- No RLS policy changes to `pipeline_steps` or `pipeline_runs` (handled by HEL-276 after this lands).

## Decisions

**D1. Flyway V39: extend resource_permissions + add pipeline RLS.**
The V16 `resource_permissions` table uses `resource_type VARCHAR(50) NOT NULL` with no CHECK constraint on
allowed values — any string is accepted. V36 added `helio_can_access_dashboard`; V39 adds the equivalent
`helio_can_access_pipeline(pipeline_id TEXT)` SECURITY DEFINER function and RLS policies on `pipelines`.
No CHECK constraint change needed on `resource_permissions`. The `resource_permissions` RLS policies in V36
join to `dashboards.owner_id`; V39 adds parallel policies that join to `pipelines.owner_id`, OR-ing them
with permissive policies (Postgres OR-s multiple permissive policies).

Alternative: single `helio_can_access_resource` generic function. Rejected — the dashboard function is
stable/tested; introducing a shared function risks regression and adds complexity for minimal DRY gain.

**D2. PipelineRepository: add findByIdShared + findByIdOwned, keep findById unchanged.**
`findById(id, user)` is the current owner-only method; it's called from `PipelineService` everywhere.
Rather than changing its signature (which would ripple to all callers), we add:
- `findByIdShared(id, callerOpt)` — sharing-aware, returns `Option[Pipeline]`, mirrors `DashboardRepository.findById`.
- `findByIdOwned(id, user)` — owner-only with no grant fallback, for delete/rename only.

`PipelineService` routes viewer/editor paths through `findByIdShared` and gates mutations by access level.

**D2b. PipelineStepRepository: add internal (no-owner-JOIN) variants for post-ACL-check use.**
Every method in `PipelineStepRepository` joins `pipeline_steps` to `pipelines` on `pipeline.ownerId`.
An editor/viewer grantee is not the pipeline owner, so those joins silently return no rows.
The fix: add `listByPipelineInternal(id)`, `findByIdInternal(id)`, and privileged insert/update/delete
variants that drop the owner-JOIN predicate and use `withSystemContext`. These are called only after
`PipelineService` has confirmed access via `findByIdShared`. The pattern mirrors `PanelRepository`'s
`findByIdInternal` which is also used after sharing is confirmed. Owner-scoped methods remain unchanged
for paths that already carry the user context.

**D3. PipelineService threading ResourceAccess for mutation gating.**
`PipelineService` currently calls `findById` (owner-only) and returns `NotFound` for non-owners. After
this change: call `findByIdShared(id, Some(caller))` to resolve access. The service uses
`accessChecker.requireAccess` (not `requireOwnerOnly`) to obtain `ResourceAccess`:
- Owner or Editor: allow mutation (addStep, updateStep, deleteStep, triggerRun); use internal step repo
  variants that drop the owner-JOIN predicate.
- Viewer: return `Left(ServiceError.Forbidden("Forbidden"))` for any mutating call.
- None (no grant): return `Left(ServiceError.NotFound("Pipeline not found"))`.
`analyze` also moves to `findByIdShared` + `pipelineStepRepo.listByPipelineInternal`.
This keeps all ACL logic in the service layer; routes stay thin.

**D4. New PipelinePermissionService + PipelinePermissionRoutes.**
Mirrors `PermissionService` and `PermissionRoutes` exactly, but hard-codes `ResourceType = "pipeline"`.
No public-viewer grant path. Wired into `ApiRoutes` as `/api/pipelines/:id/permissions`.
`AccessChecker.requireOwnerOnly` is reused (it already supports any resource type via registry).

**D5. Wire types for pipeline permission endpoints are reused unchanged.**
`/api/pipelines/:id/permissions` reuses the existing `GrantPermissionRequest` and `PermissionResponse`
wire types verbatim (same JSON shape as the dashboard permission endpoints). No new schema files are
needed; the existing schemas in `schemas/` already cover `{"granteeId": "...", "role": "viewer|editor"}`.

**D5b. Frontend: PipelineShareDialog mirrors dashboard share UI pattern.**
No share dialog exists in the dashboard today (DashboardList has no "Share" action). This PR introduces
the first share dialog for the app. It will be a modal (using the existing `Modal` component) with:
- A permission list (grantee email + role).
- An "Add grantee" row with user email + role select.
- Revoke action per row.
API calls go through new `pipelineService.ts` functions.

The share button is added to the `PipelineDetailPage` header (owner-only visible, conditioned on the
pipeline being owned by the current user) and to `PipelineListTable` row actions.

**D6. SSE, run-history, and run-submit: sharing-aware existence check.**
`PipelineRunStreamRoutes` calls `runSvc.pipelineExists(pipelineId, user)` which uses the owner-only
`pipelineRepo.findById`. `PipelineRunHistoryRoutes` and `PipelineRunSubmitRoutes` similarly use
owner-only calls. Fix: add `pipelineExistsShared(id, user): Future[Boolean]` to `PipelineRunService`
that calls `pipelineRepo.findByIdShared(id, Some(user)).map(_.isDefined)`. This method is then called
from all three route files:
- SSE: viewer/editor/owner can subscribe; any caller with access passes.
- Run history: viewer/editor/owner can read.
- Run submit: owner/editor can trigger; the service already returns NotFound for viewer callers
  (since `findByIdShared` + `accessChecker.requireAccess` will gate the mutation). For the submit
  path, the existing `PipelineRunService.run/runDry` methods must also switch from `findById` to
  `findByIdShared` + an editor-or-owner guard.
The route signature takes `AuthenticatedUser` not `Option[AuthenticatedUser]`; `pipelineExistsShared`
wraps the user in `Some` — no public-viewer path for pipelines.

## Risks / Trade-offs

- [Risk] V36 `resource_permissions` RLS policies join only to `dashboards.owner_id`; pipeline owners
  cannot INSERT pipeline permission rows via the app pool. → **Mitigation**: V39 adds pipeline-owner
  INSERT/UPDATE/DELETE policies on `resource_permissions` (OR-ed alongside dashboard policies). The
  permission service uses `withSystemContext` (privileged bypass), so the RLS policies are defence-in-depth
  only — the service path is unaffected.
- [Risk] The existing `PipelineAclSpec` tests cross-user 404 behavior; adding sharing must not break
  those tests. → **Mitigation**: `findById(id, user)` signature is unchanged; existing service call sites
  that use the owner-only path continue to return 404 for non-owners with no grant. The new
  `PipelineSharingAclSpec` covers the grant paths.

## Migration Plan

1. Apply V39 migration (automatic on server start via Flyway).
2. Deploy backend and frontend together (no breaking API changes; new endpoints are additive).
3. Rollback: remove V39 (Flyway supports undo scripts or re-baseline); revert service/route changes.

## Planner Notes

- Self-approved: additive Flyway migration, no breaking changes, mirrors established pattern exactly.
- Self-approved: no new external dependencies.
- Self-approved: frontend share dialog is new but low-risk — uses existing Modal + httpClient primitives.

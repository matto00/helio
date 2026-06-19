## Why

After HEL-265 (CS2), every pipeline is owner-only — there is no `resource_permissions` row for pipelines,
so collaborators on multi-user teams cannot read or mutate a shared pipeline. This is the sharing layer
that was explicitly deferred from CS2.

## What Changes

- Flyway migration (V39): extend `resource_permissions` CHECK constraint to accept `resource_type = 'pipeline'`;
  add a `helio_can_access_pipeline` SECURITY DEFINER function and RLS policies on `pipelines` analogous to
  the dashboard policies in V36.
- `PipelineRepository`: add `findByIdShared(id, callerOpt)` (sharing-aware read, mirrors DashboardRepository
  `findById`), `findByIdOwned` (owner-only, for delete), and keep `findByIdInternal` for the registry.
- `PipelineService`: replace the owner-only `findById/exists` calls with sharing-aware equivalents; thread
  `ResourceAccess` level down to mutation-gating logic.
- `PipelineRoutes` + step/run routes: apply `requireRole(Editor)` on mutation endpoints (add step, run,
  patch step, delete step); viewer grantees can call all GET endpoints and the SSE run-events stream.
- New `PipelinePermissionService` (mirrors `PermissionService`) and `PipelinePermissionRoutes`
  (`/api/pipelines/:id/permissions`): owner-only grant/revoke/list, no public-viewer path.
- New Scala test: `PipelineSharingAclSpec` — owner / editor grantee / viewer grantee / cross-user no-grant
  matrix across the full pipeline route surface (mirrors `DashboardPanelAclSpec`).
- Frontend: add `listPipelinePermissions`, `grantPipelinePermission`, `revokePipelinePermission` to
  `pipelineService.ts`; add a `PipelineShareDialog` component (mirrors dashboard share UI) and wire it
  into the `PipelineDetailPage` and/or `PipelineListTable` actions menu.

## Capabilities

### New Capabilities
- `pipeline-sharing`: Sharing-grant layer for pipelines (viewer/editor roles, permission management routes,
  RLS policies, sharing-aware repository methods, and share dialog UI).

### Modified Capabilities
- `resource-permissions`: The `resource_permissions` table now accepts `resource_type = 'pipeline'` in
  addition to `'dashboard'`. The RLS policy on `resource_permissions` is extended to cover pipeline owners.
- `acl-enforcement`: `authorizeResourceWithSharing` is used on pipeline GET routes; `requireRole` guards
  mutation routes — no new directive logic needed, only new call sites.
- `pipeline-run-sse`: Viewer grantees may subscribe to the run-events SSE stream (read-only).

## Non-goals

- No public-viewer fallback for pipelines (no anonymous pipeline use case per the ticket).
- No "shared with me" list endpoint (deferred — the ticket only requires the detail + step + run surface).
- No RLS policy changes to `pipeline_steps` or `pipeline_runs` tables in this PR (those tables are
  owner-only in V35; HEL-276 will add sharing-aware RLS once this grants layer lands).

## Impact

- Backend: `PipelineRepository`, `PipelineService`, `PipelineRoutes`, `PipelineStepRoutes`,
  `PipelineRunSubmitRoutes`, `PipelineRunHistoryRoutes`, `PipelineRunStreamRoutes`, `ApiRoutes`,
  new `PipelinePermissionService` + `PipelinePermissionRoutes`.
- DB: one new Flyway migration (V39).
- Frontend: `pipelineService.ts`, new `PipelineShareDialog.tsx`, `PipelineDetailPage.tsx`,
  `PipelineListTable.tsx` (adds Share action to row actions menu).
- Tests: new `PipelineSharingAclSpec.scala`, existing `PipelineAclSpec` unchanged (cross-user 404
  behavior is preserved for callers with no grant).

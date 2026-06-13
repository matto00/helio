## 1. Backend: Database Migration

- [x] 1.1 Write V39 Flyway migration: add `helio_can_access_pipeline` SECURITY DEFINER function
- [x] 1.2 Add RLS policies on `pipelines` table (SELECT/UPDATE/DELETE/INSERT) in V39
- [x] 1.3 Add pipeline-owner INSERT/UPDATE/DELETE policies on `resource_permissions` in V39

## 2. Backend: Repository

- [x] 2.1 Add `findByIdShared(id, callerOpt)` to `PipelineRepository` (sharing-aware, mirrors DashboardRepository.findById)
- [x] 2.2 Add `findByIdOwned(id, user)` to `PipelineRepository` (owner-only, for delete/rename)
- [x] 2.3 Add `listByPipelineInternal(pipelineId)` to `PipelineStepRepository` (no owner-JOIN, withSystemContext, for post-ACL-check use)
- [x] 2.4 Add `findByIdInternal(stepId)` to `PipelineStepRepository` (no owner-JOIN, withSystemContext)
- [x] 2.5 Add `insertInternal`, `updateInternal`, `deleteInternal` to `PipelineStepRepository` that drop the owner-JOIN predicate (for editor grantees)

## 3. Backend: Service Layer

- [x] 3.1 Update `PipelineService.findSummaryById` to use `findByIdShared` (viewer and editor can read)
- [x] 3.2 Update `PipelineService.delete` to use `findByIdOwned` (owner-only, grantees get 403)
- [x] 3.3 Update `PipelineService.updateName` to use `findByIdOwned` (owner-only, grantees get 403)
- [x] 3.4 Update `PipelineService.listSteps` to use `findByIdShared` + `listByPipelineInternal` (viewer can list steps)
- [x] 3.5 Update `PipelineService.addStep` to allow Editor (use internal insert); reject Viewer with 403
- [x] 3.6 Update `PipelineService.updateStep` to allow Editor (use `findByIdInternal` + internal update); reject Viewer with 403
- [x] 3.7 Update `PipelineService.deleteStep` to allow Editor (use `findByIdInternal` + internal delete); reject Viewer with 403
- [x] 3.8 Update `PipelineService.analyze` to use `findByIdShared` + `listByPipelineInternal` (viewer can analyze)
- [x] 3.9 Add `pipelineExistsShared(id, user)` to `PipelineRunService` (wraps `findByIdShared(id, Some(user))`)
- [x] 3.10 Update `PipelineRunService.run` and `runDry` to use `findByIdShared` + editor-or-owner guard (viewer gets 403)
- [x] 3.11 Create `PipelinePermissionService` mirroring `PermissionService` with `ResourceType = "pipeline"`, no public-viewer grant

## 4. Backend: Routes

- [x] 4.1 Update `PipelineRunStreamRoutes` to call `pipelineExistsShared` instead of `pipelineExists` (viewer grantee can subscribe)
- [x] 4.2 Update `PipelineRunHistoryRoutes` to call `pipelineExistsShared` instead of `pipelineExists` (viewer can read history)
- [x] 4.3 Update `PipelineRunSubmitRoutes` to use sharing-aware guard (editor/owner can trigger; viewer gets 403 from service)
- [x] 4.4 Create `PipelinePermissionRoutes` for `/api/pipelines/:id/permissions` (GET/POST/DELETE)
- [x] 4.5 Wire `PipelinePermissionRoutes` into `ApiRoutes`

## 5. Frontend: Service

- [x] 5.1 Add `listPipelinePermissions(pipelineId)` to `pipelineService.ts`
- [x] 5.2 Add `grantPipelinePermission(pipelineId, granteeId, role)` to `pipelineService.ts`
- [x] 5.3 Add `revokePipelinePermission(pipelineId, granteeId)` to `pipelineService.ts`
- [x] 5.4 Add `PermissionGrant` and `GrantRole` types to pipeline types

## 6. Frontend: Share Dialog

- [x] 6.1 Create `PipelineShareDialog.tsx` modal with grantee list, add-grantee form, revoke actions
- [x] 6.2 Add Share button to `PipelineDetailPage` header (owner-only, conditional on ownership)
- [x] 6.3 Add "Share" action to `PipelineListTable` row actions menu (owner-only)

## 7. Tests

- [x] 7.1 Write `PipelineSharingAclSpec.scala` covering owner / editor / viewer / no-grant matrix for all pipeline route surfaces
- [x] 7.2 Extend `PipelineAclSpec` with one regression test: cross-user 404 still holds after this change
- [x] 7.3 Run `sbt test` and confirm all tests pass
- [x] 7.4 Run `npm test` in frontend and confirm all tests pass
- [x] 7.5 Run `npm run lint` and confirm zero warnings

# HEL-1002 Forbidden-producer classification

Rule (design.md D1): a `Forbidden`/403 is kept only if the caller demonstrably already sees the resource
(owner / grantee / public / share-token) or the denial is not about a specific resource (tier, PAT scope,
CSRF, CORS). Anything reachable by a caller with NO grant on a real resource is an existence oracle and
becomes the absent-resource 404 (same message, byte-identical body).

Producers enumerated with `grep -rn "Forbidden\|StatusCodes.Forbidden\|TierForbidden\|ForbiddenMessage" backend/src/main`.
The per-file count of `ServiceError.Forbidden(` producers is pinned in
`ExistenceNotLeakedRoutesSpec` (`expectedForbiddenProducers`), so a new producer fails CI until classified here.

Visibility evidence (the "verify" rows of D1), read from live code:

- `DashboardRepository.findById(id, Some(user))` returns `Some` only if the caller is the owner or holds a
  user-specific grant (explicit `permTable` filter on `granteeId == caller`); else `None`.
  (Anonymous public-viewer fallback is the `None` caller branch only.)
- `PanelRepository.findById(id, Some(user))` returns `Some` only via owner-of-parent-dashboard,
  grantee-of-parent-dashboard, or public-viewer grant on the parent dashboard (single JOIN query).
  A public-dashboard panel is therefore visible to any authenticated caller; a 403 there reveals nothing.
- `PipelineRepository.findByIdShared(id, Some(user))` returns `Some` only for owner or explicit grantee
  (no public path for pipelines).
- `findByIdInternal` is ACL-bypassing: any `Forbidden`/NotFound distinction downstream of it is an oracle.

## A. Oracles converted to the absent-resource 404

| Site | Before | After |
|---|---|---|
| `AccessCheckerImpl.requireOwnerOnly` foreign owner | 403 for everyone | 404(`notFoundMessage`) for no grant; 403 for a grantee (they already see it) |
| `AccessCheckerImpl.requireAccess` authenticated no-grant | 403 | 404(`notFoundMessage`) |
| `AclDirective.authorizeResource` foreign owner | 403 `Forbidden` | 404(`notFoundMessage`) (no production caller; kept consistent, unit-tested) |
| `AclDirective.authorizeResourceWithSharing` authenticated no grant / no valid share token | 403 `Forbidden` | 404(`notFoundMessage`) |
| `ShareTokenService.mapForbiddenToNotFound` (HEL-590) | local 403->404 | deleted; produced by `requireOwnerOnly` itself |
| `PanelService.update/delete/duplicate` | `findByIdInternal` then dashboard `requireAccess`: foreign panel 403 vs absent `Panel not found` | switched to sharing-aware `panelRepo.findById(id, Some(user))`: foreign panel is `Panel not found`, byte-identical |
| `PanelService.batchUpdate` | `findByIdInternal` (+ "all panels same dashboard" 400 as a second oracle for mixed own/foreign batches) | sharing-aware `findById(..., Some(user))`: foreign id -> `Panel '<id>' not found` |
| `PatchSetApplyResolvers.resolvePanelUpdate/resolvePanelDelete` | `findByIdInternal` -> `authorizeEditorOnDashboard` 403 vs `edit N: panel not found` | sharing-aware `findById(..., Some(user))`: `edit N: panel not found` |

| `PatchSetApplyResolvers.resolvePipelineStepUpdate/Delete` (cycle 2) | step found by `findByIdInternal`, then `authorizeEditorOrOwnerOnPipeline` answered a no-grant caller `Pipeline not found` vs `edit N: pipeline step not found` for an absent step | new `requireVisibleStep`: parent via `findByIdShared(.., Some(user))`, `None` -> `edit N: pipeline step not found`; only then the editor/owner check (viewer stays 403). Applies to `/patch-sets/apply` and `/preview` (shared resolvers) |

Note: merely collapsing the helper would NOT have closed the panel-by-id routes: after the helper change a
foreign panel would have answered `Dashboard not found` (the helper's message) against `Panel not found`
for an absent one. The id-keyed resolution had to move to the visibility-filtered lookup. The parametrised
spec fails on this (message mismatch), which is how it was found.

## B. Legitimate 403 producers (unchanged)

| Producer | File:line (post-change) | Why legit |
|---|---|---|
| Viewer on edit/owner op, reached only after the sharing-aware read or `requireAccess` | `AutoLayoutService` (viewer), `DashboardContentsService` (viewer), `DashboardService` x4 (`deleteInternal`/`duplicate` grantee non-owner after `findById(Some(user))`; `update`/`exportSnapshot` viewer after `findById(Some(user))`), `PanelService` create/batchUpdate/batchCreate-`authorizeEditor`/`authorizeEditorOnDashboard` viewer, `OutputService.create` viewer, `PatchSetApplyResolvers.authorizeEditorOnDashboard` + dashboard-update viewer | `findById(..., Some(user))` / `requireAccess` returned a grant first: the caller has a grant (or public view), so the resource's existence is already known to them. |
| `DashboardService.delete/duplicate` grantee non-owner (`d.ownerId != user.id`) | `DashboardService` | `d` came from `dashboardRepo.findById(id, Some(user))`, which is visibility-filtered (evidence above), so a non-owner reaching this arm holds a grant. |
| `PatchSetApplyResolvers.resolveDashboardDelete` `existing.ownerId != user.id` | `PatchSetApplyResolvers` | `existing` from `dashboardRepo.findById(id, Some(user))` (visibility-filtered): non-owner here is a grantee. Verified, legit. |
| `PanelService.submitForm` non-owner | `PanelService` | `panelRepo.findById(panelId, Some(user))` is visibility-filtered (owner/grantee/public-dashboard); a non-owner reaching the arm can already see the panel. Verified, legit. |
| Pipeline grantee non-editor | `PipelineRunService.submit` and step-preview `authorizedForAi`, `PipelineService.requireEditorAccess` (all callers go through `findByIdShared(..., Some(user))` first and `requireEditorAccess` is only reached for a non-owner) | `findByIdShared` returned `Some` => caller holds a grant. |
| `PatchSetApplyResolvers.authorizeEditorOrOwnerOnPipeline` non-editor grantee | `PatchSetApplyResolvers` | after `ctx.pipelineRepo.findByIdShared(.., Some(user))`. |
| `HookTriggerService` token not scoped to pipeline | `HookTriggerService` | Scoped-PAT confinement: checked against the token's `allowedPipelineIds` before any lookup, independent of whether the pipeline exists (the allow-list is the token's own data, not a resource probe). |
| `AccessCheckerImpl.requireOwnerOnly` grantee arm | `AccessCheckerImpl` | caller holds a user-specific grant (`findGrant`). |
| `ServiceResponse` `Forbidden(_) -> 403` | mapping only | not a producer. |
| `TierErrorCompletion` / `ChatAccessService` / `AdminAccessService` `TIER_FORBIDDEN` | tier | not resource-specific. |
| `AuthDirectives.confineScopedToken` | `AuthDirectives.scala` | scoped-PAT confinement to `/api/hooks/*`; identical for any path. |
| `AuthDirectives` CSRF header | `AuthDirectives.scala` | not resource-specific. |
| `TopLevelErrorHandlers` CORS rejection | not resource-specific. |
| `ConnectorEntityRoutes` `forbiddenUpdateFields` | request-shape 400, not a 403. |

## C. Directive vs service layer difference (design-gate note)

The directive layer has no grant lookup for an owner-only gate, so a grantee reaching an owner-only route
through `AclDirective.authorizeResource` would get 404; the service-layer `requireOwnerOnly` gives a grantee
403. 404 never leaks, so both are safe. (`authorizeResource` currently has no production caller;
`authorizeResourceWithSharing` is the only directive path, used by `PublicDashboardRoutes`, where grantees
are served normally.)

## D. Sites that were already non-oracles (no change)

Pipeline step routes (`updateStep`/`deleteStep`/reorder/etc.): the step is found with `findByIdInternal` but the
parent pipeline is then resolved with `findByIdShared(.., Some(user))`, and a `None` there returns the same
`Pipeline step not found: <id>` message as an absent step (verified in `PipelineService` by reading both arms).
Dashboard `delete`/`duplicate`/`export`/`update`: sharing-aware `findById(Some(user))` first (404 for no grant).

Cycle-2 NotFound-message-divergence sweep (same class as the panel/step finds, not just `Forbidden`):
- `PatchSetApplyResolvers`: every `findByIdInternal`/lookup site re-read. Panel update/delete and pipelineStep
  update/delete fixed (above). `pipelineStep create` takes `parentId` directly into `authorizeEditorOrOwnerOnPipeline`
  (`findByIdShared`): foreign and absent pipelines both give `Pipeline not found`, covered by a row. dashboard
  update/delete (`findById(Some(user))`), pipeline update/delete (`findByIdShared`), dataSource and output
  update/delete (owner-scoped, single message) already return one message; recorded as exemptions with reasons in
  `ExistenceNotLeakedRoutesSpec.patchKindExemptions`, and the per-(kind, op) guard fails if a new dispatch pair appears
  without a row or an exemption.
- `PatchSetUndo*` (`PatchSetUndoConflictCheck.scala:95,173,208` and friends): not an oracle. `undo` is keyed by a
  patch-set application id resolved with `applicationRepo.findById(id, user)` (caller's own application); the panel/step ids
  those checks read come from the caller's own journal, never from the request, and their messages are conflict blockers
  for the caller's own edits. A stranger cannot make them name another tenant's id.
- Pipeline-step routes `PATCH/DELETE/duplicate /api/pipeline-steps/:id` now have rows (green already: parent resolved
  via `findByIdShared`, identical `Pipeline step not found: <id>`).

## E. Residual note (not equalised)

Timing: the collapsed `requireOwnerOnly` foreign arm adds one indexed `findGrant` query that the absent arm does
not run. Response shape is identical; timing equalisation is a stated non-goal (design.md).

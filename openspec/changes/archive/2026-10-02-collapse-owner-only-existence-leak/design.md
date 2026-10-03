## Context

Four sites distinguish "real but not yours" (403) from "absent" (404) for an authenticated caller: `AccessCheckerImpl.requireOwnerOnly` (owner != caller -> Forbidden), `AccessCheckerImpl.requireAccess` (no grant -> Forbidden), `AclDirective.authorizeResource` (owner != caller -> 403) and `AclDirective.authorizeResourceWithSharing` (no grant and no valid share token -> 403). The ticket names only the first two; the directive twins are the same oracle on the HTTP layer and are in scope per the owner's "globally, across every owner-only route" ruling. The ServiceResponse mapping renders `Forbidden` as 403. Additional `Forbidden` producers exist in services (PanelService, PipelineRunService, PipelineService, PatchSetApplyResolvers, DashboardService, OutputService, AutoLayoutService, DashboardContentsService, HookTriggerService, tier services). Owner ruling: collapse globally, no per-route opt-in, drop HEL-590's local mapping; legitimate 403s stay.

## Goals / Non-Goals

**Goals:** one rule, implemented in the shared helpers: no grant at all on a real resource -> exactly the absent-resource response. Parametrised red-first proof across every owner-only route.
**Non-Goals:** timing equalisation beyond response shape (both arms already do one owner lookup; the grant lookup adds one indexed query only on the foreign path -- documented, not equalised); changing tier gating, PAT scope, Viewer-vs-Editor semantics; any schema change.

## Decisions

**D1. Classification rule.** A `Forbidden` is kept iff the caller demonstrably already can see the resource: owner/grantee/public/share-token-authorised, or the denial is not about a specific resource (tier, PAT scope, CSRF, CORS). It becomes the absent-resource `NotFound` iff the caller has no grant at all. Executor MUST enumerate every `Forbidden` producer (grep `Forbidden`, `StatusCodes.Forbidden`, `ForbiddenMessage`, `TierForbidden`) and record the classification table in `files-modified.md`/evaluation handoff; the table is a required deliverable.

Initial classification (executor verifies each against the live code):
| Site | Class |
|---|---|
| AccessCheckerImpl.requireOwnerOnly foreign owner | oracle unless grantee -> 404 for no grant, 403 for a grantee |
| AccessCheckerImpl.requireAccess no grant | oracle -> 404 |
| AclDirective.authorizeResource foreign owner | oracle -> 404 |
| AclDirective.authorizeResourceWithSharing no grant/no token | oracle -> 404 |
| ShareTokenService.mapForbiddenToNotFound | delete |
| PanelService/AutoLayout/Dashboard*/Output Viewer -> Forbidden | legit (viewer sees it) |
| PanelService form-submit non-owner | verify: legit only if reachable solely after a visibility check (panelRepo.findById with Some(user)) |
| PipelineRunService/PipelineService/PatchSetApplyResolvers grantee non-editor | legit (grant exists) |
| PatchSetApplyResolvers.scala dashboard `ownerId != user.id` after findById(Some(user)) | verify: legit only if findById filters to visible |
| HookTriggerService token not scoped | legit (PAT confinement) |
| TierForbidden/AdminAccessService | legit (tier) |
| AuthDirectives CSRF/PAT confinement, CORS | legit |

**D2. requireOwnerOnly for a grantee.** Non-owner with a user-specific grant (viewer/editor) keeps 403: they can already see the resource (e.g. via the shared dashboard list), so 403 is not an oracle. Non-owner with no user grant -> `NotFound(notFoundMessage)`. Implemented with `permissionRepo.findGrant` (already injected). Public-grant-only/share-token-only callers get 404 (never wrong: 404 never leaks).

**D3. Byte-identical body.** The collapsed arm reuses the exact `notFoundMessage` of the absent arm (service layer) / the directive's `notFoundMessage` parameter (directive layer), so both arms serialize through the same `ErrorResponse`. Tests assert on the serialized body bytes, not only status.

**D4. Remove the local mapping.** Delete `ShareTokenService.mapForbiddenToNotFound` and its call sites; update its doc comment. Its existing tests must still pass unchanged (now via the shared helper).

**D5. Tests.** (a) AccessCheckerImpl unit spec: foreign/no-grant -> identical Left(NotFound(msg)); grantee -> Forbidden. (b) AclDirective unit spec updated. (c) A parametrised route-level spec enumerating every route that reaches a collapsed site (data-driven table of method/path-template/body per route, discovered by grep over routes, with a completeness guard that fails when a route using requireOwnerOnly/authorizeResource/authorizeResourceWithSharing is not in the table), asserting (status, body bytes) equality for nonexistent vs foreign ids. Must be red on main (record the failing run) and failable by mutation: reverting any one site must fail at least one row (record one mutation proof per site class). (d) existing specs asserting 403-for-no-grant are updated to 404 deliberately, listed in the PR.

**D6. Frontend and helio-mcp.** Grep for `403`/`status === 403`/`Forbidden` handlers on dashboards/pipelines/permissions/share routes in `frontend/src` and `helio-mcp/src`; any branch that treats a stranger's 403 specially is updated to the not-found handling. Live-check a stranger's `/dashboards/:id` URL shows the normal not-found state in light and dark themes.

## Risks / Trade-offs

- Behavioural 403->404 change is intentional and breaking for any client keyed on it (owner ruling). Mitigated by D6.
- A missed Forbidden site remains an oracle: mitigated by the mandatory enumeration + the completeness guard in D5(c).
- Extra grant query on requireOwnerOnly's foreign arm only (negligible, indexed).

## Gate-Chain Implications Checklist
Not applicable: no `.husky/**` or hook-invoked script is touched.

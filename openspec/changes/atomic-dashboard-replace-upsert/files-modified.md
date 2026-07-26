# Files modified — HEL-363 atomic-dashboard-replace-upsert

## Backend — shared panel construction (behavior-preserving refactor, 1.1/1.2)

- `backend/src/main/scala/com/helio/services/ProposalPanelSupport.scala` — **new**. Extracted
  `validatePanel`/`preValidateBindings`/`buildCreateRequest` (+ `buildDataConfig`/`buildNonDataConfig`/
  `mergeConfig`) out of `DashboardProposalService` into a shared object, so `DashboardContentsService`
  (replace-contents) and `DashboardProposalService` (apply-proposal) validate/construct panels identically
  instead of duplicating the logic.
- `backend/src/main/scala/com/helio/services/DashboardProposalService.scala` — delegates to
  `ProposalPanelSupport` for the extracted methods (behavior-preserving — verified against its own
  pre-existing test suite, all green); `DataPanelKinds`/`MetricKind`/`TimelineKind` widened from `private`
  to `private[services]` so the shared object can reference them without redefining (kept in this file
  specifically because `scripts/check-schema-drift.mjs` parses `DataPanelKinds` out of it by name);
  `createAll` updated for `DashboardService.create`'s new `(Dashboard, Boolean)` return shape.
- `backend/src/main/scala/com/helio/services/PanelService.scala` — extracted `buildForCreate` (construct +
  validate a `Panel` without inserting) out of `create`; `create` is now `accessCheck → buildForCreate →
  panelRepo.insert` (behavior-preserving — same validation order/error messages, verified against existing
  `PanelService` test suites, all green).

## Backend — atomic replace-contents (2.x)

- `backend/src/main/scala/com/helio/infrastructure/DashboardContentsOps.scala` — **new**. `replaceContents`
  trait (mixin, mirrors `DashboardSnapshotOps`): one `.transactionally` DBIO (delete existing panels, insert
  new panel rows, overwrite layout) via `ctx.withSystemContext` — the real repository-layer transaction
  design.md D1 requires (NOT the service-composed delete-on-failure pattern, since the target dashboard
  already exists).
- `backend/src/main/scala/com/helio/infrastructure/DashboardRepository.scala` — mixed in
  `DashboardContentsOps`; added `findByNameOwned` (owner-scoped, `lower(trim(name))` match) for get-or-create.
- `backend/src/main/scala/com/helio/services/DashboardContentsService.scala` — **new**. Orchestrates
  replace-contents: ACL (mirrors `DashboardService.update`'s two-step sharing-aware pattern — NOT a direct
  `accessChecker.requireAccess` call, which would leak existence via 403 for a no-grant caller; see the
  scaladoc + the fix below) → per-panel structural + binding pre-validation (zero DB writes) → mint new panel
  ids + remap layout → single call to `dashboardRepo.replaceContents`.
- `backend/src/main/scala/com/helio/api/protocols/DashboardProposalProtocol.scala` — added
  `ReplaceDashboardContentsRequest` (`panels: Vector[ProposalPanel]`) + its spray-json format.
- `backend/src/main/scala/com/helio/api/routes/DashboardContentsRoutes.scala` — **new**.
  `PUT /api/dashboards/:id/contents`, mirrors `DashboardProposalRoutes`'s thin-shell shape.
- `backend/src/main/scala/com/helio/api/package.scala` — added the `ReplaceDashboardContentsRequest` alias.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wired `DashboardContentsService` + mounted
  `DashboardContentsRoutes`.

## Backend — get-or-create-by-name (3.x)

- `backend/src/main/scala/com/helio/services/DashboardService.scala` — `CreateDashboardInput` gained
  `ifExists: Option[String] = None`; `create` now returns `Future[(Dashboard, Boolean)]` — looks up by name
  first via `findByNameOwned` only when `ifExists = Some("return")`; absent `ifExists` is byte-for-byte
  unchanged (no lookup, always inserts).
- `backend/src/main/scala/com/helio/api/protocols/DashboardProtocol.scala` — `CreateDashboardRequest` gained
  `ifExists: Option[String] = None` (`jsonFormat1` → `jsonFormat2`).
- `backend/src/main/scala/com/helio/api/routes/DashboardRoutes.scala` — `POST /api/dashboards` returns 200
  (found) vs 201 (created) based on the service's `Boolean`.

## Contracts

- `schemas/replace-dashboard-contents-request.schema.json` — **new**; `$ref`s `ProposalPanel` from
  `dashboard-proposal.schema.json` (no duplicated shape).
- `schemas/create-dashboard-request.schema.json` — added `ifExists` (enum `["return"]`).
- `openspec/changes/atomic-dashboard-replace-upsert/specs/{dashboard-contents-replace,dashboard-get-or-create}/spec.md`
  already carried the ADDED-requirement scenarios from the design gate — no changes needed (task 4.2).

## MCP

- `helio-mcp/src/httpClient.ts` — added `put()` (mirrors `patch()`); `send`'s method union gained `"PUT"`.
- `helio-mcp/src/helioApi.ts` — added `replaceDashboardContents(dashboardId, panels)`
  (`PUT /api/dashboards/:id/contents`); `createDashboard` gained an optional `ifExists?: "return"` passthrough.
- `helio-mcp/src/tools/proposal.ts` — exported `panelSchema` and `PANEL_TYPES` (previously module-private) so
  `write.ts` can reuse the exact same panel shape instead of redefining it.
- `helio-mcp/src/tools/write.ts` — new `replace_dashboard_contents` tool (reuses `panelSchema`);
  `create_dashboard` gained the `ifExists` passthrough; both documented in-tool.

## Tests (6.x)

- `backend/src/test/scala/com/helio/api/ApplyProposalSpecBase.scala` — added `seedDashboardForOwner` helper
  (raw-SQL insert via the existing privileged `ctx`) so HEL-363 specs can seed a cross-owner dashboard without
  a second stubbed session.
- `backend/src/test/scala/com/helio/api/DashboardContentsReplaceSpec.scala` — **new**. Atomic replace success
  (old panels gone, new panels present, layout applied); atomic rollback on one invalid panel (400 naming the
  panel, panel set unchanged); V41 companion-binding rejection; cross-tenant → 404; auth requirement.
- `backend/src/test/scala/com/helio/api/DashboardGetOrCreateSpec.scala` — **new**. First-call-creates;
  repeated-sequential-call idempotency (same id, 200 not 201, no duplicate); case-insensitive/trimmed match;
  owner-scoping; plain-create/`duplicate`/rename-unaffected regression guards (D3).

## Bug found + fixed during implementation (systematic-debugging)

**Root cause:** `DashboardContentsService.authorizeEditor` initially called `accessChecker.requireAccess`
directly for the ACL check. `AccessCheckerImpl.requireAccess` is deliberately AclDirective-shaped: for an
EXISTING resource with an authenticated caller who has no grant, it returns `403 Forbidden`, not `404` — this
is correct for endpoints like `GET /dashboards/:id/panels` (see `DashboardPanelAclSpec`) but leaks existence
for an endpoint whose spec (`specs/dashboard-contents-replace/spec.md`) requires `404` with no leak, matching
`DashboardService.update`'s contract.

**Probe:** `DashboardContentsReplaceSpec`'s "return 404 for a dashboard owned by another user" test failed
with `403 Forbidden was not equal to 404 Not Found`. Confirmed by reading `AccessCheckerImpl.requireAccess`:
the `Some(ownerId)` (resource exists) + no-grant branch returns `Left(ServiceError.Forbidden())`, never
`NotFound`.

**Fix:** `authorizeEditor` now mirrors `DashboardService.update`'s exact two-step pattern — sharing-aware
`dashboardRepo.findById` first (`None` → 404, no leak); only for a caller who IS a visible grantee does role
tier matter (owner proceeds directly; non-owner grantee's role is checked via `accessChecker.requireAccess`,
Viewer → 403). Verified: the failing test now passes; full spec suite green (12/12).

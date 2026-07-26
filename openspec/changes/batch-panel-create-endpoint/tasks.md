## 1. Backend: wire types

- [x] 1.1 Add `CreatePanelBatchItem`, `CreatePanelsBatchRequest`, `CreatePanelsBatchResponse` case
      classes to `PanelProtocol.scala` (mirrors `PanelBatchItem`/`UpdatePanelsBatchRequest`/
      `UpdatePanelsBatchResponse`); add their `RootJsonFormat`s.

## 2. Backend: shared build-all-for-create helper

- [x] 2.1 Extract `PanelService.buildAllForCreate(dashboardId, requests: Vector[CreatePanelRequest],
      user, itemLabel: Int => Option[String] = _ => None): Future[Either[ServiceError,
      Vector[Panel]]]` — sequential `buildForCreate` calls, short-circuit on first `Left`, zero DB
      writes. When a `Left(ServiceError.BadRequest(msg))` occurs at index `idx` and `itemLabel(idx)`
      is `Some(label)`, prefix the message (`s"$label: $msg"`) before returning; other error types
      and a `None` label pass through unchanged.
- [x] 2.2 Refactor `DashboardContentsService.buildPanels` to map its `ProposalPanel`s to
      `CreatePanelRequest`s up front (via `ProposalPanelSupport.buildCreateRequest`, as it already
      does per-item) and delegate the recursion to `buildAllForCreate`, passing NO `itemLabel`
      (default) so its error messages are byte-for-byte unchanged — behavior-preserving; run
      `DashboardContentsReplaceSpec` after to confirm parity.

## 3. Backend: insert-only repository op

- [x] 3.1 Add `PanelMutationOps.insertBatch(panels: Vector[Panel]): Future[Vector[Panel]]` — one
      `.transactionally` DBIO (`DBIO.sequence(panels.map(p => table += domainToRow(p)))`), via
      `ctx.withSystemContext` (caller ACL already confirmed), returning `panels` verbatim so input
      order is exact with no re-query. Add an inline comment justifying the RLS-bypass
      `withSystemContext` use (mirrors `PanelMutationOps.duplicate`'s existing comment), noting every
      panel's `ownerId` is already set to the ACL-checked caller by `buildForCreate`.

## 4. Backend: service + route

- [x] 4.1 Add `PanelService.batchCreate(request: CreatePanelsBatchRequest, user): Future[Either[
      ServiceError, Vector[Panel]]]` — reject empty `panels` (400), then a two-step ACL check on
      `request.dashboardId` mirroring `DashboardContentsService.authorizeEditor` (sharing-aware
      `findById` first → 404 on no grant at all; role check only for known grantees → 403 for
      Viewer), NOT a bare `accessChecker.requireAccess` call (design.md D4 — that pattern 403s a
      cross-tenant caller instead of 404ing). Then map each item + `dashboardId` to a
      `CreatePanelRequest`, call `buildAllForCreate` passing `itemLabel = idx => Some(s"panel
      ${idx + 1} ('${items(idx).title.getOrElse("")}')")` (design.md D2/D5), then
      `panelRepo.insertBatch` on success.
- [x] 4.2 Add `path("batch") { post { ... } }` to `PanelRoutes.scala`, placed before
      `path(PanelIdSegment)` (mirrors `updateBatch`'s placement before the same segment match),
      returning 201 + `CreatePanelsBatchResponse`.

## 5. Schemas + openspec

- [x] 5.1 Add `schemas/create-panels-batch-request.schema.json` (envelope `dashboardId` +
      `panels: [...]`, each item shaped like `create-panel-request.schema.json` minus
      `dashboardId`) and `schemas/create-panels-batch-response.schema.json` (`{ panels: [...] }`,
      each a `panel.schema.json`).
- [x] 5.2 Confirm `openspec/specs/panel-batch-create/spec.md` and the `mcp-panel-composition-tools`
      delta are in place (already drafted in this change's `specs/`; archived on delivery).

## 6. MCP surface

- [x] 6.1 Add `helioApi.ts#createPanels(input: { dashboardId, panels: [...] })` posting to
      `/api/panels/batch`, applying `withCompleteChartAppearance` per item exactly as
      `createPanel` does for a single panel.
- [x] 6.2 Add `create_panels` tool in `write.ts` (`server.registerTool`), documenting the
      all-or-nothing/input-order contract and that `create_panel` remains available for a single
      panel.

### Tests

- [x] 7.1 ScalaTest: multi-item happy path (`POST /api/panels/batch` creates N panels, returned in
      input order) — new route-level spec mirroring `DashboardContentsReplaceSpec`'s fixture.
- [x] 7.2 ScalaTest: rollback on one bad item (invalid `type`) — 400 naming the item by 1-based
      index and title (e.g. `"panel 2 ('...')"`), zero panels created, including the valid items in
      the same batch.
- [x] 7.2a ScalaTest: `buildAllForCreate` unit coverage for both the unlabeled (`itemLabel` default,
      used by `DashboardContentsService`) and labeled (`batchCreate`) paths, confirming a `BadRequest`
      error is prefixed only when a label is supplied.
- [x] 7.3 ScalaTest: per-item `config`/`appearance` (incl. `chart.chartType`) parity with single
      `POST /api/panels` — same input produces byte-for-byte identical persisted panel.
- [x] 7.4 ScalaTest: V41 rejection — a `config.dataTypeId` bound to a source-companion DataType
      400s the whole batch, nothing created.
- [x] 7.5 ScalaTest: cross-tenant — a caller with no access to `dashboardId` gets 404, zero panels
      created; a viewer-only grantee gets 403.
- [x] 7.6 ScalaTest: empty `panels` array is rejected with 400.
- [x] 7.7 ScalaTest: existing panels on the dashboard are untouched by a batch-create call.
- [x] 7.8 ScalaTest: `buildAllForCreate`/`DashboardContentsService` regression — existing
      `DashboardContentsReplaceSpec` suite still passes unchanged after the refactor.

## 1. ### Backend — shared panel construction (behavior-preserving refactor)

- [x] 1.1 Extract `validateStructure`/`validatePanel`/`preValidateBindings`/`buildCreateRequest` (+ helpers:
      `buildDataConfig`, `buildNonDataConfig`, `mergeConfig`) from `DashboardProposalService` into a shared
      object; `DashboardProposalService` calls through unchanged (no behavior change — verify with existing
      `DashboardProposalService` tests still green)
- [x] 1.2 Refactor `PanelService.create` to extract a `buildForCreate` step (config decode + appearance
      resolve + `rejectCompanionBinding` + domain `Panel` construction, no insert); `create` becomes
      accessCheck → `buildForCreate` → `panelRepo.insert` (behavior-preserving; verify with existing
      `PanelService` tests)

## 2. ### Backend — atomic replace-contents

- [x] 2.1 Add `DashboardContentsOps` trait (mixin, mirrors `DashboardSnapshotOps`) with
      `replaceContents(dashboardId, newPanels, layout): Future[Option[(Dashboard, Vector[Panel])]]` — one
      `.transactionally` DBIO (delete existing panels for dashboardId, insert new panel rows, update layout
      if given) via `ctx.withSystemContext`
- [x] 2.2 Add `DashboardContentsService` (or extend `DashboardService`): ACL check (owner or editor grantee,
      mirroring `update`) → per-panel structural + binding pre-validation (reusing 1.1/1.2, zero DB writes) →
      on any failure return `ServiceError.BadRequest` naming the offending panel, no repo call → on success,
      mint new panel ids, remap `ProposalPanel.layout` onto them into a `DashboardLayout` (mirrors
      `DashboardProposalService.applyLayout`'s id-remap, done pre-transaction — see design.md D2), then call
      `replaceContents`
- [x] 2.3 Add `ReplaceDashboardContentsRequest` protocol type (`panels: Vector[ProposalPanel]`, reuse
      `DashboardProposalProtocol.proposalPanelFormat`)
- [x] 2.4 Add route `PUT /api/dashboards/:id/contents` (new route file, mirrors `DashboardProposalRoutes`),
      response `DuplicateDashboardResponse`; wire into `ApiRoutes.scala`

## 3. ### Backend — get-or-create-by-name

- [x] 3.1 Add `DashboardRepository.findByNameOwned(name, ownerId)` (owner-scoped, case-insensitive/trimmed
      match: `lower(trim(name))`, consistent with `RequestValidation.normalizeDashboardName`)
- [x] 3.2 Extend `CreateDashboardRequest`/`DashboardService.create` with `ifExists: Option[String]`: when
      `Some("return")`, look up by name first via 3.1; on match return existing (200-path), else create as
      normal (201-path). App-level check-then-insert only — no DB constraint, no violation-handling needed
      (design.md D3: a hard constraint was rejected because it would regress `duplicate`/`updateName`/plain-
      create, which must stay byte-for-byte unchanged). When `ifExists` is absent, skip the lookup entirely.
- [x] 3.3 Update `DashboardRoutes` POST handler to return 200 vs 201 depending on found-vs-created

## 4. ### Contracts

- [x] 4.1 Add/update `schemas/` for the replace-contents request/response and the `ifExists` create field
- [x] 4.2 Update `openspec/` (OpenAPI) for both endpoints

## 5. ### MCP

- [x] 5.1 Add `replace_dashboard_contents` tool + `helioApi.ts` method (`PUT /api/dashboards/:id/contents`)
- [x] 5.2 Add `ifExists` passthrough to `create_dashboard` tool + `helioApi.createDashboard`
- [x] 5.3 Document both in tool descriptions (mirror `applyProposal`'s doc style)

## 6. ### Tests

- [x] 6.1 ScalaTest: atomic replace success (old panels gone, new panels present, layout applied)
- [x] 6.2 ScalaTest: atomic rollback — one invalid panel in the payload leaves the dashboard's panel set
      unchanged, returns 400 naming the panel
- [x] 6.3 ScalaTest: V41 pipeline-only binding rejected on replace, same as create
- [x] 6.4 ScalaTest: cross-tenant replace-contents on another owner's dashboard → 404
- [x] 6.5 ScalaTest: get-or-create idempotency — repeated sequential calls return the same id, no duplicate
      created; case-insensitive match verified
- [x] 6.6 ScalaTest: get-or-create is owner-scoped (two owners, same name, two different dashboards)
- [x] 6.7 ScalaTest: plain create (no `ifExists`), `duplicate`, and rename are unaffected — still allow
      same-owner name collisions exactly as before this change

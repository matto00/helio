# Tasks — backend-service-layer (CS2b)

## 0. Bind to standards

- [x] 0.1 Read `WORKTREE_PATH/CONTRIBUTING.md` in full
- [x] 0.2 Read `ticket.md`, `proposal.md`, `design.md`

## 1. Foundations

- [x] 1.1 Create directory `backend/src/main/scala/com/helio/services/`
- [x] 1.2 Add `ServiceError.scala` (sealed trait + 5 case classes)
- [x] 1.3 Add `AccessChecker.scala` (trait + `AccessCheckerImpl` reusing the existing `AclDirective`'s resource-lookup table)
- [x] 1.4 Add `routes/ServiceResponse.scala` with the `complete[A](result)(success)` helper that maps `ServiceError → HTTP`
- [x] 1.5 `sbt compile` — must succeed before any service extraction begins

## 2. Service extraction — per domain

For each service, follow this loop:

1. Create the service file with constructor + method signatures
2. Move business logic from the corresponding route(s) into service methods
3. Rewrite the route to thin shape (`entity → ServiceResponse.complete(service.foo(...)) { result => Response.fromDomain(result) }`)
4. Update `ApiRoutes.scala` to construct the service and wire it into the route
5. `sbt compile` then `sbt test` — must pass before moving to the next service
6. Commit (one commit per service is encouraged for bisect)

### 2.1 `DashboardService`

- [x] 2.1.1 Create `services/DashboardService.scala`
- [x] 2.1.2 Move `applyDashboardUpdate` (DashboardRoutes) → `DashboardService.update`
- [x] 2.1.3 Move CRUD orchestration (find, create, delete, duplicate, findPanels) into service methods
- [x] 2.1.4 Slim `DashboardRoutes.scala` to ≤ 150 lines
- [x] 2.1.5 Move snapshot export/import + 4 validators (`validateVersion/Name/PanelTypes/LayoutReferences`) into `DashboardService` (or a dedicated `DashboardSnapshotService` — executor decides)
- [x] 2.1.6 Slim `DashboardSnapshotRoutes.scala` to ≤ 80 lines
- [x] 2.1.7 `sbt test` passes; commit

### 2.2 `PanelService`

- [x] 2.2.1 Create `services/PanelService.scala`
- [x] 2.2.2 Move `ResolvedPanelPatch`, `resolvePatch`, `applyPanelPatch`, `resolveTypeBinding`, `resolveBindingsForRead` from `PanelPatchService.scala` whole-cloth into `PanelService` (apply chain split into `PanelPatchApplier` to keep `PanelService` under the 300-line budget)
- [x] 2.2.3 Move CRUD orchestration (find, create, update, delete, duplicate, batchUpdate) into service methods
- [x] 2.2.4 Slim `PanelRoutes.scala` to ≤ 150 lines
- [x] 2.2.5 **Delete** `routes/PanelPatchService.scala`
- [x] 2.2.6 Wire `PublicDashboardRoutes` to call `PanelService.resolveBindingsForRead(...)` instead of its private `resolvePanels` (CS2a spinoff item)
- [x] 2.2.7 `sbt test` passes; commit

### 2.3 `AuthService` (security-sensitive)

- [ ] 2.3.1 Create `services/AuthService.scala`
- [ ] 2.3.2 Extract `PasswordHasher` as a small class injected into `AuthService`
- [ ] 2.3.3 Move `login`, `register`, `refresh`, `logout`, `completeOAuth` orchestration into the service
- [ ] 2.3.4 Cookie attribute computation moves into a typed `SessionCookie(...)` value returned from `AuthService`; the route copies attributes verbatim
- [ ] 2.3.5 Slim `AuthRoutes.scala` to ≤ 80 lines
- [ ] 2.3.6 Slim `OAuthRoutes.scala` to ≤ 80 lines (HTTP redirect / code exchange stays; profile→user-upsert moves to `AuthService.completeOAuth`)
- [ ] 2.3.7 Compare diff: token expiry, refresh semantics, CSRF state, password hashing algo/work factor must be **identical** byte-for-byte
- [ ] 2.3.8 `sbt test` passes; commit

### 2.4 `DataSourceService` + `SourceService`

- [ ] 2.4.1 Create `services/DataSourceService.scala` (CSV + Static connectors)
- [ ] 2.4.2 Create `services/SourceService.scala` (REST + SQL connectors)
- [ ] 2.4.3 Move CRUD + connector preview/refresh/infer logic into services
- [ ] 2.4.4 `Materializer` passed explicitly to `DataSourceService` (CSV streaming)
- [ ] 2.4.5 Slim `DataSourceRoutes.scala`, `DataSourcePreviewRoutes.scala`, `SourceRoutes.scala`, `SourcePreviewRoutes.scala` each to ≤ 150 lines
- [ ] 2.4.6 `sbt test` passes; commit

### 2.5 `DataTypeService`

- [ ] 2.5.1 Create `services/DataTypeService.scala`
- [ ] 2.5.2 Move CRUD + computed-field validation into service methods
- [ ] 2.5.3 Slim `DataTypeRoutes.scala` to ≤ 100 lines
- [ ] 2.5.4 `sbt test` passes; commit

### 2.6 `PipelineService`

- [ ] 2.6.1 Create `services/PipelineService.scala`
- [ ] 2.6.2 Move pipeline + step CRUD into the service; reuse existing `domain/PipelineAnalyzeService`
- [ ] 2.6.3 Slim `PipelineRoutes.scala` to ≤ 120 lines
- [ ] 2.6.4 Slim `PipelineStepRoutes.scala` to ≤ 80 lines
- [ ] 2.6.5 **Do NOT touch `PipelineRunRoutes.scala`** — CS2c scope
- [ ] 2.6.6 `sbt test` passes; commit

### 2.7 `PermissionService`

- [ ] 2.7.1 Create `services/PermissionService.scala`
- [ ] 2.7.2 Move grant/list/revoke into service methods
- [ ] 2.7.3 Slim `PermissionRoutes.scala` to ≤ 60 lines
- [ ] 2.7.4 `sbt test` passes; commit

## 3. Mechanical fold-ins (only if tractable inside the service extraction)

- [ ] 3.1 Prune `DashboardRoutes` `@unused panelRepo` and `dataTypeRepo` constructor params and update `ApiRoutes` wiring
- [ ] 3.2 Add `PipelineStepIdSegment` to `IdParsing.scala`; introduce `PipelineRunId` value class in `domain/model.scala` and matching segment
- [ ] 3.3 Narrow `PipelineRepository` / `PipelineStepRepository` / `PipelineRunRepository` signatures to value-class IDs **only if** it doesn't risk the service extraction. Defer to CS2c if it bloats the diff.

## 4. Verification gates

- [ ] 4.1 `sbt test` passes (≥ 511 tests; new service unit tests welcome but not required)
- [ ] 4.2 `npm run check:schemas` passes
- [ ] 4.3 `npm run check:openspec` passes
- [ ] 4.4 `npm run lint`, `npm run format:check` pass
- [ ] 4.5 `npm test` (frontend Jest) passes
- [ ] 4.6 **Every route file ≤ 150 lines** (`backend/src/main/scala/com/helio/api/routes/`), except `PipelineRunRoutes.scala` (CS2c) and `HealthRoutes.scala` (already 14)
- [ ] 4.7 **No `Route`, `complete`, `StatusCodes`, `entity`, `path` references** appear in any file under `backend/src/main/scala/com/helio/services/` (`grep` to verify)
- [ ] 4.8 **No Pekko HTTP imports** in any file under `backend/src/main/scala/com/helio/services/` (`grep -r "import org.apache.pekko.http" backend/src/main/scala/com/helio/services/` returns no matches)
- [ ] 4.9 `routes/PanelPatchService.scala` is deleted
- [ ] 4.10 `routes/PublicDashboardRoutes.scala` no longer contains a private `resolvePanels`

## 5. Smoke validation

- [ ] 5.1 Start backend (`sbt run`)
- [ ] 5.2 `curl http://localhost:8080/health` returns `{"status":"ok"}`
- [ ] 5.3 Stop backend cleanly

## 6. Commit / PR handoff

- [ ] 6.1 Multi-commit history preferred (one commit per service for bisect)
- [ ] 6.2 Final commit on branch `task/backend-service-layer/HEL-236`
- [ ] 6.3 Orchestrator handles push + PR — do not push

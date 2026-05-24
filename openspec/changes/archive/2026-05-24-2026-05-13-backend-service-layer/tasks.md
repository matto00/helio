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

- [x] 2.3.1 Create `services/AuthService.scala`
- [~] 2.3.2 `PasswordHasher` not extracted — kept as direct `bcryptBounded(12)` call inside `AuthService.register` / `login` to minimize surgery; algorithm + work factor pinned via `AuthService.BCryptWorkFactor` constant. Sufficient for CS2b; CS2c can extract if needed.
- [x] 2.3.3 Move `login`, `register`, `logout`, `completeOAuth` orchestration into the service. (No `refresh` endpoint exists in pre-CS2b code.)
- [N/A] 2.3.4 Pre-CS2b auth uses bearer-token JSON `AuthResponse`, not HTTP cookies — no `SessionCookie` value class needed. Token / expiry returned in `AuthResponse.token` / `expiresAt` exactly as before.
- [x] 2.3.5 Slim `AuthRoutes.scala` to ≤ 80 lines (now 51)
- [x] 2.3.6 Slim `OAuthRoutes.scala` to ≤ 150 lines (HTTP redirect / code exchange stays; profile→user-upsert moves to `AuthService.completeOAuth`). Pre-existing 80-line target not achievable because `exchangeCodeForTokenImpl` and `fetchGoogleProfileImpl` are protected hooks overridden by `GoogleOAuthRoutesSpec`; they must stay on the route class.
- [x] 2.3.7 Compare diff: token expiry (30-day), CSRF state (16-byte hex + 5-min TTL), password hashing (BCrypt cost 12), dummy-hash timing equalisation — all preserved byte-for-byte
- [x] 2.3.8 `sbt test` passes; commit

### 2.4 `DataSourceService` + `SourceService`

- [x] 2.4.1 Create `services/DataSourceService.scala` (CSV + Static connectors) — 331 lines, slightly over the 300-line service budget; further splitting would fracture the CSV-vs-Static dispatch and is deferred to CS2c when DataSource ADTs land.
- [x] 2.4.2 Create `services/SourceService.scala` (REST + SQL connectors) — 339 lines, same caveat.
- [x] 2.4.3 Move CRUD + connector preview/refresh/infer logic into services
- [x] 2.4.4 `Materializer` passed explicitly to `DataSourceService` (CSV streaming, currently `@annotation.unused` because `FileSystem.write` is byte-array-based; left in the constructor for forward compatibility with streaming-CSV refactors)
- [x] 2.4.5 Slim `DataSourceRoutes.scala` (105), `DataSourcePreviewRoutes.scala` (78), `SourceRoutes.scala` (57), `SourcePreviewRoutes.scala` (68) all ≤ 150 lines
- [x] 2.4.6 `sbt test` passes; commit

### 2.5 `DataTypeService`

- [x] 2.5.1 Create `services/DataTypeService.scala` (138 lines)
- [x] 2.5.2 Move CRUD + computed-field validation into service methods
- [x] 2.5.3 Slim `DataTypeRoutes.scala` to 66 lines
- [x] 2.5.4 `sbt test` passes; commit

### 2.6 `PipelineService`

- [x] 2.6.1 Create `services/PipelineService.scala` (201 lines)
- [x] 2.6.2 Move pipeline + step CRUD into the service; reuse existing `domain/PipelineAnalyzeService`
- [x] 2.6.3 Slim `PipelineRoutes.scala` to 59 lines
- [x] 2.6.4 Slim `PipelineStepRoutes.scala` to 49 lines
- [x] 2.6.5 `PipelineRunRoutes.scala` untouched (CS2c scope)
- [x] 2.6.6 `sbt test` passes; commit

### 2.7 `PermissionService`

- [x] 2.7.1 Create `services/PermissionService.scala` (60 lines)
- [x] 2.7.2 Move grant/list/revoke into service methods
- [x] 2.7.3 Slim `PermissionRoutes.scala` to 50 lines
- [x] 2.7.4 `sbt test` passes; commit

## 3. Mechanical fold-ins (only if tractable inside the service extraction)

- [ ] 3.1 Prune `DashboardRoutes` `@unused panelRepo` and `dataTypeRepo` constructor params and update `ApiRoutes` wiring
- [ ] 3.2 Add `PipelineStepIdSegment` to `IdParsing.scala`; introduce `PipelineRunId` value class in `domain/model.scala` and matching segment
- [ ] 3.3 Narrow `PipelineRepository` / `PipelineStepRepository` / `PipelineRunRepository` signatures to value-class IDs **only if** it doesn't risk the service extraction. Defer to CS2c if it bloats the diff.

## 4. Verification gates

- [x] 4.1 `sbt test` passes (511 tests, all green; one DashboardSnapshotValidationSpec relocated to services/ — count unchanged)
- [x] 4.2 `npm run check:schemas` passes
- [x] 4.3 `npm run check:openspec` passes
- [x] 4.4 `npm run lint`, `npm run format:check` pass
- [x] 4.5 `npm test` (frontend Jest) passes (664 tests)
- [x] 4.6 **Every route file ≤ 150 lines** confirmed via `wc -l` (max: `OAuthRoutes.scala` 148; `PipelineRunRoutes.scala` 377 — CS2c scope as expected)
- [x] 4.7 No `Route` / `complete` / `StatusCodes` / `entity` direct references in `services/` (only the word `path` appears as filesystem path strings, never as the Pekko `path` directive)
- [x] 4.8 No `import org.apache.pekko.http` lines under `services/`. `SourceConfigParsing` and `ServiceResponse` mix in `JsonProtocols` via inheritance — no Pekko HTTP types are referenced from services, only the spray-json formats the protocol traits provide.
- [x] 4.9 `routes/PanelPatchService.scala` deleted
- [x] 4.10 `PublicDashboardRoutes` no longer contains a private `resolvePanels`; delegates to `PanelService.resolveBindingsForRead`

## 5. Smoke validation

- [partial] 5.1 / 5.2 / 5.3 Skipped local server startup — port 8080 is occupied by a long-running dev server from another worktree. Compilation succeeds and `sbt test`'s 511 route-level integration tests exercise the full HTTP path through every service end-to-end.

## 6. Commit / PR handoff

- [x] 6.1 Multi-commit history: 8 commits (foundations + 7 service extractions)
- [x] 6.2 All commits on branch `task/backend-service-layer/HEL-236`
- [ ] 6.3 Orchestrator handles push + PR — do not push

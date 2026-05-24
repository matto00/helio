# Backend service layer — Change Set 2b of HEL-236

## Why

After CS1 (protocols split) and CS2a (routes decompose), the backend is structurally clean but architecturally still mixes two concerns in the route layer:

1. **HTTP concerns** — path matching, entity unmarshalling, status codes, response marshalling
2. **Business logic** — validation, ACL fan-out, repository orchestration, derived-state computation, cross-repo coordination

CS2a's route files (~150–250 lines each) are dominated by concern #2. Reading `DashboardRoutes.applyDashboardUpdate`, `PanelPatchService.applyPanelPatch`, or `AuthRoutes`'s login flow makes this obvious — the route file is the de facto service layer.

CS2b separates them. **Routes become thin** (≤ 150 lines each, mostly `entity → service.foo → complete`), and a new `services/` package owns the business logic. Each service is a plain Scala class — no Pekko types, no implicits, no HTTP awareness — testable in isolation.

This is the foundation for **CS2c** (Panel + DataSource sealed-trait ADTs with polymorphic methods). Polymorphic dispatch lands naturally on services + domain methods; trying to add it to fat routes would be a worse outcome.

## What changes

### New `services/` package

```
backend/src/main/scala/com/helio/services/
├── DashboardService.scala
├── PanelService.scala
├── DataSourceService.scala
├── DataTypeService.scala
├── PipelineService.scala
├── PipelineRunService.scala
├── SourceService.scala       (rename target — currently the "preview/refresh/infer" connector logic)
└── AuthService.scala
```

Each service:
- Constructor: takes repositories and pure dependencies (`FileSystem`, `RestApiConnector`, etc.). No `ActorSystem`, no `Materializer`, no Pekko types except where streaming is genuinely required (CSV upload).
- Methods return `Future[Either[ServiceError, A]]` or `Future[A]` for fail-fast cases. **No `Route`s.** No `complete(...)`. No `StatusCodes`.
- Owns validation. Validators that today live in routes (`validatePanelTypeOpt`, `validateSnapshotPayload`, etc.) become private methods or are extracted to `services/validation/`.
- Owns ACL invocation through a thin `AccessChecker` abstraction — services call `accessChecker.requireEditor("dashboard", id, user)` and get back a typed `Either[Forbidden | NotFound, ResourceAccess]`. The HTTP-aware `AclDirective` then maps that to the right HTTP response.

### Service error model

```scala
sealed trait ServiceError
object ServiceError {
  final case class BadRequest(message: String) extends ServiceError
  final case object NotFound extends ServiceError
  final case object Forbidden extends ServiceError
  final case class Conflict(message: String) extends ServiceError
}
```

Routes map `ServiceError` → HTTP status with a single `ErrorResponse(message)` body, so the wire shape is unchanged.

### Route file diet

| File | Before (CS2a) | Target (CS2b) | Strategy |
|---|---:|---:|---|
| `DashboardRoutes.scala` | 222 | ~100 | Move `applyDashboardUpdate`, `findById`+ACL chains, duplicate logic into `DashboardService` |
| `DashboardSnapshotRoutes.scala` | 109 | ~70 | Move `validateVersion/Name/PanelTypes/LayoutReferences` and the export/import orchestration into `DashboardSnapshotService` (sub-service or methods on `DashboardService` — executor's call) |
| `PanelRoutes.scala` | 214 | ~120 | Move PATCH machinery into `PanelService.update`. `PanelPatchService.scala` is deleted — its `ResolvedPanelPatch`, `resolvePatch`, `applyPanelPatch`, `resolveTypeBinding` move whole-cloth into `PanelService` |
| `PanelPatchService.scala` | 197 | **deleted** | Its purpose was a stopgap during CS2a; `PanelService` absorbs it |
| `AuthRoutes.scala` | 153 | ~80 | Move login/register/refresh/logout logic into `AuthService` (password hashing, session minting, token validation). Routes become "parse request → service.login(creds) → set-cookie + 200/401" |
| `OAuthRoutes.scala` | 149 | ~80 | Google profile exchange + user upsert logic moves to `AuthService.completeOAuth` |
| `DataSourceRoutes.scala` | 229 | ~100 | CRUD orchestration + CSV file persistence into `DataSourceService` |
| `DataSourcePreviewRoutes.scala` | 201 | ~100 | Connector preview/refresh/infer into `DataSourceService.preview/refresh/infer` |
| `SourceRoutes.scala` | 182 | ~80 | Migrate to `SourceService` for the few remaining endpoints |
| `SourcePreviewRoutes.scala` | 248 | ~100 | Same as DataSourcePreviewRoutes — preview/refresh/infer into `SourceService` |
| `DataTypeRoutes.scala` | 162 | ~80 | `DataTypeService.create/update/delete/validate` |
| `PipelineRoutes.scala` | 223 | ~110 | `PipelineService` for CRUD; `PipelineAnalyzeService` already exists in `domain/` — keep, just call it |
| `PipelineStepRoutes.scala` | 114 | ~80 | Step CRUD into `PipelineService.addStep/updateStep/deleteStep` |
| `PipelineRunRoutes.scala` | 377 | **out-of-scope** — defer to CS2c | Run lifecycle is tangled with the engine; cleaner to split as part of CS2c when the engine is also being decomposed |
| `PermissionRoutes.scala` | 82 | ~60 | Light touch — `PermissionService.grant/list/revoke` |
| `PublicDashboardRoutes.scala` | 60 | ~60 | Already thin; route reads `DashboardService.findPublicSnapshot` |

### Things that DO NOT change in CS2b

- **JSON wire shapes** — the same protocols module emits identical bytes. CS2c is where the wire evolves.
- **Domain model** (`Panel`, `DataSource`, etc. remain flat case classes). CS2c is where the ADTs land.
- **Repository signatures** — except where a CS2a spinoff item explicitly calls for it (raw-`String` ID narrowing on pipeline repos). Otherwise repos are untouched.
- **Pekko HTTP routing structure** — `ApiRoutes.scala` still composes sub-routers in the same order; the new services just slot in via constructor injection.

### Things the executor MAY do as fold-ins

These were CS2a's spinoff candidates and are mechanical enough to drop in:

- Unify `resolvePanels` — `PublicDashboardRoutes` uses `PanelService.resolveBindingsForRead(panels)` instead of its own private copy
- Prune `DashboardRoutes`'s `@unused panelRepo` / `dataTypeRepo` constructor params and the corresponding `ApiRoutes` wiring
- Narrow `PipelineRepository` / `PipelineStepRepository` / `PipelineRunRepository` signatures to value-class IDs (only if it's tractable inside the service extraction)
- Add `PipelineStepIdSegment` to `IdParsing.scala`; introduce `PipelineRunId` value class in `domain/model.scala` and a matching segment

**Caveat**: if any of these fold-ins balloon the diff or risk the service extraction, leave them for CS2c. CS2b's central concern is the service layer, not housekeeping.

## Impact

- **Specs affected**: none — wire shapes byte-identical.
- **Added**: 6–8 service files (~150–300 lines each), 1 `ServiceError.scala`, 1 `AccessChecker.scala`.
- **Modified**: every route file under `backend/src/main/scala/com/helio/api/routes/` except `HealthRoutes.scala` and `PipelineRunRoutes.scala`.
- **Deleted**: `PanelPatchService.scala` (its content moves into `PanelService.scala`).
- **Tests**: existing 511 backend tests must remain green. **New service tests are encouraged but not required** for behavior preservation — the existing route specs cover end-to-end. Net test count may grow modestly.
- **Frontend**: untouched.

## Out of scope

- Domain ADTs (CS2c — Panel + DataSource sealed traits)
- Wire shape evolution (CS2c)
- `PipelineRunRoutes` decomp (CS2c, bundled with engine split)
- `InProcessPipelineEngine` decomposition (CS2c)
- `DataSourceRepository.rowToDomain` alignment + inner-vs-left-join policy (CS2c, after ADTs land)
- HEL-242 P0 (Panel ↔ DataType binding) — deferred to after CS2c per user direction; fixed naturally by polymorphic Panel
- HEL-256 P0 (DataSource schema disappearance after restart) — parallel side-PR off main, not in CS2b

## Acceptance criteria

- [ ] `sbt test` passes (511 baseline; service tests may add a handful)
- [ ] `npm run check:schemas`, `check:openspec`, `lint`, `format:check`, frontend `npm test` all pass
- [ ] **Every route file ≤ 150 lines** (except `PipelineRunRoutes.scala` which is CS2c)
- [ ] Every service file ≤ 300 lines (we accept a more generous budget here because services absorb the route-side logic)
- [ ] **No `Route`, `complete`, `StatusCodes`, or other Pekko HTTP types** appear in any file under `backend/src/main/scala/com/helio/services/`
- [ ] **No business logic remains in routes** — route files contain only path matching, directive composition, entity unmarshalling, service invocation, and `ServiceError → HTTP` mapping
- [ ] `PanelPatchService.scala` is deleted
- [ ] Pre-commit gates pass
- [ ] Manual smoke: backend starts, `/health` returns 200, one round-trip of login → create dashboard → create panel → patch panel works

## Risk

- **Wide diff surface** — every route file changes. The discipline check is "did business logic move to the service intact, or did it get rewritten with semantic drift?" The evaluator must spot-diff each service's key method against the pre-CS2b route handler.
- **Auth surgery** — moving password hashing, session minting, OAuth flows into `AuthService` is the most security-sensitive surgery. Treat with extra care; the evaluator must specifically audit `AuthService` against the pre-CS2b `AuthRoutes` / `OAuthRoutes` byte-by-byte for the security-critical paths.
- **Service granularity drift** — temptation to "abstract" services into a `BaseService[T]` or similar. **Don't.** Each service is independent; share via small explicit helpers (validators, formatters) rather than inheritance.
- **AccessChecker indirection cost** — replacing `AclDirective` invocations inside routes with `accessChecker.requireEditor(...)` inside services means ACL checks happen in two layers (route directives for path-level auth, services for resource-level auth). Verify this isn't accidentally double-checking — services should be the source of truth for resource-level ACL; route directives only do "is this request authenticated?".
- **Future preservation pressure on CS2c** — once services exist, CS2c's polymorphic dispatch lands in service methods. If a service is designed badly here (e.g., a fat 500-line `PanelService` with type-discrimination inside), CS2c gets harder. Aim for clean method signatures that obviously want to be polymorphic in the next step.

# Design — backend-service-layer (CS2b)

## Layering after CS2b

```
┌─────────────────────────────────────────────────┐
│  routes/                                        │  HTTP only
│    DashboardRoutes, PanelRoutes, ...            │  path match · unmarshal · service call · ServiceError→HTTP
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│  services/                                      │  Business logic — pure Scala, no Pekko HTTP types
│    DashboardService, PanelService, ...          │  validation · ACL · cross-repo orchestration · derived state
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│  infrastructure/                                │  Persistence
│    DashboardRepository, ...                     │  Slick · DB queries · row↔domain mapping
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│  domain/                                        │  Pure domain (no Pekko, no Slick)
│    Panel, Dashboard, Pipeline, ...              │  case classes + value classes + pure functions
│    InProcessPipelineEngine, ExpressionEvaluator │  (will be reshaped in CS2c)
└─────────────────────────────────────────────────┘
```

`api/protocols/` and `api/JsonProtocols.scala` continue to live in the HTTP layer (`api/`) but are imported by services only for the case classes the protocol files define (which double as service inputs/outputs in CS2b — CS2c may rework this when domain ADTs land).

## Service file shape

### Anatomy

```scala
package com.helio.services

import com.helio.api.protocols._    // Request/response case classes (still authoritative until CS2c)
import com.helio.domain._
import com.helio.infrastructure._
import scala.concurrent.{ExecutionContext, Future}

final class PanelService(
    panelRepo: PanelRepository,
    dashboardRepo: DashboardRepository,
    dataTypeRepo: DataTypeRepository,
    accessChecker: AccessChecker
)(implicit ec: ExecutionContext) {

  def update(panelId: PanelId, request: UpdatePanelRequest, user: AuthenticatedUser): Future[Either[ServiceError, Panel]] = {
    ...
  }

  def create(...): Future[Either[ServiceError, Panel]] = ...
  def delete(...): Future[Either[ServiceError, Unit]] = ...
  // etc.
}
```

### Hard rules

- **No Pekko HTTP imports.** No `Route`, `StatusCodes`, `complete`, `entity`, `path`. The service is HTTP-agnostic.
- **No implicit `system: ActorSystem[_]`** — services run on the provided `ExecutionContext` alone. The one exception is `SourceService` / `DataSourceService` where CSV streaming legitimately needs `Materializer`; pass it explicitly.
- **No mutable state.** Services are stateless by construction; any state lives in repositories or in the `PipelineRunRegistry`-style infrastructure.
- **Return `Future[Either[ServiceError, A]]`** for endpoints with a domain failure mode (404, 403, 400). Return `Future[A]` for endpoints that can only succeed (`findAll`) — `ServiceError.NotFound` etc. live in the `Either` channel.

## `ServiceError` model

```scala
package com.helio.services

sealed trait ServiceError {
  def message: String
}

object ServiceError {
  final case class BadRequest(message: String) extends ServiceError
  final case class NotFound(message: String = "Not found") extends ServiceError
  final case class Forbidden(message: String = "Forbidden") extends ServiceError
  final case class Conflict(message: String) extends ServiceError
  final case class InternalError(message: String) extends ServiceError
}
```

Routes use a small extension to map → HTTP:

```scala
// In a routing helper module, e.g. routes/ServiceResponse.scala
object ServiceResponse {
  def complete[A](result: Future[Either[ServiceError, A]])(success: A => ToResponseMarshallable): Route = {
    onSuccess(result) {
      case Right(a)                       => complete(success(a))
      case Left(BadRequest(m))            => complete(StatusCodes.BadRequest, ErrorResponse(m))
      case Left(NotFound(m))              => complete(StatusCodes.NotFound, ErrorResponse(m))
      case Left(Forbidden(m))             => complete(StatusCodes.Forbidden, ErrorResponse(m))
      case Left(Conflict(m))              => complete(StatusCodes.Conflict, ErrorResponse(m))
      case Left(InternalError(m))         => complete(StatusCodes.InternalServerError, ErrorResponse(m))
    }
  }
}
```

Every route becomes a one-line call: `ServiceResponse.complete(panelService.update(id, req, user))(panel => PanelResponse.fromDomain(panel))`.

## `AccessChecker`

The HTTP-layer `AclDirective` exposes two paths today: (a) check that the current user has access to a resource by ID, and (b) authorize within the route. Services need (a) but **not** wrapped in a Pekko `Route`.

```scala
package com.helio.services

trait AccessChecker {
  def requireViewer(resourceType: String, resourceId: String, user: AuthenticatedUser): Future[Either[ServiceError, ResourceAccess]]
  def requireEditor(resourceType: String, resourceId: String, user: AuthenticatedUser): Future[Either[ServiceError, ResourceAccess]]
  def requireOwner(resourceType: String, resourceId: String, user: AuthenticatedUser): Future[Either[ServiceError, ResourceAccess]]
}
```

`AccessChecker` is implemented in `api/AclDirective.scala`'s file (or extracted to a new `services/AclService.scala` if it's clean) and reuses the same `findOwner` lookups. The HTTP `AclDirective` becomes a thin Pekko adapter that calls `AccessChecker` and maps the result; **services use `AccessChecker` directly, no HTTP awareness**.

If a route also wants directive-style authorization (e.g., extracting the resource for use after the check), it still uses `AclDirective` at the route level. Inside services, `AccessChecker` is the only ACL surface.

## Auth — special handling

Auth is security-critical and the most surgery-heavy area. The split:

### `AuthService`

```scala
final class AuthService(
    userRepo: UserRepository,
    sessionRepo: UserSessionRepository,
    userPreferenceRepo: UserPreferenceRepository,
    jwtConfig: JwtConfig,
    passwordHasher: PasswordHasher
)(implicit ec: ExecutionContext) {

  def login(req: LoginRequest): Future[Either[ServiceError, AuthResponse]]
  def register(req: RegisterRequest): Future[Either[ServiceError, AuthResponse]]
  def refresh(token: String): Future[Either[ServiceError, AuthResponse]]
  def logout(token: String): Future[Either[ServiceError, Unit]]
  def completeOAuth(googleProfile: GoogleProfile): Future[Either[ServiceError, AuthResponse]]
}
```

- Password hashing (`PasswordHasher`) extracted into its own small class — currently inlined in `AuthRoutes`.
- Session minting, JWT issuance, cookie attribute computation all move into `AuthService`.
- **`AuthRoutes` keeps only**: parse `LoginRequest`, call `authService.login(req)`, on success set the session cookie + return body; on failure 401/400.
- **`OAuthRoutes` keeps only**: redirect to Google's OAuth URL with the right state; on callback, exchange code → profile (this is HTTP-heavy and stays in `OAuthRoutes`, calling `AuthService.completeOAuth(profile)` once it has the profile).

### Security audit checkpoints (mandatory for evaluator)

- Cookie attributes (`Secure`, `HttpOnly`, `SameSite`) computed inside `AuthService` and returned as a typed `SessionCookie(...)` that the route copies to the response — no opportunity for the route to strip attributes accidentally.
- Token expiry / refresh semantics unchanged byte-for-byte.
- CSRF protection on the OAuth callback (the `state` parameter) is unchanged.
- Password hashing algorithm + work factor unchanged.

## Specific service designs

### `DashboardService`

Methods: `findAll(user)`, `findById(id, user)`, `create(req, user)`, `update(id, fields, payload, user)`, `delete(id, user)`, `duplicate(id, user)`, `findPanels(id, user)`. The current `applyDashboardUpdate` helper from `DashboardRoutes` becomes the `update` method.

Snapshot import/export: own methods (`exportSnapshot(id, user)`, `importSnapshot(payload, user)`). The four validators (`validateVersion`, `validateName`, `validatePanelTypes`, `validateLayoutReferences`) move from `DashboardSnapshotRoutes` into private methods of `DashboardService` — or a `DashboardSnapshotService` if the executor decides the split is more natural. Either is fine as long as `DashboardSnapshotRoutes` no longer contains them.

### `PanelService`

Methods: `findById(id, user)`, `create(req, user)`, `update(id, req, user)`, `delete(id, user)`, `duplicate(id, user)`, `batchUpdate(req, user)`, `resolveBindingsForRead(panels)`.

The `ResolvedPanelPatch`, `resolvePatch`, `applyPanelPatch`, `resolveTypeBinding` from `PanelPatchService.scala` move whole-cloth here. `PanelPatchService.scala` is deleted.

`PublicDashboardRoutes` calls `panelService.resolveBindingsForRead(...)` instead of its private `resolvePanels` copy — closing the CS2a spinoff for free.

### `PipelineService`

Methods: pipeline CRUD + step CRUD. Reuses existing `PipelineAnalyzeService` in `domain/`.

**Does NOT include run-lifecycle work.** `PipelineRunRoutes` and `PipelineRunService` are CS2c — touch only enough to make sure `PipelineRoutes` and `PipelineStepRoutes` are thin, and leave the run lifecycle dirty for now.

### `DataSourceService` / `SourceService`

These two have overlapping concerns today (the historical split is a v1.2 artifact). Don't merge them in CS2b — just slim both. CS2c may consolidate if the ADT remodel makes it natural.

`DataSourceService`:
- CSV file persistence (calls `FileSystem`, requires `Materializer` for streaming)
- CRUD on `data_sources` table
- Preview / refresh / infer for CSV and Static connectors

`SourceService`:
- CRUD on `data_sources` table for REST and SQL connectors
- Preview / refresh / infer for REST and SQL

The connector logic (REST `httpFetch`, SQL `execute`) stays in `domain/RestApiConnector` and `domain/SqlConnector` — the service is the orchestrator.

### `DataTypeService`

Light service — CRUD + computed-field validation. Probably ≤ 200 lines.

### `PermissionService`

Tiny — grant/list/revoke. ≤ 100 lines.

## Service wiring in `ApiRoutes.scala`

```scala
final class ApiRoutes(
    dashboardRepo: DashboardRepository,
    panelRepo: PanelRepository,
    /* ... */
)(implicit system: ActorSystem[_]) {
  private implicit val ec: ExecutionContext = system.executionContext
  private implicit val mat: Materializer = Materializer(system)

  // Services
  private val accessChecker     = new AccessCheckerImpl(resourceLookups, permissionRepo)
  private val dashboardService  = new DashboardService(dashboardRepo, panelRepo, dataTypeRepo, accessChecker)
  private val panelService      = new PanelService(panelRepo, dashboardRepo, dataTypeRepo, accessChecker)
  private val authService       = new AuthService(userRepo, sessionRepo, userPreferenceRepo, jwtConfig, passwordHasher)
  // ... etc.

  // Routes — now thin
  private val dashboardRoutes = new DashboardRoutes(dashboardService)(system)
  private val panelRoutes     = new PanelRoutes(panelService)(system)
  // ... etc.

  val all: Route = ...
}
```

Route classes now take **one service**, not 4–5 repositories. Cleaner constructor signatures + the `@unused` repo params from CS2a's spinoff vanish naturally.

## Test strategy

- **All 511 existing backend tests must pass.** They exercise routes end-to-end, so they're effectively integration tests for the new services as well.
- **New service unit tests are optional in CS2b** but encouraged for non-trivial validators (e.g., `DashboardService.validateSnapshotPayload`'s `Either` chain). The `DashboardSnapshotValidationSpec` we added in CS2a already covers this; if those tests move to `DashboardServiceSpec`, they remain valid.
- **Phase 3 UI smoke check** runs on this PR because it's wide-blast-radius backend with auth surgery. Per the orchestrator policy, backend-only PRs normally skip Phase 3, but **CS2b is a deliberate exception** — the evaluator must do a full login → dashboard CRUD → panel patch round-trip via Playwright.

## Latent-bug watch list

While doing the surgery, stay alert for:

1. **Double ACL checks** — if a service calls `accessChecker.requireEditor` AND a route directive also does the same check, you have a redundant call. Pick one layer.
2. **Implicit `ExecutionContext` mismatches** — services run on `ec`, routes run on the actor system's dispatcher. Make sure futures aren't accidentally crossing.
3. **`Materializer` capture** — CSV streaming code that captures the route-scope `mat` may break when the same logic lives in a service that doesn't have an actor system. Pass explicitly.
4. **Pekko-only types leaking into services** — `Multipart.FormData`, `HttpEntity`, etc. should be unmarshalled at the route boundary into plain Scala types (`Array[Byte]`, `Map[String, ByteString]`) before the service is called.

Trivial bugs fix inline. Non-trivial bugs become spinoff candidates per `feedback-refactor-discipline`.

## Rollback plan

Each service extraction is independent. If, say, the `AuthService` migration goes sideways, the surgery can be partially reverted file-by-file. Recommend the executor commit per-service (8 commits for 8 services) so bisect is cheap.

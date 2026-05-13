# Design — backend-routes-decompose

## Strategy

CS2a is **five distinct groups of work** (A–E) that share a common spine: each route file ends up ≤ 250 lines and uses CS1's `PathMatcher1[T]` idiom. Execute them in order — Group A is mechanical and zero-risk, Group D is mechanical and very low-risk, Groups B/C/E require real surgery.

The executor must run `sbt compile` after each group and full `sbt test` between groups to catch regressions early.

## Group A — ID-wrapper rollout (mechanical)

Pattern (per route file):

1. Add `import com.helio.api.protocols.IdParsing._` at the top.
2. Replace every `path(Segment) { idStr =>` for an ID path with `path(<X>IdSegment) { id: <X>Id =>`.
3. Remove now-redundant inner `<X>Id(idStr)` wraps.
4. If any repository call inside the handler took a raw `String` ID, the binding type now mismatches — fix by exposing the `.value` at the call site (or, preferably, narrow the repository signature in a follow-up if the change is mechanical).

Per the CS1 inventory:

```
DataTypeRoutes.scala   — :38, :55, :74   (DataTypeIdSegment)
PermissionRoutes.scala — :66             (UserIdSegment, granteeId)
DataSourceRoutes.scala — :174, :248, :321 (DataSourceIdSegment)
PipelineRoutes.scala   — :94, :157       (PipelineIdSegment)
SourceRoutes.scala     — :265, :359      (DataSourceIdSegment)
```

Also survey `PipelineRunRoutes.scala` and `PipelineStepRoutes.scala` — convert any path-extracted IDs found.

## Group B — DashboardRoutes cleanup

### B1 — PATCH dedup

The two PATCH paths (`:111-159` batch update, `:195-241` bare) share five concerns:

1. Read entity → `UpdateDashboardRequest`
2. `findById(dashboardId)` → 404 if missing
3. `aclDirective.authorizeResourceWithSharing("dashboard", id, user, ...)` → forbidden if Viewer
4. Fan-out: name → `repo.updateName(...)`; appearance → `repo.updateAppearance(...)`; layout → `repo.updateLayout(...)`
5. Compose final `DashboardResponse` from the latest state

Extract:

```scala
private def applyDashboardUpdate(
    dashboardId: DashboardId,
    fields: Set[String],          // Which fields the batch request flagged
    payload: DashboardUpdatePayload,
    user: User
)(implicit ec: ExecutionContext): Future[Either[String, DashboardResponse]] = ...
```

Both PATCH paths become 6-8 line wrappers that call this helper.

### B2 — `validateSnapshotPayload` Either chain

Replace each early `return Left(...)` with a step in a `for`-comprehension over `Either[String, _]`:

```scala
private def validateSnapshotPayload(
    payload: DashboardSnapshotPayload
): Either[String, Unit] = {
  for {
    _ <- validateVersion(payload.version)
    _ <- validateName(payload.dashboard.name)
    _ <- validatePanelTypes(payload.panels)
    _ <- validateLayoutReferences(payload)
  } yield ()
}
```

Each `validateX` is a private `Either`-returning method ≤ 5 lines.

### B3 — File budget

If post-dedup the file is still > 250 lines (rough estimate: ~290 after B1 + B2), split snapshot handlers into `DashboardSnapshotRoutes.scala`:

```scala
final class DashboardSnapshotRoutes(
    repo: DashboardRepository,
    panelRepo: PanelRepository,
    aclDirective: AclDirective,
    authDirectives: AuthDirectives
)(implicit ec: ExecutionContext) extends ResourceProtocol with DashboardProtocol with PanelProtocol {

  val routes: Route =
    concat(exportSnapshot, importSnapshot)

  private def exportSnapshot: Route = ...
  private def importSnapshot: Route = ...
}
```

Wire from `DashboardRoutes` via `~ dashboardSnapshotRoutes.routes`.

## Group C — PanelRoutes PATCH flatten

The handler at `:146-285` validates five things and then fans out updates. Current shape (annotated):

```scala
patch {
  entity(as[UpdatePanelRequest]) { request =>
    onSuccess(panelRepo.findById(panelId)) {
      case None => complete(404)
      case Some(existing) =>
        aclDirective.authorizeResourceWithSharing(...) { access =>
          access match {
            case Viewer => complete(403)
            case Editor | Owner =>
              // Begin nested validation arrow
              if (trimmedTitle.contains("")) { ... }
              else if (!hasAnything) { ... }
              else { validateImageFit ... validateDividerOrientation ... validatePanelTypeOpt ... }
          }
        }
    }
  }
}
```

### Target shape

```scala
patch {
  entity(as[UpdatePanelRequest]) { request =>
    onSuccess(panelRepo.findById(panelId)) {
      case None => complete(StatusCodes.NotFound, ErrorResponse("Panel not found"))
      case Some(existing) =>
        aclDirective.authorizeResourceWithSharing(...) {
          case ResourceAccess.Viewer => complete(StatusCodes.Forbidden, ErrorResponse("Forbidden"))
          case ResourceAccess.Editor | ResourceAccess.Owner =>
            resolvePatch(request) match {
              case Left(err)   => complete(StatusCodes.BadRequest, ErrorResponse(err))
              case Right(spec) => onSuccess(applyPanelPatch(existing, spec))(complete)
            }
        }
    }
  }
}

private def resolvePatch(request: UpdatePanelRequest): Either[String, ResolvedPatch] =
  for {
    _              <- validateTitle(request.title)
    _              <- validateAnyField(request)
    imageFit       <- RequestValidation.validateImageFit(request.imageFit)
    dividerOri     <- RequestValidation.validateDividerOrientation(request.dividerOrientation)
    panelTypeOpt   <- validatePanelTypeOpt(request.`type`)
  } yield ResolvedPatch(
    title            = request.title.map(_.trim),
    appearance       = request.appearance.map(toPanelAppearance),
    panelType        = panelTypeOpt,
    typeId           = request.typeId,
    fieldMapping     = request.fieldMapping,
    content          = request.content,
    imageUrl         = request.imageUrl,
    imageFit         = imageFit,
    dividerOri       = dividerOri,
    dividerWeight    = request.dividerWeight,
    dividerColor     = request.dividerColor
  )

private def applyPanelPatch(existing: Panel, spec: ResolvedPatch): Future[ToResponseMarshallable] =
  for {
    afterType  <- maybeApplyTypeUpdate(existing, spec.panelType)
    afterBind  <- maybeApplyBindingUpdate(afterType, spec.typeId, spec.fieldMapping)
    // ... etc
  } yield <PanelResponse | NotFound>
```

**Critical**: `spec.typeId` and `spec.fieldMapping` remain `Option[Option[_]]` exactly as the original. The custom Spray formatter in `PanelProtocol` distinguishes absent vs. explicit null; the flatten must preserve this.

### Decomposition target

If `PanelRoutes.scala` ends up > 250 lines after the flatten, extract the PATCH fan-out helpers (`applyTypeUpdate`, `applyMappingUpdate`, etc.) into a sibling `PanelPatchService.scala`. Keep `resolvePatch` co-located with the route since it's the immediate validation layer.

## Group D — Repository / directive decoupling

For each of the 5 files:

1. Read its `import` block — note any imports from `com.helio.api.JsonProtocols`.
2. Identify which protocol formats it actually uses (grep for `_format` references or implicit invocations).
3. Change `extends JsonProtocols` → `extends <DomainProtocol>`. If multiple are needed, mix them in (`extends DashboardProtocol with PanelProtocol`).
4. `sbt compile` and let the compiler tell you what's missing.

Expected outcomes (likely):

| File | Probable narrowed mix-in |
|---|---|
| `DashboardRepository` | `extends DashboardProtocol with PanelProtocol` (snapshot uses panel types) |
| `PanelRepository` | `extends PanelProtocol` |
| `DataTypeRepository` | `extends DataTypeProtocol` |
| `AclDirective` | `extends ResourceProtocol` (only needs `ErrorResponse`) |
| `AuthDirectives` | `extends ResourceProtocol` |

If the diff makes any of these much more verbose than `extends JsonProtocols`, that itself is a signal that JsonProtocols was hiding sprawling dependencies — surface in the spinoff report.

## Group E — Other oversized routes

Run **only if** Groups A–D leave `SourceRoutes`, `DataSourceRoutes`, or `AuthRoutes` > 250 lines.

### E1 — `SourceRoutes.scala` (413)

Likely structure today: CRUD + connector-specific preview endpoints (CSV, REST, SQL) glued together. Split:

- `SourceRoutes.scala` — CRUD shell, list sources, get source detail
- `SourcePreviewRoutes.scala` — `POST /api/sources/preview`, connector validation/inference paths

Wire both from `ApiRoutes`:

```scala
val sourceRoutes = new SourceRoutes(...)
val sourcePreviewRoutes = new SourcePreviewRoutes(...)
val all = sourceRoutes.routes ~ sourcePreviewRoutes.routes
```

### E2 — `DataSourceRoutes.scala` (386)

Likely similar: CRUD + per-connector logic (CSV upload, static-source CSV, etc.). Same split pattern.

### E3 — `AuthRoutes.scala` (325)

Split:
- `AuthRoutes.scala` — `/login`, `/register`, `/refresh`, `/logout`
- `OAuthRoutes.scala` — Google OAuth callback + token exchange

If after splits a file is still > 250 lines, the executor stops and reports — that signals a real complexity blob that needs design-level attention, not just lexical splitting.

## Test strategy

- All 506 existing backend tests must remain green between every group.
- Per-group sub-commit is acceptable (and encouraged for review-time bisect), but a single squashed commit at the end is also fine. The executor chooses.
- One new test recommended in Group B2: assert `validateSnapshotPayload` returns `Left` on each failure path (version, blank name, bad panel type, dangling layout reference). The existing integration tests already cover these via endpoint round-trips, so this is an explicit unit-level confirmation that the Either chain didn't drop a case.

## Latent-bug watch list

While doing the surgery, stay alert for:

1. **Pekko route ordering**: longer paths must come before their prefixes. Splitting a route file requires composing the resulting sub-routers in the right order in `ApiRoutes.scala`.
2. **`Option[Option[_]]` semantics**: Don't let the PATCH flatten collapse `Some(None)` ("explicit null") into `None` ("absent") or vice versa.
3. **Authorization order**: `aclDirective.authorizeResourceWithSharing` must wrap the work, not vice versa — i.e., authorization happens before validation, never after.
4. **Directive scope**: `AclDirective` and `AuthDirectives` are mixed into route classes; narrowing their `extends` shouldn't change what they expose, but a downstream route may have been depending on a transitively-imported format.

Trivial bugs fix inline (per `feedback-refactor-discipline` memory). Non-trivial bugs become spinoff candidates.

## Rollback plan

Each group is independent. If Group C (PanelRoutes flatten) goes sideways, revert that group only via `git restore --source=<pre-C-sha> -- backend/src/main/scala/com/helio/api/routes/PanelRoutes.scala`. The other groups are pure-additive structural moves.

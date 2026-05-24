# Backend routes decompose — Change Set 2a of HEL-236

## Why

CS1 split the JSON-protocol god-file and demonstrated the ID-wrapper boundary in two route files. The remaining backend god-files are concentrated in the `routes/` layer:

| File | Lines | Concern |
|---|---:|---|
| `SourceRoutes.scala` | 413 | over budget; mixed CSV/REST/SQL connector logic in one file |
| `DataSourceRoutes.scala` | 386 | over budget; CRUD + connector previews + secret handling |
| `PanelRoutes.scala` | 350 | over budget + 8-level nested PATCH handler |
| `DashboardRoutes.scala` | 340 | over budget + ~45-line duplicated PATCH body + non-local `return` in `validateSnapshotPayload` |
| `AuthRoutes.scala` | 325 | over budget; login/register/oauth/refresh interleaved |

The repository and directive layer also still couples to the entire JSON aggregator rather than to the per-domain protocol it actually needs:

| File | Current | Should narrow to |
|---|---|---|
| `DashboardRepository.scala` | `extends JsonProtocols` | `extends DashboardProtocol` |
| `PanelRepository.scala` | `extends JsonProtocols` | `extends PanelProtocol` |
| `DataTypeRepository.scala` | `extends JsonProtocols` | `extends DataTypeProtocol` |
| `AclDirective.scala` | `extends JsonProtocols` | `extends ResourceProtocol` |
| `AuthDirectives.scala` | `extends JsonProtocols` | `extends ResourceProtocol` |

This is CS2a (routes + repos + directives). The pipeline engine and run-lifecycle work lands in CS2b.

## What changes

### Group A — ID-wrapper rollout on remaining 5 route files

Mechanical rewrite using the `PathMatcher1[T]` segments introduced in CS1:

| Route file | Segments needed | Sites |
|---|---|---:|
| `DataTypeRoutes.scala` | `DataTypeIdSegment` | 3 |
| `PermissionRoutes.scala` | `UserIdSegment` (granteeId) | 1 |
| `DataSourceRoutes.scala` | `DataSourceIdSegment` | 3 |
| `PipelineRoutes.scala` | `PipelineIdSegment` | 2 |
| `SourceRoutes.scala` | `DataSourceIdSegment` | 2 |

Plus inspect `PipelineRunRoutes.scala` and `PipelineStepRoutes.scala` and convert any path-extracted IDs there as well.

### Group B — DashboardRoutes cleanup

1. **Dedup the PATCH path.** `DashboardRoutes.scala:111-159` (the `/update` batch path) and `:195-241` (the bare `path(DashboardIdSegment)` PATCH) implement the same control flow twice. Extract a private `applyDashboardUpdate(...)` that returns the response Future; both paths call it.
2. **Replace non-local `return` in `validateSnapshotPayload`** (`:307-339`) with an `Either` chain (`for-yield` over `Either` or `flatMap` series). Behavior identical, idiomatic Scala.
3. **File budget**: post-dedup the file should land ≤ 250 lines. If it doesn't, split snapshot-related handlers into `DashboardSnapshotRoutes.scala`.

### Group C — PanelRoutes flatten

`PanelRoutes.scala:146-285` is an 8-level nested PATCH handler. Flatten via an `Either`-of-validations pipeline:

```scala
val result: Either[String, ResolvedPatch] = for {
  _              <- validateTitleNotBlank(request.title)
  _              <- validateAnyFieldPresent(request)
  imageFit       <- RequestValidation.validateImageFit(request.imageFit)
  dividerOri     <- RequestValidation.validateDividerOrientation(request.dividerOrientation)
  panelTypeOpt   <- validatePanelTypeOpt(request.`type`)
} yield ResolvedPatch(...)

result.fold(
  err  => complete(StatusCodes.BadRequest, ErrorResponse(err)),
  spec => onSuccess(applyPanelPatch(panelId, spec))(...)
)
```

Decompose helper methods (`applyTypeUpdate`, `applyMappingUpdate`, `applyContentUpdate`, etc.) into the file's private section or into a new `PanelPatchService` if `PanelRoutes` is still over budget afterward.

### Group D — Repository / directive decoupling

Replace each `extends JsonProtocols` with `extends <DomainProtocol>` in the 5 files listed in the table above. Add a fail-loud compile check by removing unused implicit imports and seeing what breaks; any breakage indicates a real dependency that needs to be made explicit.

### Group E — Other oversized routes (only if over budget after A–D)

`SourceRoutes.scala` (413) is the worst offender. Likely split:
- `SourceRoutes.scala` — CRUD shell, source-listing
- `SourcePreviewRoutes.scala` — CSV/REST/SQL preview endpoints (the bulky validation paths)

`DataSourceRoutes.scala` (386):
- Same shape — split connector previews out

`AuthRoutes.scala` (325):
- `AuthRoutes.scala` — login/register/refresh
- `OAuthRoutes.scala` — Google OAuth callback

These splits are speculative — the executor picks the natural cut by reading the file. The hard rule is: every route file ≤ 250 lines after CS2a.

## Impact

- **Specs affected:** none — behavior-preserving.
- **Affected code:**
  - **Modified:** 7 route files + 5 repository/directive files
  - **Added:** 0–4 new route files for splitting oversized files (executor's call)
- **Frontend:** untouched.
- **Test impact:** all 506 backend tests must remain green. Likely 0 new tests; possible 1-2 added for newly-extracted helpers if natural.
- **Public API:** zero change — JSON wire shapes byte-identical, route paths byte-identical.

## Out of scope

- `PipelineRunRoutes` run-lifecycle helpers (CS2b)
- `InProcessPipelineEngine` decomposition (CS2b)
- `DataSourceRepository.rowToDomain` alignment (CS2b)
- Inner-vs-left-join policy codification (CS2b)
- Frontend (CS3 / CS4)
- New endpoints, new fields, renamed routes

## Acceptance criteria

- [ ] `sbt test` passes (506 baseline; possibly + a few helper-extraction tests).
- [ ] `npm run check:schemas`, `npm run check:openspec`, `npm run lint`, `npm run format:check`, frontend `npm test` all pass.
- [ ] **Every file under `backend/src/main/scala/com/helio/api/routes/` is ≤ 250 lines.**
- [ ] All 5 remaining route files (DataType, Permission, DataSource, Pipeline, Source) use ID-segment `PathMatcher1[T]` for path-extracted IDs.
- [ ] `DashboardRoutes` has no duplicated PATCH body; the dedup helper is a single private method.
- [ ] `DashboardRoutes.validateSnapshotPayload` uses no `return`.
- [ ] `PanelRoutes` PATCH handler has ≤ 4 levels of nesting in the validation chain.
- [ ] `DashboardRepository`, `PanelRepository`, `DataTypeRepository`, `AclDirective`, `AuthDirectives` each `extends` the narrowest per-domain protocol trait they need.
- [ ] No `import com.helio.api.JsonProtocols._` remains in any file under `backend/src/main/scala/com/helio/infrastructure/` or `backend/src/main/scala/com/helio/api/`. (Aggregator is allowed in `ApiRoutes.scala` and route files that pull from multiple domains — flag any edge cases.)
- [ ] Pre-commit gates pass.
- [ ] Manual sanity: backend starts, `/health` returns 200.

## Risk

- **PanelRoutes patch flatten is the most error-prone surgery.** The `Option[Option[_]]` semantics of `typeId` and `fieldMapping` must be preserved exactly — that's how the API distinguishes "absent" from "explicit null". Any helper extraction must thread these through faithfully. Mitigation: the existing PATCH integration tests cover null/absent cases; if any test fails, the flatten broke a real semantic.
- **Repository decoupling might surface a hidden cross-domain dependency** (e.g., `PanelRepository` actually uses a `DashboardProtocol` formatter). Mitigation: executor surfaces the broken compile, narrows to the smallest set of `extends` required. If the dependency is non-trivial, file as spinoff for CS2b.
- **Splitting `SourceRoutes` may surface route ordering dependencies** in Pekko (longer paths must be declared before their prefixes). Mitigation: the executor verifies via `ApiRoutes.scala`'s composition order and adds the split sub-router at the same position.

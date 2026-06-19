## Context

Four backend files exceed the project's file-size budget after HEL-265 added sharing-aware ACL logic:
- `DashboardRepository.scala` 384L (budget 250L) — bulk snapshot ops push it over
- `PanelRepository.scala` 361L (budget 250L) — `batchUpdate` + `duplicate` are expensive
- `DashboardService.scala` 332L (budget 300L) — companion object static validators
- `PanelService.scala` 347L (budget 300L) — companion object static helpers

Existing precedent: `PanelRowMapper.scala` (row↔domain mapping extracted from PanelRepository).

## Goals / Non-Goals

**Goals:**
- All 4 primary files ≤250L (repo) / ≤300L (service) after split
- No new file exceeds the 300L soft budget
- No behavior changes; 715 tests pass unchanged
- `Main.scala` / `ApiRoutes.scala` wiring untouched; constructor signatures unchanged

**Non-Goals:**
- Introducing new abstractions or interfaces
- Fixing latent bugs
- Changing package structure or import paths visible to callers outside the package

## Decisions

**D1 — Repository companion objects remain in place (NOT extracted).**
`DashboardRepository.PanelRow`, `DashboardRepository.DashboardTable`, etc. are referenced from 10+ call sites in `PanelRowMapper.scala`, `DashboardRepository.scala`, and `PanelRepository.scala` as qualified type names. Moving the companion bodies to separate files would require keeping type aliases or updating all call sites — both add noise with no value. The companion objects are a minor contributor to line count; the bulk ops are the real offender.

**D2 — Repository bulk operations → separate trait files, mixed into the repository class.**
- `DashboardSnapshotRepository.scala`: extract `duplicate`, `exportSnapshot`, `importSnapshot` (≈165L) as a `trait DashboardSnapshotOps` with `self: DashboardRepository =>` self-type. `DashboardRepository` extends this trait; the methods remain on `DashboardRepository` from callers' perspective. No call-site changes anywhere.
- `PanelMutationRepository.scala`: extract `duplicate` and `batchUpdate` (≈95L) as a `trait PanelMutationOps` with `self: PanelRepository =>` self-type. `PanelRepository` extends this trait.
Self-typing gives the extracted traits full access to `ctx`, `table`, `panelTable`, `permTable`, `dashTable`, and private helpers without argument threading.

**D3 — Service companion helpers → separate objects, with explicit visibility fixes.**
- `DashboardServiceValidation.scala`: `object DashboardServiceValidation` in `com.helio.services` package. Contains all static helpers. Methods currently `private[services]` keep that modifier. Methods currently `private` (scoped to the companion object — `applyUpdate` is instance method so stays; `normalizeAppearance`, `validateDashboardLayoutPayload`, `validateDashboardLayoutItems`) are widened to `private[services]` when moved so `DashboardService` can call them. `applyUpdate` is an instance method — it stays in `DashboardService` class body.
- `PanelServiceHelpers.scala`: `object PanelServiceHelpers` in `com.helio.services`. Contains all companion static helpers. `validatePanelTypeOpt` (currently `private`) is widened to `private[services]`. `resolveSingleBinding` and `authorizeEditorOnDashboard` are instance methods — they stay in `PanelService` class body. `DashboardService` companion then becomes a thin wrapper with `type CreateDashboardInput = ...` only (or collapses).
- Service classes import `DashboardServiceValidation._` / `PanelServiceHelpers._` at the top.

**D4 — `DashboardService` companion keeps `CreateDashboardInput` and `validateSnapshotPayload` only.**
The companion's public API (`CreateDashboardInput`, `validateSnapshotPayload`) is called from tests. It will forward to `DashboardServiceValidation.validateSnapshotPayload` so the external call path `DashboardService.validateSnapshotPayload(...)` keeps working.

## Risks / Trade-offs

- Self-type trait visibility: in Scala 2, private members are NOT accessible from a mixin trait even with self-typing. All members used by the extracted trait methods must be widened to `protected`. For `DashboardRepository`: `ctx` (constructor param), `table`, `rowToDomain`, `domainToRow`, `panelRowToDomain`. For `PanelRepository`: `ctx`, `table`, `rowToDomain`, `domainToRow`. Constructor params need `protected val ctx: DbContext` in the class signature.
- Tests for `DashboardService.validateSnapshotPayload`: currently called as `DashboardService.validateSnapshotPayload(...)`. The companion will keep a public forwarding def so this path is stable.

## Planner Notes

Self-approved. No new external dependencies, no API surface changes, no breaking contract changes, pure structural refactor within two packages. The Skeptic's design-gate concerns (CR1, CR2, CR3) are fully addressed: companion objects stay in place (CR1+CR2 resolved), and visibility of extracted private helpers is explicitly widened to `private[services]` (CR3 resolved).

## Migration Plan

1. Widen private row-mapper helpers in repos to `protected`
2. Create `DashboardSnapshotRepository.scala` trait; `DashboardRepository` extends it
3. Create `PanelMutationRepository.scala` trait; `PanelRepository` extends it
4. Trim `DashboardRepository` and `PanelRepository` of extracted methods
5. Create `DashboardServiceValidation.scala` with widened visibilities
6. Create `PanelServiceHelpers.scala` with widened visibilities
7. Update `DashboardService` and `PanelService` to use new objects
8. Run `sbt test` — 715/715 expected

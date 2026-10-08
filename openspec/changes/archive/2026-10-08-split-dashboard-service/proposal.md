## Why

`DashboardService.scala` is 473 lines at a256261dc (ticket said 431; HEL-1233 grew it), over CONTRIBUTING.md's
~400-line split trigger and the living `backend-file-size-compliance` spec's 300-line service budget. It mixes
dashboard CRUD/ACL with the layout-policy-aware update write path, the HEL-1233 repair write tail, and import-time
panel validation (HEL-1071's own split suggestion).

## What Changes

- Move each post-ACL concern into a collaborator in `com.helio.services.dashboards` (same package): the update
  layout-resolve + write path, the layout-repair write tail, the snapshot-import validation/write path, and (to reach
  the budget) the create insert helper.
- `DashboardService` keeps its name, constructor, every public/`private[services]` signature, its companion object,
  every access-helper call and every `ServiceError.Forbidden` producer, and delegates.
- Update `services/dashboards/README.md` "Holds" list.

## Non-goals

- No behaviour, route, message, ACL, audit, ordering or logging change; no bug fixes (findings become follow-ups).
- No test changes beyond import-only edits (target: none); no `ApiRoutes` wiring change; no edit to
  `ExistenceNotLeakedRoutesSpec` pins.
- Nothing moves into/out of `PanelService`, `OutputService`, `NodeSnapshotRepository`, `PipelineRunService`
  (HEL-1253/1187/1371 own those). `DashboardLayoutRepair.scala` and `DashboardServiceValidation.scala` are not edited.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — pure structural refactor (`skip_specs: true`).

## Impact

- `backend/src/main/scala/com/helio/services/dashboards/` only (one file split into several; README).
- No API, schema, migration or frontend impact.

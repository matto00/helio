## Why

`PanelService.scala` is 709 lines (ticket said ~730), far over CONTRIBUTING.md's
~400-line split trigger and 250-line soft budget. It mixes panel CRUD with file-attached form submission, create-time
build/validation, binding/ownership checks, post-ACL update validation, batch write pipelines and default sizing.

## What Changes

- Move each concern into its own module in `com.helio.services.panels` (same package): `ResolvedPanelPatch`, the
  file-attached form-submit helpers, binding checks + pure panel extractors + default sizing, create-time build
  (`buildForCreate`/`buildAllForCreate` bodies), the post-ACL update validation chain, and the post-ACL batch
  update/create pipelines.
- `PanelService` keeps its name, constructor and every public/`private[services]` signature, every ACL call and every
  `ServiceError.Forbidden` producer, and delegates to the modules.
- Update `services/panels/README.md` "Holds" list.

## Non-goals

- No behaviour, route, message, ACL, audit or logging change; no bug fixes; findings become follow-ups.
- No test changes beyond import-only edits (target: none). No change to `ApiRoutes` wiring.
- Nothing moves into or out of `DashboardService`/`OutputService`/`NodeSnapshotRepository`/`PipelineRunService`
  (HEL-1234, HEL-1187, HEL-1371 own those).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — pure structural refactor (`skip_specs: true`).

## Impact

- `backend/src/main/scala/com/helio/services/panels/` only (one file split into several; README).
- No API, schema, migration or frontend impact.

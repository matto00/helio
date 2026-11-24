## Why

A shared pipeline's schedule is invisible to its grantees: every schedule route gates on `findByIdOwned`, so a viewer
or editor sees "Add schedule" as if none existed, and an editor's save returns `404`. The owner ruled (2026-11-24)
**read all, owner writes**: grantees see the schedule read-only; only the pipeline owner creates, changes or deletes it.

## What Changes

- `GET /api/pipelines/:id/schedule` admits the owner and every editor/viewer grantee of that pipeline (sharing-aware
  check `findByIdShared`, the one the pipeline read routes use). A stranger or unknown id is still `404`.
- `PUT` and `DELETE /api/pipelines/:id/schedule` stay owner-only; a grantee gets the same `404` the neighbouring
  owner-only pipeline writes (rename, delete) give it today. No behaviour change for the owner.
- Pipeline page (desktop header, phone header, actions menus, schedule dialog, pause/resume): schedule write controls
  are offered to the pipeline owner only. A grantee sees a non-interactive, read-only schedule chip when a schedule
  exists and nothing when none exists (no "Add schedule").
- CLAUDE.md's schedule route line states the new access rule.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-schedule-crud-api`: GET admits editor/viewer grantees; PUT/DELETE stay owner-only, grantee answer stated.
- `pipeline-schedule-config-ui`: schedule write controls are owner-only; grantees get a read-only chip.

## Non-goals

- Editor writes to a schedule (ruled out by the owner).
- `GET /api/pipeline-schedules` (HEL-1574, the caller's own enabled schedules for Home and the context list) stays
  scoped to pipelines the caller owns.
- No RLS/Flyway change, no response-shape change, no helio-mcp code change.

## Impact

- Backend: `PipelineScheduleService`, `PipelineScheduleRepository` (one privileged read), their specs.
- Frontend: `SpineScheduleChip`, `PipelineSpineHeader`, `MobilePipelineHeader`, `PipelineDetailDialogs`,
  `usePipelineSourceScheduleActions`, their tests; one e2e spec.
- Docs: CLAUDE.md route line; `schemas/pipelines/pipeline-schedule.schema.json` description if it implies owner-only.

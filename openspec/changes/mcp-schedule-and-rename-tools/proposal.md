## Why

An agent asked for "dashboards that update daily" cannot deliver, verify, or even report failing to deliver that: the
MCP surface exposes no pipeline schedule at all, though `PipelineScheduleRoutes` has served `GET/PUT/DELETE
/api/pipelines/:id/schedule` since HEL-415. Separately, there is no dashboard rename tool, so a typo in a dashboard
name can only be fixed by delete + recreate, which changes the id and breaks saved links. Both are the same defect
shape — a backend capability the MCP surface never exposed — and this is epic HEL-857's last structural blocker
before the exit criterion (rebuild the four Sleeper dashboards from the live API with a daily refresh) is reachable.

## What Changes

- Add `get_pipeline_schedule`, `set_pipeline_schedule` and `delete_pipeline_schedule` MCP tools mapping 1:1 onto the
  existing `GET`/`PUT`/`DELETE /api/pipelines/:id/schedule` routes. `set_pipeline_schedule` is an upsert, matching the
  backend's `PUT`.
- Add an `update_dashboard` MCP tool mapping onto the existing `PATCH /api/dashboards/:id` `name` field, alongside the
  existing `update_data_source`/`update_pipeline` rename tools it mirrors. Name-only: `layout` already has its own
  tool, and dashboard `appearance` turns out to be unexposed over MCP entirely — a real gap, recorded for a spinoff
  rather than absorbed here.
- Add the corresponding `helioApi` client methods and wire response types.
- Determine empirically whether a dashboard name containing `&` acquires HTML entities anywhere on the agent path. Fix
  it here if the cause is in this repo's MCP layer; otherwise report the finding for a spinoff.
- No backend changes. If any prove necessary, that is called out explicitly rather than absorbed.

## Capabilities

### New Capabilities

- `mcp-pipeline-schedule-tools`: agent-facing read, upsert and delete of a pipeline's refresh schedule over MCP,
  including the exact accepted `kind`/`expression`/`timezone` grammar and the upsert's `nextRunAt` reset semantics.

### Modified Capabilities

- `mcp-edit-in-place-tools`: gains an `update_dashboard` rename requirement, so renaming a dashboard preserves its id
  and share links instead of requiring a lossy delete-and-recreate.

## Non-goals

- Any backend route, protocol, service or migration change.
- Exposing a schedule field on `create_pipeline` or on the pipeline proposal/apply surface — schedule stays its own
  sub-resource, exactly as the backend models it.
- Changing scheduler runtime behaviour (HEL-415), or the schedule's UI (`pipeline-schedule-config-ui`).
- Fixing the unanchored `testPathIgnorePatterns` worktree jest defect (filed separately as HEL-880).
- Broadening dashboard `PATCH` exposure beyond `name` (appearance and layout already have their own tools).

## Impact

- `helio-mcp/src/tools/write.ts` (four new tools), `helio-mcp/src/helioApi.ts` (four new client methods),
  `helio-mcp/src/types.ts` (schedule request/response wire types), plus their unit tests.
- Read path: agents gain the ability to verify a refresh cadence they configured, closing the epic's exit criterion.

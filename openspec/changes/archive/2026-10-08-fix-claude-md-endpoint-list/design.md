## Context

`CLAUDE.md` lines ~126-150 ("Key endpoints") are a hand-maintained summary of the route tree. The authenticated tree is
composed in `backend/src/main/scala/com/helio/api/ApiRoutes.scala` (~lines 781-950) from sub-routers under
`backend/src/main/scala/com/helio/api/routes/**`. Planning-time probes on main @42d2fbd16:

- `routes/sources/DataSourceRoutes.scala` `path(DataSourceIdSegment)` → `patch` + `delete` only. No other router mounts
  a bare `data-sources/:id` GET (`grep -rn DataSourceIdSegment` → only `/refresh`, `/preview` elsewhere).
- `routes/pipelines/PipelineScheduleRoutes.scala` has GET/PUT/DELETE, but the bullet's "No runtime firing yet — that's
  the sibling scheduler-runtime ticket (HEL-415)" looks stale: `PipelineSchedulerService.fire()` submits runs with
  `TriggerSource.Scheduled`, and `app/Main.scala` starts the scheduler. The executor must re-verify (tasks 1.6).

Router map (bullet → file to grep), all under `backend/src/main/scala/com/helio/api/routes/`:
dashboards → `dashboards/DashboardRoutes.scala`, `dashboards/DashboardSnapshotRoutes.scala`,
`dashboards/PublicDashboardRoutes.scala`; panels → `panels/PanelRoutes.scala`; outputs → `pipelines/OutputRoutes.scala`;
pipelines → `pipelines/PipelineRoutes.scala`, `pipelines/PipelineStepRoutes.scala`, `pipelines/PipelineShapeRoutes.scala`,
`pipelines/PipelineRun*Routes.scala` (run/status sub-routes); dashboard contents → `dashboards/DashboardContentsRoutes.scala`;
schedule → `pipelines/PipelineScheduleRoutes.scala`; data-sources → `sources/DataSourceRoutes.scala`,
`sources/DataSourcePreviewRoutes.scala`; authoring → `proposals/DashboardAuthoringRoutes.scala`; events →
`telemetry/ProductEventRoutes.scala`; first-run → `firstrun/FirstRunRoutes.scala`; admin → `admin/AdminUsageRoutes.scala`;
health → `HealthRoutes.scala`. This map is a starting point; if a path is not found there, grep the whole tree.

## Goals / Non-Goals

**Goals:** every method+path and every existence/negative claim in the "Key endpoints" list is true on the branch
head, each backed by a pasted grep (or live curl) in `evidence.md`.

**Non-Goals:** see proposal.md. Behavioral detail prose (status codes, limits, field shapes) is left as-is unless a
check made anyway directly contradicts it — then it is reported, not silently rewritten.

## Decisions

1. **No GET-by-id.** No consumer issues `GET /api/data-sources/:id`: `frontend/src/features/sources/services/
   dataSourceService.ts` uses list (`GET /api/data-sources`), `PATCH`, `DELETE`, and sub-routes; helio-mcp likewise.
   The list endpoint covers reads (`/:id/schema` is dataset-only — 400 for other kinds, `DataSourceService.getDatasetSchema`); helio-mcp's `listSourceObjects` finds one source by scanning
   the list. No OpenAPI/schema entry declares a GET-by-id. So docs are corrected; no follow-up ticket filed.
2. **Data-sources bullets shape.** Replace `GET/DELETE /api/data-sources/:id` with `PATCH/DELETE /api/data-sources/:id`
   (noting no GET-by-id exists), and add one bullet enumerating the existing sub-routes with methods. Keep
   `GET/POST /api/data-sources`. Ticket AC requires re-deriving the "whole data-sources section".
3. **Verification is mechanical, per line, before edit.** Grep evidence (route file + line numbers showing the
   `path(...)` and method directives) is primary; a live curl against the worktree backend (port 9607) is optional
   corroboration. Evidence must be pasted command + output, not a summary.
4. **Edit minimally.** Only lines that are false change; no reflow. `npx prettier --check CLAUDE.md` must pass after
   (it passes on main today), and `git diff --stat` must show only `CLAUDE.md` + the change dir.

## Risks / Trade-offs

- Route matching nuance (e.g. a path defined in two routers, or a `pathPrefix` composed from a parent) can make a single
  grep misleading → require reading the enclosing `pathPrefix` chain, and fall back to a whole-tree grep.
- A planner lead (schedule prose) could be wrong → executor verifies, never edits on the planner's say-so.

## Planner Notes

- Self-approved: documentation-only, no new dependency/API change; Decision 1 is the ticket's own delegated call.

## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `17f6c8457f0f25e808a7e03396c0f3ba6a59471d`; base resolved live via
`resolve-review-base.sh` → `42d2fbd16e4e7b30bd2b266e72616e9d00eb0425` (exit 0). Diff: `CLAUDE.md` (+3/-2) plus the
change dir only. No UI change, so no visual review or servers were needed.

### What I verified (with evidence)

Every sentence in the CLAUDE.md diff, checked against code myself:

- `GET/PUT/DELETE /api/pipelines/:id/schedule` — `routes/pipelines/PipelineScheduleRoutes.scala:24` pathPrefix,
  `:27` get, `:30` put, `:35` delete. TRUE.
- "Schedules fire on the scheduler tick (`PipelineSchedulerService`)" — `app/Main.scala` (~:293-304) constructs
  `PipelineSchedulerService` and unconditionally `context.spawn(PipelineSchedulerActor(...), "pipeline-scheduler")`.
  `PipelineSchedulerService.tick()` (:73) eventually calls `fire` (:208), which `.submit(..., triggerSource = TriggerSource.Scheduled)`
  (:230). TRUE. The removed "No runtime firing yet (HEL-415)" sentence was in fact stale. Removing it is correct.
- `PATCH/DELETE /api/data-sources/:id` — `routes/sources/DataSourceRoutes.scala:151` `path(DataSourceIdSegment)` →
  `:153` patch, `:158` delete, no get. The only other users of `DataSourceIdSegment` are `DataSourcePreviewRoutes` (`/refresh`, `/preview`) and
  `SourcePreviewRoutes`, which is under `pathPrefix("sources")` (:46). TRUE.
- Sub-route bullet: `csv-limits` GET (:109-110), `references` GET (:114-115), `:id/schema` GET/PATCH (:165-172),
  `:id/rows` GET/POST/PUT (:182-199), `:id/rows/aggregate` GET (:210-211), `:id/rows/:rowId` PATCH/DELETE (:220-227),
  `DataSourcePreviewRoutes.scala` `:id/refresh` POST (:50-51), `:id/preview` GET (:64-65), `infer` POST (:71-72). Both
  routers are mounted in the authenticated tree (`ApiRoutes.scala:905`, `:916`). The list is complete, with no missing
  or extra route. TRUE.
- **"no GET-by-id; use the list or `/:id/schema`"** — the "no GET-by-id" half is TRUE. The "`/:id/schema`" half is
  **misleading**. `DataSourceService.getDatasetSchema` (`services/sources/DataSourceService.scala:979-988`) returns
  data only for `DatasetSource`. Every other kind (CSV, REST, SQL, …; `domain/model/DataSource.scala:60` and the
  other `extends DataSource` cases) gets `400 "declared schema is only available for dataset sources"`. Most sources are not
  datasets, so a reader who follows this pointer to read a source by id will hit a 400. See CR 1.

AC 1 (re-derive the data-sources section and check the other bullets for drift): I independently re-grepped
DashboardRoutes, DashboardSnapshotRoutes, PublicDashboardRoutes, DashboardContentsRoutes, AutoLayoutRoutes,
DashboardProposalRoutes, PanelRoutes, OutputRoutes, PipelineRoutes, FirstRun, Authoring, ProductEvent, AdminUsage and
Health. Every method and path in the unchanged bullets matches. No authenticated `GET /api/dashboards/:id` and no
authenticated `dashboards/:id/panels` exist. The executor's `evidence.md` verdict table (one row per claim, with file:line)
is consistent with what I found. Met, apart from CR 1.

AC 2 (GET-by-id decision): design.md Decision 1 is "no GET-by-id, fix docs, no ticket". I checked it: the frontend
`dataSourceService.ts` uses list/PATCH/DELETE/sub-routes only, and helio-mcp `listSourceObjects`
(`helio-mcp/src/helioApi.ts:269-271`) scans the list. No consumer issues a GET on a bare `:id`. The decision is
sound. However, its stated rationale ("list plus `/:id/schema` cover reads") contains the same inaccuracy as CR 1.

Gates: `prettier --check CLAUDE.md` → "All matched files use Prettier code style!", exit 0. The diff touches only
`CLAUDE.md` and the change dir, and neither `~/CLAUDE.md` nor the env-var table was touched.

### Verdict: REFUTE

### Change Requests

1. `CLAUDE.md:145` — `— no GET-by-id; use the list or `/:id/schema`` points readers at a route that returns 400 for
   every non-dataset source (`DataSourceService.scala:987`). This is the same defect class this ticket exists to fix: a
   doc line that sends readers to a route that does not serve the stated use. Change it to something accurate, e.g.
   `— no GET-by-id; read a source via the list` (optionally adding "`/:id/schema` returns the declared schema of `dataset`
   sources only"). Make the matching correction to design.md Decision 1's rationale sentence. Re-run
   `prettier --check CLAUDE.md`.

### Non-blocking notes

- The evaluator flagged this line as "not a false claim". As guidance it is false for most source kinds, so it should
  not be treated as optional polish.

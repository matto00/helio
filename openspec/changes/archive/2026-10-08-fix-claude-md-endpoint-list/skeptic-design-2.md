## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 42d2fbd16e4e7b30bd2b266e72616e9d00eb0425 (change dir untracked: ticket.md, proposal.md, design.md,
tasks.md, workflow-state.md, skeptic-design-1.md).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=task/fix-claude-md-endpoint-list/hel-1268`.
- **Round-1 CR1 (proposal enumeration) resolved.** proposal.md "What Changes" no longer lists sub-routes; it defers to
  tasks 1.4 ("the set is derived in tasks.md 1.4, not here"). design.md Decision 2 likewise does not restate the set.
- **Round-1 CR2 (1.4 grep + acceptance signal) resolved.** I ran the exact 1.4 command fresh. Output covers every
  method directive in both files, including `DataSourcePreviewRoutes.scala:71-72` `path("infer")` → `post`. Full set:
  `GET csv-limits` (:109-110), `GET references` (:114-115), `GET/POST /` (:128-146), `PATCH/DELETE :id` (:151-158),
  `GET/PATCH :id/schema` (:165-172), `GET/POST/PUT :id/rows` (:182-199), `GET :id/rows/aggregate` (:210-211),
  `PATCH/DELETE :id/rows/:rowId` (:220-227), `POST :id/refresh` (Preview :50-51), `GET :id/preview` (Preview :64-65),
  `POST infer` (Preview :71-72). The task now has a pass condition: the bullets must list exactly these pairs, no more
  and no fewer.
- **Round-1 CR3 (schedule check) resolved.** I ran the new 1.6 commands fresh:
  `PipelineSchedulerService.scala:208 private def fire(...)` and `:230 .submit(schedule.pipelineId, ..., triggerSource = TriggerSource.Scheduled)`;
  `Main.scala:293 new PipelineSchedulerService(` and `:304 context.spawn(PipelineSchedulerActor(...), "pipeline-scheduler")`.
  These show the code call and the boot wiring, not just comments. 1.6a limits the permitted edit to two exact deletions
  plus one optional replacement sentence with fixed wording. Bullet 143 ("No runtime firing yet") is false on HEAD.
- **Core defect is real.** `DataSourceRoutes.scala:151` `path(DataSourceIdSegment)` mounts only `patch` (:153) and
  `delete` (:158). `grep -rn DataSourceIdSegment backend/src/main/scala` finds no other bare `:id` mount. The
  `SourcePreviewRoutes.scala:99/106` hits (refresh/preview) sit under `pathPrefix("sources")` (:46), so they are
  `/api/sources/...`, not data-sources. All three routers are mounted inside `pathPrefix("api")` (ApiRoutes.scala:782,
  905, 916, 918).
- **Decision 1 (no GET-by-id) is grounded.** I grepped fresh for bare `/api/data-sources/${id}` callers in frontend,
  helio-mcp and e2e. Hits are PATCH (`dataSourceService.ts:328`, `helioApi.ts:1090`) and DELETE (`dataSourceService.ts:227`,
  `helioApi.ts:1297`, every e2e hit). `helioApi.ts:275` is only the synthetic 404 message text inside the list-scan.
  No consumer needs a GET-by-id.
- **Other negative claims can be checked with the planned commands.** `grep -rn '"types"\|"metrics"' backend/src/main/scala/com/helio/api`
  returns no matches (exit 1), so the "now 404" claim holds. `DashboardRoutes.scala:95-105` `path(DashboardIdSegment)`
  mounts only `delete` and `patch`, and `PublicDashboardRoutes` only mounts `dashboards/<id>/panels/...` prefixes
  (:60). So "no authenticated GET /api/dashboards/:id" is true and 1.6's grep scope is enough.
- **Router map is complete enough.** Every file the design names exists (pipelines/PipelineRun{History,Latest,Status,Stream,Submit}Routes,
  PipelineShapeRoutes, PipelineStepRoutes, OutputRoutes, DashboardContentsRoutes, proposals/DashboardAuthoringRoutes,
  telemetry/ProductEventRoutes:28, firstrun/FirstRunRoutes:22-24, admin/AdminUsageRoutes:21-22, HealthRoutes:10).
  `"submit"` resolves to PanelRoutes, and `"history"` resolves to OutputRoutes and PublicDashboardRoutes.
- **Baseline capture is correct.** `grep -n "Key endpoints" -A26 CLAUDE.md` runs from :126 to :152 and covers every bullet
  (:128-:150, 23 bullets).
- **Scope matches the ticket and the driver notes.** The plan edits only the Key-endpoints list (2.4) and checks every
  bullet (1.2/1.3). It fixes false lines only (2.3), leaves the env table alone, and does not reflow. The prettier
  failure path escalates instead of running `--write` (3.1), and the diff-stat confines the change to CLAUDE.md plus the
  change dir (3.2). It never touches `~/CLAUDE.md`. Both ACs are covered: the full data-sources re-derivation and the
  GET-by-id decision.

### Verdict: CONFIRM

### Non-blocking notes

- tasks 1.3: add "verdict-line count == 23 (one per bullet in 1.1's baseline)". That gives the evaluator a mechanical
  completeness check.
- tasks 1.5: the output will include `SourcePreviewRoutes.scala:99/106` (refresh/preview). The executor should cite
  `SourcePreviewRoutes.scala:46 pathPrefix("sources")` so the reader sees they are `/api/sources/...`, and must not
  add them to the data-sources bullets (1.4's two-file scope already prevents this).
- 2.1 "noting no GET-by-id exists": keep the wording to what 1.4/1.5 prove (e.g. "no GET-by-id; use the list or
  `/:id/schema`").

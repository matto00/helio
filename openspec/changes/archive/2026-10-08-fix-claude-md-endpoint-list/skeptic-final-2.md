## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `eda098184386744968d3685cb48aa145ddea5d7a`. I resolved the base live with `resolve-review-base.sh`, which
returned `42d2fbd16e4e7b30bd2b266e72616e9d00eb0425` (exit 0). Outside the change dir, the branch diff touches only
`CLAUDE.md` (+3/-2). There is no UI change, so I skipped the visual review and did not start the servers.

### What I verified (with evidence, all derived cold from the tree)

I checked every sentence in the CLAUDE.md diff against the code:

- **`GET/PUT/DELETE /api/pipelines/:id/schedule` … (`PUT` upserts):** confirmed in `routes/pipelines/PipelineScheduleRoutes.scala`.
  - `:24` is `pathPrefix("pipelines" / PipelineIdSegment / "schedule")`, with get at `:27`, put at `:30` and delete at `:35`.
  - TRUE.
- **"Schedules fire on the scheduler tick (`PipelineSchedulerService`)":** confirmed. The full chain is:
  - `app/Main.scala:293-304` constructs the service and spawns `PipelineSchedulerActor` unconditionally.
  - `PipelineSchedulerService.tick()` (:73) runs `listTickCandidatesInternal`, then `processCandidate`, then `fireIfNotOverlapping` (:183/:191), then `fire` (:208).
  - `fire` calls `.submit(..., triggerSource = TriggerSource.Scheduled)` (:230).
  - TRUE. The old line "data model + CRUD only … No runtime firing yet (HEL-415)" was stale, so removing it is correct.
- **`PATCH/DELETE /api/data-sources/:id` — no GET-by-id:** confirmed.
  - `routes/sources/DataSourceRoutes.scala:151` `path(DataSourceIdSegment)` has only patch (:153) and delete (:158).
  - A whole-tree grep for `"data-sources"` finds only `DataSourceRoutes.scala` and `DataSourcePreviewRoutes.scala`, so no other router serves a bare-id GET.
  - TRUE.
- **"read a source via the list (`/:id/schema` returns the declared schema of `dataset` sources only)":** confirmed. `services/sources/DataSourceService.scala:979-988` `getDatasetSchema` returns a schema only for `DatasetSource`, and every other kind gets a 400 (:987). Round 1 CR 1 is fixed accurately, and design.md Decision 1 (:35) was corrected to match.
- **Sub-route bullet:** every route listed exists with exactly the listed methods.
  - In `DataSourceRoutes`:
    - csv-limits GET (:109-110) and references GET (:114-115)
    - `:id/schema` GET/PATCH (:165-172)
    - `:id/rows` GET/POST/PUT (:182-199)
    - `:id/rows/aggregate` GET (:210-211)
    - `:id/rows/:rowId` PATCH/DELETE (:220-227)
  - In `DataSourcePreviewRoutes`: `:id/refresh` POST (:50-51), `:id/preview` GET (:64-65) and `infer` POST (:71-72).
  - Both routers are mounted under `pathPrefix("api")` (`ApiRoutes.scala:782`, `:905`, `:916`).
  - No data-sources route is missing from the list and none is invented.

**AC 1 (re-derive the data-sources section, check other bullets for drift): MET.** I dumped the method/path directives of every router behind the other bullets and found no false line:
- Dashboards:
  - `DashboardRoutes`: GET/POST at the root, `:id/duplicate` POST, `:id/layout/repair` POST, `:id` PATCH/DELETE.
  - `DashboardSnapshotRoutes`: `:id/export` GET and `import` POST.
  - `PublicDashboardRoutes:60-63`: `dashboards/:id/panels`, plus `/:panelId/rows` and `/history` GET.
  - There is no authenticated GET on `dashboards/:id`.
- `PanelRoutes`: POST at the root, `:id` PATCH, `:id/duplicate` POST, `:id/submit` POST.
- `OutputRoutes`: `pipelines/:id/outputs` GET/POST, `outputs/:id` GET/PATCH/DELETE, `/rows`, `/history`, `/history/:uuid/rows`, and `outputs` GET.
- `PipelineRoutes`: GET/POST at the root and `:id/analyze` GET.
- Others:
  - `authoring/dashboard` POST
  - `events` POST
  - `first-run/dashboard` POST
  - `admin/usage` GET
  - `health` GET

**AC 2 (GET-by-id decision): MET and justified.**
- No consumer issues a GET-by-id. The frontend `dataSourceService.ts` only calls PATCH and DELETE on a bare `/api/data-sources/${id}` (:227, :328).
- The bare-id string in helio-mcp `helioApi.ts:275` is just an error message inside `listSourceObjects`, which scans the list; it does not make a request.
- `openspec/` and `schemas/` contain no `data-sources/{id}` GET entry, so not filing a follow-up ticket is reasonable.

**Gates and scope:**
- `prettier --check CLAUDE.md` printed "All matched files use Prettier code style!" (exit 0). I ran it with the main checkout's prettier binary on the worktree file, because the worktree has no `node_modules`.
- The env-var table was not touched and the file was not reflowed. `~/CLAUDE.md` is outside the repo and was not touched.

### Verdict: CONFIRM

### Non-blocking notes
- The "Key endpoints" list is still a summary, not a full listing. For example, `PATCH /api/dashboards/:id/update` and `DELETE /api/dashboards/:id` and `/api/panels/:id` are not listed. None of these omissions makes a false claim, and the ticket's defect class is false lines.

# Evidence: CLAUDE.md "Key endpoints" verification (HEL-1268)

Branch: task/fix-claude-md-endpoint-list/hel-1268 @ 42d2fbd16e4e7b30bd2b266e72616e9d00eb0425

Every section below is a verbatim command and its raw output (with exit code), captured BEFORE any
CLAUDE.md edit (standing constraint C1). Verdict table is at the end.

## 1.1 Baseline Key endpoints list (pre-edit CLAUDE.md)

```
$ grep -n "Key endpoints" -A26 CLAUDE.md
126:Key endpoints:
127-
128-- `GET/POST /api/dashboards`
129-- `PATCH /api/dashboards/:id` — updates appearance and/or layout
130-- `POST /api/dashboards/:id/duplicate`
131-- `GET /api/dashboards/:id/export` / `POST /api/dashboards/import` — export carries the dashboard's panels (there is no authenticated `GET /api/dashboards/:id`)
132-- `GET /api/dashboards/:id/panels` — **public/shared dashboards only** (`PublicDashboardRoutes`, optional-auth); not available on the authenticated route tree
133-- `GET /api/dashboards/:dashboardId/panels/:panelId/rows` — **public/shared dashboards only** (`PublicDashboardRoutes`, optional-auth), resolves `panel → output → node_snapshot`; see HEL-910
134-- `POST /api/dashboards/:id/layout/repair` — owner-only one-time repair of stored-bad (overlapping/out-of-bounds) layout breakpoints (HEL-1233): body is a bare `{lg?, md?, sm?, xs?}` layout patch, response the dashboard. `404` no access, `403` any non-owner (editors included), `400` if a replacement is invalid or would drop a live panel, `409` if the layout changed mid-request; a supplied breakpoint that is not stored-bad is ignored, and the write touches only `layout` (not `lastUpdated`). The web client sends it once when the owner opens a stored-bad dashboard. `POST /api/dashboards/import` now stores a bad breakpoint repaired instead of `400`
135-- `POST /api/panels` — requires `dashboardId` in body
136-- `PATCH /api/panels/:id` — updates appearance
137-- `POST /api/panels/:id/duplicate`
138-- `POST /api/panels/:id/submit` — a `form` panel's submit path (HEL-1087): appends one row to the panel's bound `dataset` source, `{"values": {"<sourceField>": <value>}}` only; `400` validation failures carry structured `fieldErrors: [{"field", "reason"}]` alongside `message`. A `control: "counter"` field (HEL-1089) accepts only a numeric `delta` for its `sourceField` — the appended row's `occurred_at` is always server-assigned (a client-supplied value is ignored) and `value`, if the bound dataset declares it, is a non-authoritative pass-through snapshot never read back by the server
139-- `GET/POST /api/pipelines/:id/outputs`, `GET/PATCH/DELETE /api/outputs/:id`, `GET /api/outputs/:id/rows` — latest materialized `node_snapshots` for that Output, `GET /api/outputs` — every Output the caller owns
140-- `GET /api/outputs/:id/history?limit=&since=` — an Output's recorded run history (newest first) plus the resolution of its `config.compare` (`previous_run | 1d | 7d | 30d | custom:<ISO-8601 duration>`, validated on every config write → `400`): `{current, baseline, delta, pct, availableFrom, sparkline[]}`. A window baseline is the nearest point at or before (latest point − window); none → `baseline: null` plus `availableFrom`. Thinning never deletes an Output's newest 101 history points, so `previous_run` is the literal previous run (and alert `previous`/`rolling_avg` baselines see the literal recent runs); a window baseline may be up to one thinning bucket (5 min / 1 h / 1 d by age) earlier than the exact target. `limit` 1..100 (default 30, never clamped); a non-grantee gets the same `404` as an unknown id (HEL-1273). `GET /api/dashboards/:dashboardId/panels/:panelId/history` is the public, allow-listed variant (summary only: no run ids, trigger sources or owner ids)
141-- `GET /api/outputs/:id/history/:point/rows` — the stored full row payload of one history point (HEL-1276): `{pointId, outputId, capturedAt, runId, triggerSource, rowCount, rows}`. Authenticated only, NEVER public (public history points carry no `id`/`hasPayload`). Authorized like `/history`; `404` for an unknown/inaccessible Output, a point of another Output, or a point with no payload. Payloads are written only for Outputs with `config.historyPayloads: true` (boolean, `400` otherwise) on beta/owner pipelines, within the row/byte caps; each authenticated history point carries `id` and `hasPayload`
142-- `GET/POST /api/pipelines` (single-call: source/steps/outputs in one request), `GET /api/pipelines/:id/analyze`, plus step/run/status sub-routes — pipelines are the only path that produces panel-bindable Outputs (source → pipeline → Output → panel); `/api/types` and `/api/metrics` were retired outright by the pipelines-and-outputs remodel (HEL-903/904) and now 404
143-- `GET/PUT/DELETE /api/pipelines/:id/schedule` — per-pipeline cron/interval schedule (data model + CRUD only; `PUT` upserts). No runtime firing yet — that's the sibling scheduler-runtime ticket (HEL-415)
144-- `GET/POST /api/data-sources`
145-- `GET/DELETE /api/data-sources/:id`
146-- `POST /api/authoring/dashboard` — NL goal → grounded, validated `DashboardProposal` (`?stream=true` for SSE progress). Never applies the proposal; reuses `DashboardProposalService.validate`. Degrades to `503` when `ANTHROPIC_API_KEY` is unset. See HEL-392.
147-- `POST /api/events` — first-party product telemetry (HEL-1208): authenticated, write-only (no read endpoint), batch of 1..25 `{event, properties?, occurredAt?}`; any unknown event/property, wrong value type, or client-posted `signup_completed` rejects the whole request with `400`. Own rate limit (`PRODUCT_EVENTS_RATE_LIMIT_PER_WINDOW`).
148-- `POST /api/first-run/dashboard` — deterministic zero-to-dashboard build (HEL-1209): `{sourceId}` of a caller-owned CSV source → rule-classified columns, a cast + shape-based pipeline (table always; time-series for date + numeric; top-n for category + numeric) applied and run, and a full-width dashboard. No Claude call, not tier-gated; rolls the pipeline back if the dashboard phase fails. The client then lands on the authenticated `/dashboards/:id` route.
149-- `GET /api/admin/usage?days=N` — owner-tier-only aggregate product-usage view (HEL-1211): reads the rollup tables only (never `product_events`), `403 TIER_FORBIDDEN` for free/beta, `400` for `days` outside 1..90 (never clamped); no user identifiers
150-- `GET /health`
151-
152-### Git conventions
[exit=0]
```

## 1.2 bullets 1-4 (dashboards): directive lines in DashboardRoutes.scala

```
$ grep -n 'pathPrefix\|pathEndOrSingleSlash\|path(\|get {\|post {\|patch {\|delete {' backend/src/main/scala/com/helio/api/routes/dashboards/DashboardRoutes.scala
30:    pathPrefix("dashboards") {
32:        pathEndOrSingleSlash {
34:            get {
46:            post {
71:        path(DashboardIdSegment / "duplicate") { dashboardId =>
72:          post {
81:        path(DashboardIdSegment / "layout" / "repair") { dashboardId =>
82:          post {
88:        path(DashboardIdSegment / "update") { dashboardId =>
89:          patch {
95:        path(DashboardIdSegment) { dashboardId =>
97:            delete {
100:            patch {
[exit=0]
```

## 1.2 bullets 3-4 (dashboards): directive lines in DashboardSnapshotRoutes.scala

```
$ grep -n 'pathPrefix\|path(\|get {\|post {' backend/src/main/scala/com/helio/api/routes/dashboards/DashboardSnapshotRoutes.scala
27:    pathPrefix("dashboards") {
29:        path(DashboardIdSegment / "export") { dashboardId =>
30:          get {
34:        path("import") {
35:          post {
[exit=0]
```

## 1.2 bullet 2 (PATCH :id) and bullet 4 no-GET-by-id: the path(DashboardIdSegment) block

```
$ sed -n '95,103p' backend/src/main/scala/com/helio/api/routes/dashboards/DashboardRoutes.scala
        path(DashboardIdSegment) { dashboardId =>
          concat(
            delete {
              ServiceResponse.runNoContent(dashboardService.delete(dashboardId, user))
            },
            patch {
              entity(as[UpdateDashboardRequest]) { request =>
                ServiceResponse.run(dashboardService.update(dashboardId, request, user))(DashboardResponse.fromDomain)
              }
[exit=0]
```

## 1.6 no GET on dashboards/:id: every DashboardIdSegment use in api/

```
$ grep -rn 'DashboardIdSegment' backend/src/main/scala/com/helio/api --include=*.scala
backend/src/main/scala/com/helio/api/protocols/IdParsing.scala:15:  val DashboardIdSegment: PathMatcher1[DashboardId]         = Segment.map(DashboardId(_))
backend/src/main/scala/com/helio/api/routes/panels/AutoLayoutRoutes.scala:9:import com.helio.api.protocols.IdParsing.DashboardIdSegment
backend/src/main/scala/com/helio/api/routes/panels/AutoLayoutRoutes.scala:30:      path(DashboardIdSegment / "auto-layout") { dashboardId =>
backend/src/main/scala/com/helio/api/routes/dashboards/DashboardSnapshotRoutes.scala:9:import com.helio.api.protocols.IdParsing.DashboardIdSegment
backend/src/main/scala/com/helio/api/routes/dashboards/DashboardSnapshotRoutes.scala:29:        path(DashboardIdSegment / "export") { dashboardId =>
backend/src/main/scala/com/helio/api/routes/dashboards/DashboardContentsRoutes.scala:9:import com.helio.api.protocols.IdParsing.DashboardIdSegment
backend/src/main/scala/com/helio/api/routes/dashboards/DashboardContentsRoutes.scala:30:      path(DashboardIdSegment / "contents") { dashboardId =>
backend/src/main/scala/com/helio/api/routes/dashboards/DashboardRoutes.scala:9:import com.helio.api.protocols.IdParsing.DashboardIdSegment
backend/src/main/scala/com/helio/api/routes/dashboards/DashboardRoutes.scala:71:        path(DashboardIdSegment / "duplicate") { dashboardId =>
backend/src/main/scala/com/helio/api/routes/dashboards/DashboardRoutes.scala:81:        path(DashboardIdSegment / "layout" / "repair") { dashboardId =>
backend/src/main/scala/com/helio/api/routes/dashboards/DashboardRoutes.scala:88:        path(DashboardIdSegment / "update") { dashboardId =>
backend/src/main/scala/com/helio/api/routes/dashboards/DashboardRoutes.scala:95:        path(DashboardIdSegment) { dashboardId =>
[exit=0]
```

## 1.6 no GET on dashboards/:id: every pathPrefix("dashboards") mount in api/

```
$ grep -rn 'pathPrefix("dashboards"' backend/src/main/scala/com/helio/api --include=*.scala
backend/src/main/scala/com/helio/api/routes/panels/AutoLayoutRoutes.scala:29:    pathPrefix("dashboards") {
backend/src/main/scala/com/helio/api/routes/proposals/DashboardProposalRoutes.scala:30:    pathPrefix("dashboards") {
backend/src/main/scala/com/helio/api/routes/auth/PermissionRoutes.scala:26:    pathPrefix("dashboards" / Segment / "permissions") { dashboardId =>
backend/src/main/scala/com/helio/api/routes/dashboards/DashboardSnapshotRoutes.scala:27:    pathPrefix("dashboards") {
backend/src/main/scala/com/helio/api/routes/dashboards/DashboardContentsRoutes.scala:29:    pathPrefix("dashboards") {
backend/src/main/scala/com/helio/api/routes/dashboards/DashboardRoutes.scala:30:    pathPrefix("dashboards") {
backend/src/main/scala/com/helio/api/routes/dashboards/ShareTokenRoutes.scala:25:    pathPrefix("dashboards" / Segment / "share-tokens") { dashboardId =>
backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala:60:    pathPrefix("dashboards" / Segment / "panels") { dashboardId =>
[exit=0]
```

## 1.2 bullet 4 export carries panels: DashboardSnapshotPayload fields

```
$ grep -n 'case class DashboardSnapshotPayload' -A4 backend/src/main/scala/com/helio/api/protocols/dashboards/DashboardProtocol.scala
108:final case class DashboardSnapshotPayload(
109-    version: Int,
110-    dashboard: DashboardSnapshotDashboardEntry,
111-    panels: Vector[DashboardSnapshotPanelEntry]
112-)
[exit=0]
```

## 1.2 bullets 5-6, 13, 14 (public): directive lines in PublicDashboardRoutes.scala

```
$ grep -n 'pathPrefix\|pathEndOrSingleSlash\|get {' backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala
60:    pathPrefix("dashboards" / Segment / "panels") { dashboardId =>
61:      pathPrefix(Segment / "rows") { panelId =>
62:        pathEndOrSingleSlash {
63:          get {
99:      pathPrefix(Segment / "filter-capabilities") { panelId =>
100:        pathEndOrSingleSlash {
101:          get {
116:      pathPrefix(Segment / "distinct-values") { panelId =>
117:        pathEndOrSingleSlash {
118:          get {
135:      pathPrefix(Segment / "output-meta") { panelId =>
136:        pathEndOrSingleSlash {
137:          get {
152:      pathPrefix(Segment / "history") { panelId =>
153:        pathEndOrSingleSlash {
154:          get {
173:      pathPrefix(Segment / "provenance") { panelId =>
174:        pathEndOrSingleSlash {
175:          get {
190:      pathEndOrSingleSlash {
191:        get {
[exit=0]
```

## 1.2 bullets 5-6, 13, 14 (public): mount is inside optionalAuthenticate, not authenticate

```
$ grep -n 'optionalAuthenticate\|authDirectives.authenticate\|new PublicDashboardRoutes' backend/src/main/scala/com/helio/api/ApiRoutes.scala
798:            // below (pathPrefix("auth") / optionalAuthenticate / authenticate).
805:            // was rejected (it left optionalAuthenticate's identical
815:              authDirectives.optionalAuthenticate { userOpt =>
817:                  new PublicDashboardRoutes(panelRepo, aclDirective, userOpt, outputRepo, Option(pipelineRepo), Some(nodeSnapshotRepo), provenanceServiceOpt, Some(outputHistoryService)).routes,
826:              authDirectives.authenticate { authenticatedUser =>
[exit=0]
```

## 1.2 bullet 14 never public: every "rows" literal in PublicDashboardRoutes.scala

```
$ grep -n '"rows"\|"history"' backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala
61:      pathPrefix(Segment / "rows") { panelId =>
152:      pathPrefix(Segment / "history") { panelId =>
[exit=0]
```

## 1.2 bullet 7 layout/repair route

```
$ sed -n '81,87p' backend/src/main/scala/com/helio/api/routes/dashboards/DashboardRoutes.scala
        path(DashboardIdSegment / "layout" / "repair") { dashboardId =>
          post {
            entity(as[DashboardLayoutPatchPayload]) { request =>
              ServiceResponse.run(dashboardService.repairLayout(dashboardId, request, user))(DashboardResponse.fromDomain)
            }
          }
        },
[exit=0]
```

## 1.2 bullets 8-11 (panels): directive lines in PanelRoutes.scala

```
$ grep -n 'pathPrefix\|path(\|pathEndOrSingleSlash\|post {\|patch {\|delete {' backend/src/main/scala/com/helio/api/routes/panels/PanelRoutes.scala
67:    pathPrefix("panels") {
69:        path("updateBatch") {
70:          post {
78:        // HEL-370: placed before `pathEndOrSingleSlash`/`path(PanelIdSegment)`,
81:        path("batch") {
82:          post {
90:        pathEndOrSingleSlash {
91:          post {
99:        path(PanelIdSegment) { panelId =>
101:            delete {
104:            patch {
114:        path(PanelIdSegment / "duplicate") { panelId =>
115:          post {
127:        path(PanelIdSegment / "submit") { panelId =>
128:          post {
[exit=0]
```

## 1.2 bullet 8 POST /api/panels: dashboardId required at service layer

```
$ grep -n 'dashboardId is required' -B4 backend/src/main/scala/com/helio/services/panels/PanelService.scala
246-      Future.successful(Left(ServiceError.BadRequest("panels must not be empty")))
247-    else
248-      request.dashboardId.map(_.trim).filter(_.nonEmpty) match {
249-        case None =>
250:          Future.successful(Left(ServiceError.BadRequest("dashboardId is required")))
[exit=0]
```

## 1.2 bullet 8 POST /api/panels: CreatePanelRequest.dashboardId is Option

```
$ grep -n 'dashboardId: Option' backend/src/main/scala/com/helio/api/protocols/panels/PanelProtocol.scala
73:    dashboardId: Option[String],
116:final case class CreatePanelsBatchRequest(dashboardId: Option[String], panels: Vector[CreatePanelBatchItem])
[exit=0]
```

## 1.2 bullets 12-14 (outputs): directive lines in OutputRoutes.scala

```
$ grep -n 'pathPrefix\|path(\|pathEnd\|get {\|post {\|patch {\|delete {' backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala
24: *  prefix) don't nest cleanly under one `pathPrefix`, so they're built as
58:    pathPrefix("pipelines" / PipelineIdSegment / "outputs") { pipelineId =>
59:      pathEndOrSingleSlash {
61:          get {
72:          post {
87:    pathPrefix("outputs" / OutputIdSegment) { outputId =>
89:        pathEndOrSingleSlash {
91:            get {
96:            patch {
103:            delete {
108:        path("panels") {
109:          get {
115:        path("history") {
116:          get {
130:        path("history" / JavaUUID / "rows") { pointId =>
131:          get {
137:        path("assertion-status") {
138:          get {
144:        path("filter-capabilities") {
145:          get {
154:        path("distinct-values") {
155:          get {
171:        path("rows") {
172:          get {
197:   *  matched FIRST (`pathEndOrSingleSlash` on the bare `outputs` prefix, before
201:    path("outputs") {
202:      pathEndOrSingleSlash {
203:        get {
[exit=0]
```

## 1.2 bullet 13 GET outputs/:id/history: route block

```
$ sed -n '115,117p' backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala
        path("history") {
          get {
            parameters("limit".optional, "since".optional) { (limitRaw, sinceRaw) =>
[exit=0]
```

## 1.2 bullet 14 GET outputs/:id/history/:point/rows: route block

```
$ sed -n '130,131p' backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala
        path("history" / JavaUUID / "rows") { pointId =>
          get {
[exit=0]
```

## 1.2 bullet 15 (pipelines): directive lines in PipelineRoutes.scala

```
$ grep -n 'pathPrefix\|pathEnd\|path(\|get {\|post {' backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRoutes.scala
23:    pathPrefix("pipelines") {
25:        pathEndOrSingleSlash {
27:            get {
32:            post {
45:        path("analyze-proposal") {
46:          post {
59:        path(PipelineIdSegment / "analyze") { pipelineId =>
60:          get {
69:        path(PipelineIdSegment / "capabilities") { pipelineId =>
70:          get {
78:        path(PipelineIdSegment / "validate-expression") { pipelineId =>
79:          post {
93:        path(PipelineIdSegment / "roots") { pipelineId =>
94:          post {
102:        path(PipelineIdSegment / "roots" / Segment) { (pipelineId, rootIdStr) =>
107:        path(PipelineIdSegment) { pipelineId =>
109:            get {
[exit=0]
```

## 1.2 bullet 15 single-call: CreatePipelineRequest fields

```
$ grep -n 'case class CreatePipelineRequest' -A7 backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala
78:final case class CreatePipelineRequest(
79-    name: String,
80-    roots: Vector[CreatePipelineRootRequest],
81-    tag: Option[String] = None,
82-    steps: Vector[CreatePipelineTransactionalStepRequest] = Vector.empty,
83-    outputs: Vector[CreatePipelineTransactionalOutputRequest] = Vector.empty
84-)
85-final case class UpdatePipelineRequest(name: String)
[exit=0]
```

## 1.2 bullet 15 single-call: CreatePipelineRootRequest carries sourceId

```
$ grep -n 'case class CreatePipelineRootRequest' -A3 backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala
63:final case class CreatePipelineRootRequest(
64-    sourceId: Option[String] = None,
65-    `type`: Option[String] = None,
66-    name: Option[String] = None,
[exit=0]
```

## 1.2 bullet 15 step sub-routes

```
$ grep -n 'pathPrefix\|path(\|get {\|post {\|put {\|patch {\|delete {' backend/src/main/scala/com/helio/api/routes/pipelines/PipelineStepRoutes.scala
21:    pathPrefix("pipelines" / PipelineIdSegment / "steps") { pipelineId =>
25:            get {
28:            post {
38:        path("order") {
39:          put {
47:    pathPrefix("pipeline-steps" / PipelineStepIdSegment) { stepId =>
51:            patch {
56:            delete {
63:        path("duplicate") {
64:          post {
[exit=0]
```

## 1.2 bullet 15 run/status sub-routes (all pipeline run route files)

```
$ grep -n 'pathPrefix\|path(' backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunStatusRoutes.scala backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunLatestRoutes.scala backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunHistoryRoutes.scala backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunStreamRoutes.scala backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunSubmitRoutes.scala
backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunStatusRoutes.scala:29:    pathPrefix("pipelines" / PipelineIdSegment) { pipelineId =>
backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunStatusRoutes.scala:31:        path("runs" / Segment) { runId =>
backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunStatusRoutes.scala:38:        path("steps" / Segment / "preview") { stepId =>
backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunStatusRoutes.scala:43:        path("preview") {
backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunLatestRoutes.scala:29: *  `PipelineRunStatusRoutes`'s `path("runs" / Segment)` wildcard in whichever `concat(...)`
backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunLatestRoutes.scala:41:    pathPrefix("pipelines" / PipelineIdSegment / "runs" / "latest") { pipelineId =>
backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunHistoryRoutes.scala:18:    pathPrefix("pipelines" / PipelineIdSegment / "run-history") { pipelineId =>
backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunStreamRoutes.scala:25:    pathPrefix("pipelines" / PipelineIdSegment / "run-events") { pipelineId =>
backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunSubmitRoutes.scala:23:    pathPrefix("pipelines" / PipelineIdSegment / "run") { pipelineId =>
[exit=0]
```

## 1.6 /api/types and /api/metrics absent: string literals under api/

```
$ grep -rn "\"types\"\|\"metrics\"" backend/src/main/scala/com/helio/api
[exit=1]
```

## 1.2 bullet 16 (schedule): directive lines in PipelineScheduleRoutes.scala

```
$ grep -n 'pathPrefix\|get {\|put {\|delete {' backend/src/main/scala/com/helio/api/routes/pipelines/PipelineScheduleRoutes.scala
24:    pathPrefix("pipelines" / PipelineIdSegment / "schedule") { pipelineId =>
27:          get {
30:          put {
35:          delete {
[exit=0]
```

## 1.2 bullet 16 PUT upserts: service comment

```
$ grep -n 'PUT is upsert' -A3 backend/src/main/scala/com/helio/services/pipelines/PipelineScheduleService.scala
56:            // PUT is upsert (create-or-replace): reuse an existing schedule's
57-            // id/createdAt/nextRunAt/lastRunAt so the repository's insertOrUpdate
58-            // resolves to an UPDATE on the same PK row rather than colliding
59-            // with the pipeline_id UNIQUE constraint via a fresh id.
[exit=0]
```

## 1.6 schedule firing (exact 1.6 command 1)

```
$ grep -n 'def fire\|\.submit(' backend/src/main/scala/com/helio/services/pipelines/PipelineSchedulerService.scala
139:  private def fireAutoRun(pipelineId: PipelineId): Future[Unit] =
152:          .submit(pipelineId, isDry = false, owner, triggerSource = TriggerSource.AutoRun)
191:  private def fireIfNotOverlapping(schedule: PipelineSchedule, now: Instant): Future[Unit] = {
208:  private def fire(schedule: PipelineSchedule, now: Instant): Future[Unit] =
230:          .submit(schedule.pipelineId, isDry = false, owner, triggerSource = TriggerSource.Scheduled)
[exit=0]
```

## 1.6 schedule firing (exact 1.6 command 2)

```
$ grep -n 'PipelineSchedulerService\|PipelineSchedulerActor' backend/src/main/scala/com/helio/app/Main.scala
31:import com.helio.services.pipelines.{OutputHistoryRetentionConfig, OutputHistoryRetentionService, PipelineSchedulerService}
143:      // and PipelineSchedulerService (cleanupOldWindows piggybacked on its tick cadence) below --
148:      // PipelineSchedulerService (the claim-and-fire tick pass) below -- mirrors
293:      val pipelineSchedulerService = new PipelineSchedulerService(
304:      context.spawn(PipelineSchedulerActor(pipelineSchedulerService, schedulerTickInterval), "pipeline-scheduler")
[exit=0]
```

## 1.6 scheduler spawn is unconditional in Main

```
$ sed -n '302,305p' backend/src/main/scala/com/helio/app/Main.scala
        outputHistoryRetentionService = outputHistoryRetentionService
      )
      context.spawn(PipelineSchedulerActor(pipelineSchedulerService, schedulerTickInterval), "pipeline-scheduler")

[exit=0]
```

## 1.6 fire() submits with TriggerSource.Scheduled

```
$ sed -n '208,232p' backend/src/main/scala/com/helio/services/pipelines/PipelineSchedulerService.scala
  private def fire(schedule: PipelineSchedule, now: Instant): Future[Unit] =
    pipelineRepo.findByIdInternal(schedule.pipelineId).flatMap {
      case None =>
        // Pipeline was deleted after the schedule was created (no FK-cascade
        // race window in practice — V62's FK cascades the delete — but
        // defensive against any future change to that constraint). Recompute
        // forward so a stale row doesn't re-appear as a tick candidate every
        // tick; do not fire.
        log.warn("Scheduled pipeline {} not found — skipping fire and recomputing next_run_at", schedule.pipelineId.value)
        recomputeOnly(schedule, now)
      case Some(pipeline) =>
        // HEL-483 design.md Decision 6: explicit source=System (not the
        // AuthenticatedUser default of Ui) — this is a cron-fired run, not a
        // browser-attributed action.
        val owner = AuthenticatedUser(pipeline.ownerId, source = AuditSource.System, tokenId = None)
        // PipelineRunService.submit's own executeRun already records a
        // pipeline-execution failure in run history (its Failure branch
        // returns a successful Future carrying Left(...)) — this `recover`
        // only guards tick() against an unexpected exception outside that
        // path (e.g. a pre-submit DB lookup failure), so bookkeeping below
        // still runs either way.
        pipelineRunService
          .submit(schedule.pipelineId, isDry = false, owner, triggerSource = TriggerSource.Scheduled)
          .transform {
            case Success(result) => Success(result)
[exit=0]
```

## 1.4 bullets 17-18 (data-sources): directive lines (see 1.4 block above)

```
$ grep -n 'path\|pathPrefix\|get {\|post {\|put {\|patch {\|delete {\|infer' backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:37:  // URL path, so the multipart route check and the URL paths cannot silently diverge.
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:53:   *  `ServiceError.PayloadTooLarge`) is the one guaranteed path for both
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:65:   *  (via `ServiceError.PayloadTooLarge`) is the one guaranteed path for both
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:107:    pathPrefix("data-sources") {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:109:        path("csv-limits") {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:110:          get {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:114:        path("references") {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:115:          get {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:128:        pathEndOrSingleSlash {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:130:            get {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:146:            post {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:151:        path(DataSourceIdSegment) { sourceId =>
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:153:            patch {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:158:            delete {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:164:        // rate-limit/auth composition as every other route in this pathPrefix, no new wiring.
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:165:        path(DataSourceIdSegment / "schema") { sourceId =>
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:167:            get {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:172:            patch {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:182:        path(DataSourceIdSegment / "rows") { sourceId =>
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:189:            get {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:194:            post {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:199:            put {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:208:        // literal path segment "aggregate" as if it were a row id (Pekko HTTP tries `concat`
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:210:        path(DataSourceIdSegment / "rows" / "aggregate") { sourceId =>
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:211:          get {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:219:        // composition as the sibling `rows` path above -- no new wiring needed.
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:220:        path(DataSourceIdSegment / "rows" / Segment) { (sourceId, rowId) =>
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:222:            patch {
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:227:            delete {
backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala:21: *  `/api/data-sources/infer`. All logic lives in [[DataSourceService]].
backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala:25: *  doc -- applied INSIDE `pathPrefix("data-sources")`, never wrapped externally, so an unrelated
backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala:47:    pathPrefix("data-sources") {
backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala:50:        path(DataSourceIdSegment / "refresh") { sourceId =>
backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala:51:          post {
backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala:54:            // the bodyless CSV path. The service decides what to do based on
backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala:64:        path(DataSourceIdSegment / "preview") { sourceId =>
backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala:65:          get {
backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala:71:        path("infer") {
backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala:72:          post {
backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala:85:                    dataSourceService.infer(bytes) match {
[exit=0]
```

## 1.4 bullet 18 path(DataSourceIdSegment) block

```
$ sed -n '151,163p' backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala
        path(DataSourceIdSegment) { sourceId =>
          concat(
            patch {
              entity(as[UpdateDataSourceRequest]) { req =>
                ServiceResponse.run(dataSourceService.update(sourceId, req, user))(DataSourceResponse.fromDomain)
              }
            },
            delete {
              completeDelete(dataSourceService.delete(sourceId, user))
            }
          )
        },
        // HEL-1122 design.md Decision 1: additive, read-only declared-schema route -- same
[exit=0]
```

## 1.5 DataSourceIdSegment users across backend/src/main/scala

```
$ grep -rn "DataSourceIdSegment" backend/src/main/scala
backend/src/main/scala/com/helio/api/protocols/IdParsing.scala:17:  val DataSourceIdSegment: PathMatcher1[DataSourceId]       = Segment.map(DataSourceId(_))
backend/src/main/scala/com/helio/api/routes/sources/SourcePreviewRoutes.scala:10:import com.helio.api.protocols.IdParsing.DataSourceIdSegment
backend/src/main/scala/com/helio/api/routes/sources/SourcePreviewRoutes.scala:99:        path(DataSourceIdSegment / "refresh") { id =>
backend/src/main/scala/com/helio/api/routes/sources/SourcePreviewRoutes.scala:106:        path(DataSourceIdSegment / "preview") { id =>
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:12:import com.helio.api.protocols.IdParsing.DataSourceIdSegment
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:151:        path(DataSourceIdSegment) { sourceId =>
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:165:        path(DataSourceIdSegment / "schema") { sourceId =>
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:182:        path(DataSourceIdSegment / "rows") { sourceId =>
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:210:        path(DataSourceIdSegment / "rows" / "aggregate") { sourceId =>
backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala:220:        path(DataSourceIdSegment / "rows" / Segment) { (sourceId, rowId) =>
backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala:12:import com.helio.api.protocols.IdParsing.DataSourceIdSegment
backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala:50:        path(DataSourceIdSegment / "refresh") { sourceId =>
backend/src/main/scala/com/helio/api/routes/sources/DataSourcePreviewRoutes.scala:64:        path(DataSourceIdSegment / "preview") { sourceId =>
[exit=0]
```

## 1.5 SourcePreviewRoutes is pathPrefix(sources), not data-sources

```
$ grep -n 'pathPrefix' backend/src/main/scala/com/helio/api/routes/sources/SourcePreviewRoutes.scala
23: *  compiling): the tighter per-user source-fetch limit is applied INSIDE `pathPrefix("sources")`
27: *  own `pathPrefix` ultimately rejects (e.g. `/api/pipelines/...` falling through toward
46:    pathPrefix("sources") {
[exit=0]
```

## 1.5 SourcePreviewRoutes refresh/preview hits

```
$ sed -n '99,107p' backend/src/main/scala/com/helio/api/routes/sources/SourcePreviewRoutes.scala
        path(DataSourceIdSegment / "refresh") { id =>
          post {
            // HEL-904: `refresh` now returns the `DataSource` itself (its `inferredSchema`
            // column carries the re-inferred fields) — there is no companion `DataType`.
            ServiceResponse.run(sourceService.refresh(id, user))(DataSourceResponse.fromDomain)
          }
        },
        path(DataSourceIdSegment / "preview") { id =>
          get {
[exit=0]
```

## 1.4 data-sources mounts in ApiRoutes (authenticated tree)

```
$ grep -n 'new DataSourceRoutes\|new DataSourcePreviewRoutes\|new SourcePreviewRoutes' backend/src/main/scala/com/helio/api/ApiRoutes.scala
905:                  new DataSourceRoutes(dataSourceService, authenticatedUser, Some(csvUploadGate)).routes,
916:                  new DataSourcePreviewRoutes(dataSourceService, authenticatedUser, sourceFetchRateLimitDirective, pipelineRunGuardConfig.sourceFetchRateLimitPerWindow, Some(csvUploadGate)).routes,
918:                  new SourcePreviewRoutes(sourceService, authenticatedUser, sourceFetchRateLimitDirective, pipelineRunGuardConfig.sourceFetchRateLimitPerWindow).routes,
[exit=0]
```

## 1.2 bullet 19 (authoring): route block

```
$ sed -n '88,96p' backend/src/main/scala/com/helio/api/routes/proposals/DashboardAuthoringRoutes.scala
    pathPrefix("authoring") {
      concat(
        pathPrefix("dashboard") {
          pathEndOrSingleSlash {
            post {
              serviceOpt.fold(unavailable) { service =>
                entity(as[DashboardAuthoringRequest]) { request =>
                  parameters("stream".as[Boolean].optional) { streamOpt =>
                    // HEL-401 design.md D3: captured HERE, synchronously, on the route-evaluation
[exit=0]
```

## 1.2 bullet 20 (events): route block

```
$ sed -n '27,32p' backend/src/main/scala/com/helio/api/routes/telemetry/ProductEventRoutes.scala
  val routes: Route =
    pathPrefix("events") {
      pathEndOrSingleSlash {
        post {
          rateLimitDirective.rateLimit(rateLimitPerWindow) {
            entity(as[JsValue]) { body =>
[exit=0]
```

## 1.2 bullet 21 (first-run): route block

```
$ sed -n '21,27p' backend/src/main/scala/com/helio/api/routes/firstrun/FirstRunRoutes.scala
  val routes: Route =
    pathPrefix("first-run") {
      concat(
        path("dashboard") {
          post {
            entity(as[FirstRunDashboardRequest]) { req =>
              ServiceResponse.run(service.build(DataSourceId(req.sourceId), user))(StatusCodes.Created -> _)
[exit=0]
```

## 1.2 bullet 22 (admin usage): route block

```
$ sed -n '20,25p' backend/src/main/scala/com/helio/api/routes/admin/AdminUsageRoutes.scala
  val routes: Route =
    pathPrefix("admin") {
      path("usage") {
        get {
          parameter("days".optional) { rawDays =>
            onSuccess(access.guardOwner(user)) {
[exit=0]
```

## 1.2 bullet 23 (health): route block

```
$ sed -n '9,14p' backend/src/main/scala/com/helio/api/routes/HealthRoutes.scala
  val routes: Route =
    path("health") {
      get {
        complete(HealthResponse(status = "ok"))
      }
    }
[exit=0]
```

## 1.2 bullet 23 (health): mounted outside pathPrefix("api")

```
$ sed -n '779,783p' backend/src/main/scala/com/helio/api/ApiRoutes.scala
      handleRejections(TopLevelErrorHandlers.topLevelRejectionHandler) {
      traceContext.withTraceContext {
      health.routes ~
        pathPrefix("api") {
          // HEL-287 D4: custom-header CSRF check for every non-GET request
[exit=0]
```

## 1.2 bullet 5 not on authenticated tree: every "panels" literal under api/ (path-level)

```
$ grep -rn "\"panels\"" backend/src/main/scala/com/helio/api/routes --include=*.scala
backend/src/main/scala/com/helio/api/routes/panels/PanelRoutes.scala:67:    pathPrefix("panels") {
backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala:108:        path("panels") {
backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala:60:    pathPrefix("dashboards" / Segment / "panels") { dashboardId =>
[exit=0]
```

## 1.2 bullets 15-16 schedule tick: fireIfNotOverlapping call site in tick pass

```
$ grep -n 'fireIfNotOverlapping\|fireAutoRun\|def tick\|def runTick\|def fire' backend/src/main/scala/com/helio/services/pipelines/PipelineSchedulerService.scala
73:  def tick(): Future[Unit] = {
126:   *  consideration `fireIfNotOverlapping` already applies to scheduled fires, design.md Decision
136:        fireAutoRun(pipelineId).flatMap { _ => autoRunDebounceRepo.releaseClaim(pipelineId, claimedAt) }
139:  private def fireAutoRun(pipelineId: PipelineId): Future[Unit] =
183:      case Some(_) => fireIfNotOverlapping(schedule, now)
191:  private def fireIfNotOverlapping(schedule: PipelineSchedule, now: Instant): Future[Unit] = {
208:  private def fire(schedule: PipelineSchedule, now: Instant): Future[Unit] =
[exit=0]
```

## 1.2 bullets 19-23 authenticated mounts in ApiRoutes (authenticate block)

```
$ grep -n 'authDirectives.authenticate\|new ProductEventRoutes\|new AdminUsageRoutes\|new FirstRunRoutes\|new DashboardAuthoringRoutes' backend/src/main/scala/com/helio/api/ApiRoutes.scala
826:              authDirectives.authenticate { authenticatedUser =>
947:                  new FirstRunRoutes(firstRunDashboardService, authenticatedUser).routes,
990:                  new DashboardAuthoringRoutes(dashboardAuthoringServiceOpt, authenticatedUser, Some(chatAccessService)).routes,
1012:                  new ProductEventRoutes(productEventService, authenticatedUser, productEventsRateLimitDirective, productTelemetryConfig.rateLimitPerWindow).routes,
1014:                  new AdminUsageRoutes(adminAccessService, adminUsageService, authenticatedUser).routes
[exit=0]
```

## 1.6 scheduler tick body: tick() reaches the due-schedule fire path (line 183)

```
$ sed -n '73,90p;172,186p' backend/src/main/scala/com/helio/services/pipelines/PipelineSchedulerService.scala
  def tick(): Future[Unit] = {
    val now = clock.now()
    val candidatesWork = scheduleRepo.listTickCandidatesInternal(now).flatMap { candidates =>
      Future.traverse(candidates)(candidate => processCandidate(candidate, now)).map(_ => ())
    }
    // HEL-505 (design.md Decision 2, C3): the pipeline-run rate-limit table's bounded cleanup,
    // piggybacked on this existing tick cadence -- run concurrently with candidate processing (an
    // unrelated table, no ordering dependency) and never allowed to fail the tick itself.
    val cleanupWork =
      if (pipelineRunGuardRepo != null)
        pipelineRunGuardRepo.cleanupOldWindows().recover { case ex =>
          log.error("PipelineSchedulerService: pipeline_run_rate_window cleanup failed", ex)
          0
        }
      else Future.successful(0)
    // HEL-1093 (design.md Decision 3): the auto-run debounce claim-and-fire pass, run
    // concurrently with the two existing pieces of work above (an unrelated table, no ordering
    // dependency) and never allowed to fail the tick itself.

  private def processOne(schedule: PipelineSchedule, now: Instant): Future[Unit] =
    schedule.nextRunAt match {
      // Never-yet-computed (fresh `put`, or a pre-existing row on first
      // deploy of this change): compute forward from `now` and persist —
      // do not fire. This is the "skip missed, run next due" catch-up
      // policy: only one scalar `nextRunAt` is stored, so there is no
      // backlog to replay (design.md Decision 2).
      case None => recomputeOnly(schedule, now)
      // Actually due (on time, or overdue from downtime) — fire once,
      // guarded against overlap.
      case Some(_) => fireIfNotOverlapping(schedule, now)
    }

  private def recomputeOnly(schedule: PipelineSchedule, now: Instant): Future[Unit] = {
[exit=0]
```

## 1.6 scheduler tick chain link: processCandidate calls processOne

```
$ grep -n "processCandidate\|processOne(" backend/src/main/scala/com/helio/services/pipelines/PipelineSchedulerService.scala
76:      Future.traverse(candidates)(candidate => processCandidate(candidate, now)).map(_ => ())
167:  private def processCandidate(schedule: PipelineSchedule, now: Instant): Future[Unit] =
168:    processOne(schedule, now).recover { case ex =>
173:  private def processOne(schedule: PipelineSchedule, now: Instant): Future[Unit] =
[exit=0]
```

---

# Verdict table (task 1.3)

Format: `CLAIM: <text> | VERDICT: TRUE/FALSE | PROOF: <file:line>`. Paths are relative to `backend/src/main/scala/com/helio/api/routes/`
unless absolute-from-repo is shown. "Behavioral prose" = status codes, limits, field shapes, and similar detail that the ticket's
non-goals exclude; it is listed so the reader knows it was NOT verified and was left untouched.

Bullet 1 (line 128)
CLAIM: `GET/POST /api/dashboards` | VERDICT: TRUE | PROOF: dashboards/DashboardRoutes.scala:30 pathPrefix("dashboards"), :32 pathEndOrSingleSlash, :34 get, :46 post

Bullet 2 (line 129)
CLAIM: `PATCH /api/dashboards/:id` | VERDICT: TRUE | PROOF: dashboards/DashboardRoutes.scala:95 path(DashboardIdSegment), :100 patch

Bullet 3 (line 130)
CLAIM: `POST /api/dashboards/:id/duplicate` | VERDICT: TRUE | PROOF: dashboards/DashboardRoutes.scala:71 path(DashboardIdSegment / "duplicate"), :72 post

Bullet 4 (line 131)
CLAIM: `GET /api/dashboards/:id/export` / `POST /api/dashboards/import` | VERDICT: TRUE | PROOF: dashboards/DashboardSnapshotRoutes.scala:29-30 export get; :34-35 import post
CLAIM: export "carries the dashboard's panels" | VERDICT: TRUE | PROOF: api/protocols/dashboards/DashboardProtocol.scala:108-112 DashboardSnapshotPayload has `panels`
CLAIM: "there is no authenticated `GET /api/dashboards/:id`" | VERDICT: TRUE | PROOF: dashboards/DashboardRoutes.scala:95-102 path(DashboardIdSegment) carries delete+patch only; the 1.6 DashboardIdSegment sweep has no GET on bare :id

Bullet 5 (line 132)
CLAIM: `GET /api/dashboards/:id/panels` public/shared, optional-auth, not on authenticated tree | VERDICT: TRUE | PROOF: dashboards/PublicDashboardRoutes.scala:60 pathPrefix("dashboards" / Segment / "panels"), :190-191 pathEndOrSingleSlash get; ApiRoutes.scala:815-817 optionalAuthenticate wraps new PublicDashboardRoutes; the "panels" literal sweep shows no authenticated dashboards/:id/panels route

Bullet 6 (line 133)
CLAIM: `GET /api/dashboards/:dashboardId/panels/:panelId/rows` public, optional-auth | VERDICT: TRUE | PROOF: dashboards/PublicDashboardRoutes.scala:60-63 (pathPrefix panels / Segment / "rows", pathEndOrSingleSlash, get); mount ApiRoutes.scala:815-817
  (behavioral prose "resolves panel → output → node_snapshot" NOT verified, left as-is)

Bullet 7 (line 134)
CLAIM: `POST /api/dashboards/:id/layout/repair` | VERDICT: TRUE | PROOF: dashboards/DashboardRoutes.scala:81-82 path(DashboardIdSegment / "layout" / "repair"), post
  (status-code and field-level behavior NOT verified, left as-is)

Bullet 8 (line 135)
CLAIM: `POST /api/panels` | VERDICT: TRUE | PROOF: panels/PanelRoutes.scala:90-91 pathEndOrSingleSlash post (under pathPrefix("panels") :67)
CLAIM: "requires `dashboardId` in body" | VERDICT: TRUE | PROOF: services/panels/PanelService.scala:248-250 `dashboardId is required` BadRequest; protocols/panels/PanelProtocol.scala:73 dashboardId is Option (enforced in the service, not the decoder)

Bullet 9 (line 136)
CLAIM: `PATCH /api/panels/:id` | VERDICT: TRUE | PROOF: panels/PanelRoutes.scala:99 path(PanelIdSegment), :104 patch

Bullet 10 (line 137)
CLAIM: `POST /api/panels/:id/duplicate` | VERDICT: TRUE | PROOF: panels/PanelRoutes.scala:114-115 path(PanelIdSegment / "duplicate"), post

Bullet 11 (line 138)
CLAIM: `POST /api/panels/:id/submit` | VERDICT: TRUE | PROOF: panels/PanelRoutes.scala:127-128 path(PanelIdSegment / "submit"), post
  (counter/fieldErrors behavior NOT verified, left as-is)

Bullet 12 (line 139)
CLAIM: `GET/POST /api/pipelines/:id/outputs` | VERDICT: TRUE | PROOF: pipelines/OutputRoutes.scala:58 pathPrefix("pipelines" / PipelineIdSegment / "outputs"), :61 get, :72 post
CLAIM: `GET/PATCH/DELETE /api/outputs/:id` | VERDICT: TRUE | PROOF: pipelines/OutputRoutes.scala:87 pathPrefix("outputs" / OutputIdSegment), :91 get, :96 patch, :103 delete
CLAIM: `GET /api/outputs/:id/rows` | VERDICT: TRUE | PROOF: pipelines/OutputRoutes.scala:171-172 path("rows"), get (under :87 prefix)
CLAIM: `GET /api/outputs` | VERDICT: TRUE | PROOF: pipelines/OutputRoutes.scala:201-203 path("outputs"), pathEndOrSingleSlash, get
  ("latest materialized node_snapshots" NOT verified, left as-is)

Bullet 13 (line 140)
CLAIM: `GET /api/outputs/:id/history?limit=&since=` | VERDICT: TRUE | PROOF: pipelines/OutputRoutes.scala:115-117 path("history"), get, parameters("limit", "since")
CLAIM: public variant `GET /api/dashboards/:dashboardId/panels/:panelId/history` | VERDICT: TRUE | PROOF: dashboards/PublicDashboardRoutes.scala:152-154 pathPrefix(Segment / "history"), pathEndOrSingleSlash, get (under :60 prefix)
  (limit range, compare-resolution, thinning and 404 behavior NOT verified, left as-is)

Bullet 14 (line 141)
CLAIM: `GET /api/outputs/:id/history/:point/rows` | VERDICT: TRUE | PROOF: pipelines/OutputRoutes.scala:130-131 path("history" / JavaUUID / "rows"), get
CLAIM: "Authenticated only, NEVER public" | VERDICT: TRUE | PROOF: PublicDashboardRoutes.scala has no history/:point/rows route; its only "rows" literal is :61 (panel rows), its only "history" literal is :152 (panel summary); mount is optionalAuthenticate (ApiRoutes.scala:815-817) while OutputRoutes is mounted under authenticate (ApiRoutes.scala:826 onward)
  (payload-write rules, 400/404 detail NOT verified, left as-is)

Bullet 15 (line 142)
CLAIM: `GET/POST /api/pipelines` | VERDICT: TRUE | PROOF: pipelines/PipelineRoutes.scala:23 pathPrefix("pipelines"), :25 pathEndOrSingleSlash, :27 get, :32 post
CLAIM: "single-call: source/steps/outputs in one request" | VERDICT: TRUE | PROOF: api/protocols/pipelines/PipelineProtocol.scala:78-84 CreatePipelineRequest has roots (each with sourceId, :63-64), steps, outputs
  (naming note: the request key is `roots`; each root carries a sourceId. Wording left as-is, which is consistent with the proof.)
CLAIM: `GET /api/pipelines/:id/analyze` | VERDICT: TRUE | PROOF: pipelines/PipelineRoutes.scala:59-60 path(PipelineIdSegment / "analyze"), get
CLAIM: "plus step/run/status sub-routes" | VERDICT: TRUE | PROOF: pipelines/PipelineStepRoutes.scala:21 pathPrefix("pipelines" / PipelineIdSegment / "steps"); PipelineRunStatusRoutes.scala:29-31 runs/:id; PipelineRunLatestRoutes.scala:41; PipelineRunHistoryRoutes.scala:18; PipelineRunStreamRoutes.scala:25; PipelineRunSubmitRoutes.scala:23
CLAIM: "`/api/types` and `/api/metrics` ... now 404" | VERDICT: TRUE (absence) | PROOF: 1.6 sweep `grep -rn "\"types\"\|\"metrics\"" backend/src/main/scala/com/helio/api` returns no match (exit=1). The 404 status itself was NOT live-curled (1.7 optional, not run).

Bullet 16 (line 143)
CLAIM: `GET/PUT/DELETE /api/pipelines/:id/schedule` | VERDICT: TRUE | PROOF: pipelines/PipelineScheduleRoutes.scala:24 pathPrefix("pipelines" / PipelineIdSegment / "schedule"), :27 get, :30 put, :35 delete
CLAIM: "`PUT` upserts" | VERDICT: TRUE | PROOF: services/pipelines/PipelineScheduleService.scala:56-59 "PUT is upsert (create-or-replace)"
CLAIM: "data model + CRUD only" | VERDICT: FALSE | PROOF: schedule runs fire. tick() (PipelineSchedulerService.scala:73-76) → processCandidate (:167) → processOne (:173) → `Some(_) => fireIfNotOverlapping` (:183) → fireIfNotOverlapping (:191) → fire (:208) → `.submit(schedule.pipelineId, isDry = false, owner, triggerSource = TriggerSource.Scheduled)` (:230). Main.scala:293-304 constructs PipelineSchedulerService and `context.spawn(PipelineSchedulerActor(...), "pipeline-scheduler")` with no conditional around it.
CLAIM: "No runtime firing yet — that's the sibling scheduler-runtime ticket (HEL-415)" | VERDICT: FALSE | PROOF: same chain as above. The sentence is stale.

Bullet 17 (line 144)
CLAIM: `GET/POST /api/data-sources` | VERDICT: TRUE | PROOF: sources/DataSourceRoutes.scala:107 pathPrefix("data-sources"), :128 pathEndOrSingleSlash, :130 get, :146 post

Bullet 18 (line 145)
CLAIM: `GET/DELETE /api/data-sources/:id` | VERDICT: FALSE | PROOF: sources/DataSourceRoutes.scala:151-162 path(DataSourceIdSegment) carries patch (:153) and delete (:158) only, with no get. The 1.5 sweep shows DataSourceIdSegment is used by no other router for a bare :id GET (SourcePreviewRoutes hits are under pathPrefix("sources"), :46 and :99/:106, i.e. /api/sources/..., and DataSourcePreviewRoutes uses it only for /refresh (:50) and /preview (:64)).

Bullet 19 (line 146)
CLAIM: `POST /api/authoring/dashboard` | VERDICT: TRUE | PROOF: proposals/DashboardAuthoringRoutes.scala:88 pathPrefix("authoring"), :90 pathPrefix("dashboard"), :91 pathEndOrSingleSlash, :92 post; mounted ApiRoutes.scala:990 under authenticate
CLAIM: `?stream=true` | VERDICT: TRUE | PROOF: DashboardAuthoringRoutes.scala:95 parameters("stream".as[Boolean].optional)
  ("503 when ANTHROPIC_API_KEY is unset" and "never applies the proposal" NOT verified, left as-is)

Bullet 20 (line 147)
CLAIM: `POST /api/events` | VERDICT: TRUE | PROOF: telemetry/ProductEventRoutes.scala:28 pathPrefix("events"), :29 pathEndOrSingleSlash, :30 post; mounted ApiRoutes.scala:1012 under authenticate (:826)
  (write-only, 1..25 batch, rate-limit prose NOT verified, left as-is)

Bullet 21 (line 148)
CLAIM: `POST /api/first-run/dashboard` | VERDICT: TRUE | PROOF: firstrun/FirstRunRoutes.scala:22 pathPrefix("first-run"), :24 path("dashboard"), :25 post; mounted ApiRoutes.scala:947 under authenticate
  (build behavior prose NOT verified, left as-is)

Bullet 22 (line 149)
CLAIM: `GET /api/admin/usage?days=N` | VERDICT: TRUE | PROOF: admin/AdminUsageRoutes.scala:21 pathPrefix("admin"), :22 path("usage"), :23 get, :24 parameter("days".optional); mounted ApiRoutes.scala:1014 under authenticate
  (owner-tier, 403, 400 range prose NOT verified, left as-is)

Bullet 23 (line 150)
CLAIM: `GET /health` | VERDICT: TRUE | PROOF: HealthRoutes.scala:10 path("health"), :11 get; mounted ApiRoutes.scala:781 `health.routes ~` outside pathPrefix("api") (:782)

---

# Summary

- Bullets checked: 23. FALSE verdicts: 3 claims across 2 bullets (bullet 16 "data model + CRUD only" and "No runtime firing yet", bullet 18 "GET/DELETE :id").
- Bullet 18 fix: `GET/DELETE` → `PATCH/DELETE` (no GET-by-id exists; design.md Decision 1).
- Bullet 16 fix: exactly the 1.6a allowed edit (remove "data model + CRUD only; " and the "No runtime firing yet…" sentence, replace with "Schedules fire on the scheduler tick (`PipelineSchedulerService`).").
- Task 2.2 data-sources sub-route bullet: built from the 1.4 table (below). Derivation is the 1.4 directive grep plus the sed blocks above.

## 1.4 data-sources (path, method) table, derived from the proof above

| Router file : line | Path (under pathPrefix("data-sources")) | Methods |
|---|---|---|
| DataSourceRoutes.scala:110 | `csv-limits` | GET |
| DataSourceRoutes.scala:115 | `references` | GET |
| DataSourceRoutes.scala:128-150 | (bare) `/` | GET, POST |
| DataSourceRoutes.scala:151-162 | `/:id` | PATCH, DELETE |
| DataSourceRoutes.scala:165-180 | `/:id/schema` | GET, PATCH |
| DataSourceRoutes.scala:182-205 | `/:id/rows` | GET, POST, PUT |
| DataSourceRoutes.scala:210-215 | `/:id/rows/aggregate` | GET |
| DataSourceRoutes.scala:220-235 | `/:id/rows/:rowId` | PATCH, DELETE |
| DataSourcePreviewRoutes.scala:50-62 | `/:id/refresh` | POST |
| DataSourcePreviewRoutes.scala:64-69 | `/:id/preview` | GET |
| DataSourcePreviewRoutes.scala:71-72 | `infer` | POST |

Note: the DataSourcePreviewRoutes line ranges are approximate starts from the 1.4 grep (`path(` lines 50, 64, 71), and the methods are from the `post {`/`get {` lines 51, 65, 72. Verified against the grep output above.

---

# Cycle 2: skeptic-final-1 CR 1 (data-sources GET-by-id note)

```
$ sed -n '975,995p' backend/src/main/scala/com/helio/services/sources/DataSourceService.scala

  /** HEL-1122 design.md Decision 1: 404 via `findByIdOwned` (not found/not owned, same ACL
   *  convention as every other row route), 400 naming the actual kind for a non-`dataset`-kind
   *  source, 200 with the declared field list otherwise. */
  def getDatasetSchema(id: DataSourceId, user: AuthenticatedUser): Future[Either[ServiceError, DatasetSchemaResponse]] =
    dataSourceRepo.findByIdOwned(id, user).flatMap {
      case None                   => Future.successful(Left(ServiceError.NotFound("Data source not found")))
      case Some(_: DatasetSource) =>
        dataSourceRepo.getDeclaredSchema(id, user).map {
          case None             => Left(ServiceError.NotFound("Data source not found"))
          case Some(declaration) => Right(DatasetSchemaResponse(declaration.map(DatasetFieldResponse.fromDomain)))
        }
      case Some(ds) => Future.successful(Left(ServiceError.BadRequest(s"declared schema is only available for dataset sources (this source is '${ds.kind}')")))
    }

  /** HEL-1095 design.md D2/D3/D4, `dataset-field-aggregate` spec.md: `GET
   *  /api/data-sources/:id/rows/aggregate`. Same ACL/error-ordering convention as
   *  `getDatasetSchema` above -- `findByIdOwned` 404, `400` for a non-`dataset`-kind source --
   *  plus two aggregate-specific `400`s: `op` unsupported (checked first -- no DB call needed to
   *  reject it) and `field` either undeclared or declared non-numeric (checked against the SAME
   *  declaration read `getDatasetSchema` uses, via `getDeclaredSchema`, so the two routes can
[exit=0]
```

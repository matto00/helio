# HEL-1580 measurements

All numbers below were produced in this worktree on 2026-10-13. Raw JSON is in `prototype/results-*.json`.

## 1. Browser recompute latency (3-step pipeline, 1,000-row sample)

Environment: AMD Ryzen 5 7600X (12 threads), Arch Linux, kernel 7.1.5-arch1-2, Node v22.23.2.
`playwright-core` 1.55.1, resolved to `/home/matt/Development/helio/node_modules/playwright-core/index.js` (the worktree has no
`node_modules`; the driver is a `.cjs` file and takes the module directory from `PLAYWRIGHT_CORE`, defaulting to that path,
via `require.resolve`, because Node's ESM loader ignores `NODE_PATH`). Browser: **`chromium_headless_shell` 140.0.7339.186**
(headless Chromium, `browser.version()` = `140.0.7339.186`, UA `HeadlessChrome/140.0.7339.186`); not the full Chromium binary,
not the shared Playwright MCP browser, not jsdom/node. Page loaded via `file://`.

Command (one browser at a time, niced):

```bash
cd /home/matt/Development/helio/openspec/changes/archive/2026-10-13-live-draft-preview-spike
PLAYWRIGHT_CORE=/home/matt/Development/helio/node_modules/playwright-core nice -n 19 node prototype/measure.cjs > out.json
```

Method: 50 warm-up edits then 500 measured edits. Two edit kinds. **filter-drag**: the step-1 threshold changes (deterministic
sweep over the column's range, 179 distinct surviving-row counts across the 500 edits), recompute steps 1-3. **expr-edit**: the
step-3 expression changes, recompute step 3 only from the cached step-2 rows. Before timing, an untimed pass checks all 500
thresholds against a naive count, the sort order and the computed value (`verify.bad = 0` in every run).
`performance.now()` is quantised to 0.1 ms in Chromium, so the *mean* is the trustworthy figure for sub-ms values.
Three timings per edit: **recompute** only; **recompute + render + forced synchronous layout** (the writes, then read
`offsetHeight`; style + layout, not paint); **time to next frame** (`requestAnimationFrame` then a `MessageChannel` post; vsync-quantised,
so ~16.7 ms is the 60 Hz floor and carries no information about cost below it).

Unthrottled (run 1 / run 2 agree within noise), milliseconds:

| edit | recompute median / p95 / max (mean) | + render, forced layout median / p95 / max | next frame median / p95 / max |
|---|---|---|---|
| filter-drag (3 steps) | 0.10 / 0.20 / 0.40 (0.111) ; run 2: 0.10 / 0.20 / 0.30 (0.112) | 1.0 / 1.6 / 2.7 ; run 2: 1.0 / 1.5 / 2.3 | 16.7 / 16.9 / 17.2 |
| expr-edit (step 3 only) | 0.00 / 0.10 / 0.20 (0.028) ; run 2: (0.028) | 0.9 / 1.2 / 1.7 ; run 2: 0.8 / 1.2 / 1.6 | 16.5 / 16.7 / 17.1 |

CDP `Emulation.setCPUThrottlingRate` = 4 (low-end-device proxy):

| edit | recompute median / p95 / max (mean) | + render, forced layout median / p95 / max | next frame median / p95 / max |
|---|---|---|---|
| filter-drag | 0.50 / 1.0 / 1.2 (0.446) ; run 2: 0.50 / 1.1 / 1.6 (0.468) | 3.8 / 5.2 / 9.0 ; run 2: 4.6 / 6.3 / 10.9 | 16.6 / 17.4 / 18.6 |
| expr-edit | 0.00 / 0.70 / 0.80 (0.124) ; run 2: (0.134) | 3.2 / 4.3 / 7.2 ; run 2: 4.3 / 6.8 / 9.8 | 16.0 / 16.7 / 17.8 |

**Result: about 1 ms per edit (recompute + render) unthrottled, about 4-5 ms at 4x CPU throttle, against a < 50 ms target.**

Scaling probe (recompute only, filter-drag, 50 warm + 200 measured; the row counts bracket the source caps found in the tree):

| rows | 1x median / p95 | 4x median / p95 (run 1; run 2 in the JSON) |
|---|---|---|
| 1,000 | 0.1 / 0.3 | 0.5 / 1.1 |
| 10,000 | 1.5 / 2.7 | 6.3 / 11.8 (run 2: 6.6 / 13.1) |
| 50,000 (`CSV_MAX_ROWS` default) | 9.2 / 16.6 | 35.4 / 67 (run 2: 53.7 / 114) |

What this does not show: the prototype omits most of the expression language and the row-typing fidelity (see
`prototype/README.md`); render is 25 table rows, a <= 1,000-point polyline and two tiles, not the real ECharts renderer
(whose cost is not measured here); paint and compositing are not included except via the vsync-quantised next-frame figure.

## 2. Transport: local round trips against this worktree's backend

Backend `localhost:9919` (started with `scripts/concertino/start-servers.sh`), loopback only, **no network RTT** and no TLS.
Fixture: one `static` dataset source of 500 rows (`DatasetMaxRows` = 500) + one pipeline with the board's three steps; step
preview = `GET /api/pipelines/:id/steps/:stepId/preview` (the existing endpoint; saved config only; returns 10 rows plus
`totalCount` and step counts). Command:

```bash
cd /home/matt/Development/helio/openspec/changes/archive/2026-10-13-live-draft-preview-spike/prototype
HELIO_DEV_EMAIL=... HELIO_DEV_PASSWORD=... BACKEND_PORT=9919 nice -n 19 node transport.cjs
```

| measurement (ms) | run 1 | run 2 |
|---|---|---|
| step-3 preview (closure = 3 steps), n=25: median / p95 / max | 42.5 / 50.6 / 72.1 | 45.3 / 71.9 / 84.9 |
| step-1 preview (closure = 1 step), n=5: median / max | 40.5 / 44.9 | 42.7 / 47.8 |
| baseline `GET /api/auth/me` (no engine), n=15: median / p95 | 36.9 / 43.8 | 36.2 / 44.9 |
| `run-events` open to response headers, n=15: median / p95 | 33.6 / 40.6 | 36.8 / 40.1 |

An earlier un-saved first run (cold backend JIT) read step-3 preview median 50.7 / p95 82.0 / max 102.6, baseline not taken.
Later runs (`results-transport-run3-warm.json`, `results-transport-run4-hot.json`) read step-3 preview median 40.9 / 31.5, baseline
`/api/auth/me` 31.5 / 25.7, `run-events` open 30.9 / 26.4. The evaluation increment (preview minus same-run baseline) is a stable
**~6-9 ms** for 500 rows.

Response sizes: step preview 1,103 bytes (10 rows) vs ~28,950 bytes for the full 500-row frame the Output render would need. `run-events`
answered `200 text/event-stream; charset=UTF-8`, `Transfer-Encoding: chunked`, no event before the first run, as the code shows (no
heartbeat). Not measured: run-events close-to-reopen across a terminal event, the HEL-1392 burst (already measured in
`openspec/changes/archive/2026-10-09-panel-remount-row-refetch/probe-premise.md`: 8 panels x repeated desktop/phone crossings produced
"Rate limit exceeded" on 3 of 8 panels against the 120/60 s limiter).

**Correction to the "fixed floor" reading (found while answering owner ruling A).** The ~25-45 ms baseline is *not* a fixed
per-request cost. `prototype/floor.cjs` (`results-floor.json`) shows `GET /health` at 1.6 ms, an unauthenticated `/api/*` 401 at
3.3 ms, and the same session-authenticated `GET /api/auth/me` at **1.9 ms in one state and about 25-45 ms in another**. Probes
(scratchpad scripts, numbers quoted here): after a >= 60 s idle period, 100 consecutive `auth/me` calls took about 25-45 ms each (one
365 ms outlier) over ~3 s (raw per-call range excluding the outlier: 24.5-45.5 ms; the doc rounds this and the other cold-state readings, 24-44 and 26-46 ms, to "about 25-45 ms"); after 0 s or 20 s idle they took ~2 ms from the first call; in the slow state `/health` and the
no-cookie 401 stayed 1.3-5 ms while `auth/me` stayed 26-30 ms, and in a header-variant probe the slow state ended on its own
after ~40-60 requests. So the extra ~25-45 ms sits on the **database-touching** path (the session lookup,
`UserSessionRepository.findValidSession`, `UserSessionRepository.scala:25-35`), appears after idle and decays; its root cause was
not determined here (candidates: connection re-establishment or revalidation in the idle pool, a cold Postgres backend, CPU
frequency scaling) and it is a spinoff candidate. For the transport decision the point is: server latency per edit is
**state-dependent, ~2 ms + evaluation when hot, +25-45 ms when the DB path is cold**, and that applies to every transport that
touches the DB per edit (session lookup, `findByIdShared` ACL, the HEL-1516 re-check).

## 3. Fixture cleanup (transport.cjs runs) (shared dev DB, dev account `matt@helio.dev`)

Created and deleted by exact id (`DELETE /api/pipelines/:id`, `DELETE /api/data-sources/:id` -> 204 each; the three pipelines' steps
cascade; a PATCH of one step id from each run returned 404 afterwards; neither id is in the list endpoints):

| run | source | pipeline | steps |
|---|---|---|---|
| first (output not saved) | `9ea15ebd-c5ff-4d02-be85-1e97f5b2e036` | `c73036b6-a20c-4b5c-8d6d-291ad1cbfb26` | `ebef8142-76ad-4ebf-a0e0-028fdd07e256`, `1dbc678f-3aa2-4461-92ed-b9ef336879bf`, `f3068104-cf8d-4630-be79-213ae640728a` |
| run 1 | `6fd8c935-8ba6-4525-ab0a-fee345b5a76c` | `278730a7-73f9-4428-867a-94fa669305c1` | `4acb7464-2e0e-4beb-9331-76e0b85d9e42`, `668e400a-6821-49a3-8a72-f22ca70d0589`, `1388ce50-9cd2-425d-ade9-8860a5720978` |
| run 2 | `8ca15616-b03d-4c4b-bdb2-1e52deab63c3` | `da2c08d4-7d26-42ca-98a7-824ddebd328f` | `7f2905eb-8520-4ab1-85c0-7a13f0a1791e`, `931e8fbe-e0dd-4f17-983c-49c744f17b43`, `417cda01-c5b2-4198-9d93-0117dad1e9d3` |
| run 3 (warm attempt) | `ad334f83-0e4f-4072-8458-494ca76b3449` | `f87d71f6-9204-4243-87b2-44b5ef38b2f3` | `10f69b70-2a29-4c91-bd59-a3a448600f9c`, `d38b884b-2d3e-4cb7-b9d0-41e372757203`, `30c0913c-b122-450c-9814-9cdabbbe2105` |
| run 4 (hot attempt) | `9c62090a-ddc7-4110-941a-adf78f232661` | `321599f1-fe3b-4d39-bc4e-a9e896cd3b88` | `d5b68483-6a6d-4041-a135-cd8f29fa90ac`, `26755a0d-3ddd-41e0-a1b9-da6f3c7dbf4a`, `000cc489-4565-4d3c-b5bb-814e28a6eaf8` |

Servers were stopped with `scripts/concertino/stop-servers.sh <worktree> 7012 9919` (`STOPPED ports=7012,9919`). No Output rows, runs or
panels were created.

A further run (`results-transport-run4-hot.json`'s predecessor) that hit `429 Rate limit exceeded` on its first call created nothing
(the limiter fired because a probe had just sent ~240 requests in a minute: a live demonstration of the 120/min `/api` budget).
Servers were stopped again with `stop-servers.sh` after the floor probes (`STOPPED ports=7012,9919`).

## 4. Transport lab (owner ruling A: choose by lowest latency and cost): LOCAL LOOPBACK

`prototype/transport-lab.cjs`. Node (`node:https`, `node:http2` TLS server with a self-signed certificate generated by `openssl` at
run time into a temp dir, a hand-rolled RFC 6455 WebSocket upgrade on the HTTPS/1.1 server) plus Chromium's built-in `fetch`,
streams and `WebSocket`, driven through the repo's `playwright-core` 1.55.1 (`/home/matt/Development/helio/node_modules/playwright-core/index.js`),
`chromium_headless_shell` 140.0.7339.186, Node v22.23.2, Ryzen 5 7600X, `--ignore-certificate-errors`. No npm dependencies. The
"evaluate" is a 7 ms busy loop (about the measured engine increment), so the lab isolates **transport overhead**. It is a Node
server, not Pekko/JVM, over loopback: **no network RTT, no Cloud Run front end, no real TLS chain**. Command:

```bash
cd /home/matt/Development/helio/openspec/changes/archive/2026-10-13-live-draft-preview-spike
PLAYWRIGHT_CORE=/home/matt/Development/helio/node_modules/playwright-core nice -n 19 node prototype/transport-lab.cjs > out.json
```

Warm per-edit latency, 300 sequential edits each (median / p95, ms; 7 ms is the simulated work; `results-transport-lab.json`; run 1 in
`results-transport-lab-run1.json` agrees within 0.2 ms except SSE-h2, 9.2-9.4 in both):

| transport | 1 KB up | 29 KB up |
|---|---|---|
| POST request/response, HTTP/1.1 keep-alive | 8.4 / 8.7 | 8.4 / 9.0 |
| POST request/response, HTTP/2 (`nextHopProtocol` = `h2`) | 8.4 / 8.7 | 8.5 / 9.0 |
| POST + NDJSON response, HTTP/1.1 | 8.3 / 8.6 | 8.4 / 8.7 |
| POST + NDJSON response, HTTP/2 | 8.4 / 8.7 | 8.5 / 8.8 |
| POST + result on a separate SSE stream, HTTP/1.1 | 8.3 / 8.6 | 8.4 / 8.7 |
| POST + result on a separate SSE stream, HTTP/2 | 9.4 / 10.3 | 9.3 / 9.8 |
| WebSocket (wss, HTTP/1.1 upgrade), one message each way | 7.2 / 7.4 | 7.3 / 7.5 |

So warm, every option is within ~1.3 ms of the others and 0.1-1.3 ms above the 7 ms of work; WebSocket is lowest by ~1.2 ms
(no per-message HTTP framing). Payload size (1 KB vs 29 KB up) is invisible on loopback.

Multi-step server evaluation (3 sequential server steps of 30 ms, over h2, 60 edits): a single JSON response delivers its first byte
at **91.6 ms** (median); an NDJSON response (one line per step) delivers the first step's count at **32.4 ms** and completes at 91.5 ms.

Superseding an in-flight edit (every 3rd edit aborts the previous request after 2 ms): the server observed all 50 aborts on both HTTP/1.1
and HTTP/2. HTTP/1.1 closes the TCP connection on abort (the run opened ~55 HTTP/1.1 connections for ~900 requests, versus **1** HTTP/2 session
for the whole HTTP/2 phase, where an abort is an RST_STREAM on a live connection); on loopback the reconnect costs ~0.3 ms so the median
does not move. A WebSocket has no per-message abort at all: the superseded edit must be cancelled by an application message.

Cold first edit (20 trials, each in a new browser context, so a new connection and TLS handshake): HTTP/1.1 9.0, HTTP/2 8.9, WebSocket 8.6 ms
median. **Loopback cannot show the real cold cost**: connection setup is RTT-bound. Round-trip counts (protocol facts, not measured here):
a cold HTTP/1.1 or HTTP/2 first edit = TCP (1 RTT) + TLS 1.3 (1 RTT) + request (1 RTT) = 3 RTT; a cold WebSocket = TCP + TLS + upgrade + message =
4 RTT; every warm edit on every transport = 1 RTT. With an RTT assumption of 40 ms (an assumption for a browser to a Cloud Run region, not measured):
cold ~120 ms (HTTP) vs ~160 ms (WebSocket), warm ~47 ms for all (40 + ~7).

Server-side counters from the run: HTTP requests the server counted = every POST edit and every stream open; **WebSocket messages counted as HTTP
requests: 0** (620 messages, 22 upgrade requests): messages bypass any per-request limiter.

Where loopback cannot stand in for prod: no RTT (the dominant term); Node is not Pekko (no 1 s response-entity timer, different chunked
behaviour, different connection-limit handling); a self-signed local TLS chain; no Google front end (which terminates HTTP/2 for browsers
in production: an assumption, not verified here, and the leg from it to the container is a separate matter); no Cloud Run request timeout
(300 s default for streams/sockets, an assumption about the default, not set in this repo's workflow), concurrency accounting or
`LISTEN/NOTIFY`; no 6-connection HTTP/1.1 per-origin browser limit contention (not exercised: one editor page, no other traffic).

## 5. Parity-mutation probes (real Scala vs JavaScript)

Run to keep only the parity mutations that really diverge (`docs/live-draft-preview.md` §3.3). Scala side: the real `CastStep.apply` and
`SortStep.apply` through a throwaway ScalaTest (`sbt "testOnly ..TmpHel1580Probe"`, deleted afterwards, not committed); JS side: `node -e`
(Node v22.23.2).

| cast integer input | Scala `CastStep` | JS `Number(s)` | diverges |
|---|---|---|---|
| `"1e3"` | 1000 | 1000 | no |
| `" 5 "` | 5 | 5 | no |
| `"0.5e1"` | 5 | 5 | no |
| `"0x10"` | null | 16 | **yes** |
| `"1.9"` | 1 | 1.9 | **yes** |
| `"Infinity"` | 2147483647 | Infinity | **yes** |
| `"1_0"` | null | NaN (null in JSON) | no |

Sort over `[10, "9", "abc", null, "2", 3.5, "Abc", "10"]` ascending: real `SortStep` = `2, 3.5, 9, 10, 10, Abc, abc, null` (numeric tier
incl. numeric strings, then lexicographic, nulls last); JS `a - b` = `"2", 3.5, "9", 10, "abc", "Abc", "10"` (+ null); JS string sort =
`10, "10", "2", 3.5, "9", "Abc", "abc"`. Both mutations differ from the oracle. A `-0.0` vector cannot work: the corpus is JSON, and
`BigDecimal` has no signed zero.

## 6. Mechanical writer search (G1 table of `docs/live-draft-preview.md` §8.3)

Why: rounds 2, 3 and 4 of review each found writers a hand-built list missed. This is the search the table is reconciled against. Script:
`prototype/writer-search.sh` (throwaway, read-only; paths below have the `backend/src/main/scala/com/helio/` prefix stripped). Run from the worktree root:

```bash
bash openspec/changes/archive/2026-10-13-live-draft-preview-spike/prototype/writer-search.sh
```

Hit counts: **S1 3, S2 36 files, S3 98 lines, S4 25, S4b 0, S4c 2, S5 11.** Commands (verbatim from the script):

- S1: `grep -rnE "INSERT INTO|DELETE FROM|ON CONFLICT|UPDATE +[a-z_]+( +[a-z]+)? *(SET|$)|TRUNCATE" backend/src/main/scala --include=*.scala | grep -P "^[^:]+:\d+:.*\b(pipelines|pipeline_steps|outputs|pipeline_roots|pipeline_schedules|panels|alert_rules)\b" | grep -vE "^\S+:[0-9]+:\s*(//|\*|/\*)"` (the table-name filter is applied to the matched text, not the file path; an earlier unfiltered run listed the other ~80 raw-SQL hits, all on non-fingerprinted tables such as `node_snapshots`, `binary_refs`, `product_*`)
- S2: `grep -rlE "PanelTable|PanelRepository|PipelineTable|PipelineStepTable|OutputTable|PipelineRootTable|PipelineScheduleTable|AlertRuleTable" backend/src/main/scala --include=*.scala | sort`
- S3: `grep -nE "\+= |\+\+= |\.update\(|\.delete\b|insertOrUpdate|\.returning|forceInsert|sqlu" <the S2 files>`
- S4: `grep -rnE -i "REFERENCES +(<tables>|data_sources|dashboards)\b[^;,]*ON DELETE CASCADE" backend/src/main/resources/db/migration`
- S4b/S4c: FKs from `users` into the tables, and `ON DELETE SET NULL/SET DEFAULT` on them.
- S5: every `INSERT INTO|UPDATE|DELETE FROM` statement in a migration file that defines a function or trigger.

Raw output:

```text
## S1: raw SQL write statements naming a fingerprinted table (backend/src/main/scala)
infrastructure/persistence/pipelines/NodePayloadHistoryRepository.scala:180:        sqlu"""DELETE FROM node_payload_history h USING pipelines p, users u
infrastructure/persistence/pipelines/OutputRepository.scala:321:      removed <- sql"DELETE FROM panels WHERE output_id = ${id.value} RETURNING id".as[String]
infrastructure/persistence/pipelines/PipelineRunRepository.scala:403:              UPDATE pipelines p
## S2: files that touch a fingerprinted table through Slick
api/ApiRoutes.scala
api/routes/dashboards/PublicDashboardRoutes.scala
api/routes/dashboards/PublicPanelListResolver.scala
api/routes/dashboards/PublicPanelOutputResolver.scala
api/routes/dashboards/PublicPanelRowsResolver.scala
app/Main.scala
domain/model/Panel.scala
domain/panels/OutputBindingSpec.scala
infrastructure/persistence/alerts/AlertRuleRepository.scala
infrastructure/persistence/dashboards/DashboardContentsOps.scala
infrastructure/persistence/dashboards/DashboardRepository.scala
infrastructure/persistence/dashboards/DashboardSnapshotRepository.scala
infrastructure/persistence/panels/PanelMutationRepository.scala
infrastructure/persistence/panels/PanelRepository.scala
infrastructure/persistence/panels/PanelRowMapper.scala
infrastructure/persistence/pipelines/NodeSnapshotRepository.scala
infrastructure/persistence/pipelines/OutputRepository.scala
infrastructure/persistence/pipelines/PipelineRepository.scala
infrastructure/persistence/pipelines/PipelineRootRepository.scala
infrastructure/persistence/pipelines/PipelineRunRepository.scala
infrastructure/persistence/pipelines/PipelineScheduleRepository.scala
infrastructure/persistence/pipelines/PipelineStepRepository.scala
infrastructure/persistence/workspace/WorkspaceTeardownRepository.scala
services/panels/AutoLayoutService.scala
services/panels/PanelBatchWrites.scala
services/panels/PanelLifecycleWrites.scala
services/panels/PanelPatchApplier.scala
services/panels/PanelService.scala
services/patchsets/PatchSetApplyService.scala
services/patchsets/PatchSetApplyTypes.scala
services/patchsets/PatchSetPreviewService.scala
services/patchsets/PatchSetUndoService.scala
services/patchsets/PatchSetUndoTypes.scala
services/patchsets/RefinementGrounding.scala
services/pipelines/OutputService.scala
services/workspace/WorkspaceContextService.scala
## S3: Slick/SQL write forms in those files
api/ApiRoutes.scala:872:                              futures += userPreferenceRepo.upsertGlobalPrefs(userId, color)
api/ApiRoutes.scala:881:                              futures += userPreferenceRepo.upsertDashboardZoom(userId, DashboardId(dashId), zoom)
infrastructure/persistence/alerts/AlertRuleRepository.scala:79:    ctx.withUserContext(user.id.value)(table += domainToRow(rule)).map(_ => rule)
infrastructure/persistence/alerts/AlertRuleRepository.scala:90:      .update((row.metric, row.condition, row.name, row.enabled, row.severity, row.updatedAt))
infrastructure/persistence/alerts/AlertRuleRepository.scala:100:    ctx.withUserContext(user.id.value)(table.filter(_.id === id.value).delete).map(_ > 0)
infrastructure/persistence/dashboards/DashboardContentsOps.scala:66:          val deleteAction = panelTable.filter(_.dashboardId === dashboardId.value).delete
infrastructure/persistence/dashboards/DashboardContentsOps.scala:67:          val insertAction = DBIO.sequence(newPanelRows.map(pr => panelTable += pr))
infrastructure/persistence/dashboards/DashboardContentsOps.scala:69:            table.filter(_.id === dashboardId.value).map(r => (r.layout, r.lastUpdated)).update((layout, now))
infrastructure/persistence/dashboards/DashboardRepository.scala:164:    ctx.withUserContext(dashboard.ownerId.value)(table += domainToRow(dashboard))
infrastructure/persistence/dashboards/DashboardRepository.scala:190:        .update(next)
infrastructure/persistence/dashboards/DashboardRepository.scala:199:    ctx.withSystemContext(PanelRowLocks.lockForDeletion(dashboards = Seq(id.value)) andThen table.filter(_.id === id.value).delete).map(_ > 0)
infrastructure/persistence/dashboards/DashboardSnapshotRepository.scala:63:          (table += domainToRow(newDash))
infrastructure/persistence/dashboards/DashboardSnapshotRepository.scala:64:            .andThen(DBIO.sequence(newPanelRows.map(pr => panelTable += pr)))
infrastructure/persistence/dashboards/DashboardSnapshotRepository.scala:191:      (table += domainToRow(newDash))
infrastructure/persistence/dashboards/DashboardSnapshotRepository.scala:192:        .andThen(DBIO.sequence(newPanelRows.map(pr => panelTable += pr)))
infrastructure/persistence/panels/PanelMutationRepository.scala:27:      .insertAndAppend(panel.dashboardId, table += domainToRow(panel), _ => Vector(panel.id -> sizes))
infrastructure/persistence/panels/PanelMutationRepository.scala:75:              .insertAndAppend(DashboardId(source.dashboardId), table += newRow, plan)
infrastructure/persistence/panels/PanelMutationRepository.scala:100:            updates += table.filter(_.id === item.id).map(r => (r.title, r.lastUpdated)).update((title, now)).map(_ => ())
infrastructure/persistence/panels/PanelMutationRepository.scala:116:            updates += table.filter(_.id === item.id).map(r => (r.appearance, r.lastUpdated)).update((merged, now)).map(_ => ())
infrastructure/persistence/panels/PanelMutationRepository.scala:129:            updates += table.filter(_.id === item.id)
infrastructure/persistence/panels/PanelMutationRepository.scala:131:              .update((configColumnValuesOf(patchedRow), now))
infrastructure/persistence/panels/PanelMutationRepository.scala:170:    val inserts = DBIO.sequence(panels.map { case (p, _) => table += domainToRow(p) })
infrastructure/persistence/panels/PanelRepository.scala:212:    ctx.withUserContext(panel.ownerId.value)(table += domainToRow(panel))
infrastructure/persistence/panels/PanelRepository.scala:223:        .update((title, lastUpdated))
infrastructure/persistence/panels/PanelRepository.scala:231:    ctx.withSystemContext(table.filter(_.id === id.value).delete).map(_ > 0)
infrastructure/persistence/panels/PanelRepository.scala:241:        .update((appearance, lastUpdated))
infrastructure/persistence/panels/PanelRepository.scala:262:        .update((configColumnValuesOf(updated), lastUpdated))
infrastructure/persistence/pipelines/NodeSnapshotRepository.scala:143:        sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pipelineId AND node_step_id = $stepId"
infrastructure/persistence/pipelines/NodeSnapshotRepository.scala:145:        sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pipelineId AND node_step_id IS NULL AND root_id = $rid"
infrastructure/persistence/pipelines/NodeSnapshotRepository.scala:147:        sqlu"DELETE FROM node_snapshots WHERE pipeline_id = $pipelineId AND node_step_id IS NULL"
infrastructure/persistence/pipelines/NodeSnapshotRepository.scala:161:            sqlu"INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data) VALUES ($pipelineId, $stepId, $idx, $jsonStr::jsonb)"
infrastructure/persistence/pipelines/NodeSnapshotRepository.scala:163:            sqlu"INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data, root_id) VALUES ($pipelineId, NULL, $idx, $jsonStr::jsonb, $rootId)"
infrastructure/persistence/pipelines/NodeSnapshotRepository.scala:165:            sqlu"INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data) VALUES ($pipelineId, NULL, $idx, $jsonStr::jsonb)"
infrastructure/persistence/pipelines/OutputRepository.scala:266:      _       <- table += row
infrastructure/persistence/pipelines/OutputRepository.scala:274:    ctx.withSystemContext(table.filter(_.id === id.value).map(_.schema).update(schema)).map(_ => ())
infrastructure/persistence/pipelines/OutputRepository.scala:284:    val nameAction   = name.map(n => table.filter(_.id === id.value).map(r => (r.name, r.updatedAt)).update((n, now)))
infrastructure/persistence/pipelines/OutputRepository.scala:285:    val configAction = config.map(c => table.filter(_.id === id.value).map(r => (r.config, r.updatedAt)).update((c, now)))
infrastructure/persistence/pipelines/OutputRepository.scala:322:      _       <- table.filter(_.id === id.value).delete
infrastructure/persistence/pipelines/PipelineRepository.scala:318:        .update((name, now))
infrastructure/persistence/pipelines/PipelineRepository.scala:390:            .andThen(DBIO.seq(pipelinesTable += pipelineRow, rootsTable ++= rootRows))
infrastructure/persistence/pipelines/PipelineRepository.scala:463:        .andThen(DBIO.seq(pipelinesTable += pipelineRow, rootsTable ++= rootRows))
infrastructure/persistence/pipelines/PipelineRepository.scala:519:      case Some(pid) => PanelRowLocks.lockForDeletion(pipelines = Seq(pid)) andThen owned.delete
infrastructure/persistence/pipelines/PipelineRepository.scala:556:        .update((Some(status), Some(at), rowCount, truncated, at))
infrastructure/persistence/pipelines/PipelineRepository.scala:590:        .update((Some(status), Some(at), rowCount, truncated, at))
infrastructure/persistence/pipelines/PipelineRepository.scala:596:    * Targeted `.map(...).update(...)` projection, mirroring `updateLastRun` —
infrastructure/persistence/pipelines/PipelineRepository.scala:606:        .update(Some(schemaJson))
infrastructure/persistence/pipelines/PipelineRepository.scala:618:      pipelinesTable.filter(_.id === id.value).map(_.lastSourceSchema).update(Some(schemaJson))
infrastructure/persistence/pipelines/PipelineRootRepository.scala:84:    // method's own existing `ctx.withUserContext` flatMap chain, ahead of the `rootsTable += row`
infrastructure/persistence/pipelines/PipelineRootRepository.scala:94:        _            <- rootsTable += row
infrastructure/persistence/pipelines/PipelineRootRepository.scala:141:    (rootsTable += row).map(_ => rowToDomain(row))
infrastructure/persistence/pipelines/PipelineRootRepository.scala:151:    rootsTable.filter(_.id === rootId.value).delete
infrastructure/persistence/pipelines/PipelineRootRepository.scala:165:            rootsTable.filter(_.id === id).map(_.position).update(idx)
infrastructure/persistence/pipelines/PipelineRunRepository.scala:109:    (runsTable += row).map(_ => ())
infrastructure/persistence/pipelines/PipelineRunRepository.scala:331:        .update((status, Some(completedAt), rowCount, errorLog, truncatedReadsJson))
infrastructure/persistence/pipelines/PipelineRunRepository.scala:372:          .update(Some(now))
infrastructure/persistence/pipelines/PipelineRunRepository.scala:469:    (runsTable += row).map(_ => ())
infrastructure/persistence/pipelines/PipelineRunRepository.scala:493:      .delete
infrastructure/persistence/pipelines/PipelineRunRepository.scala:519:      .delete
infrastructure/persistence/pipelines/PipelineRunRepository.scala:639:      ctx.withSystemContext(assertionsTable ++= rows).map(_ => ())
infrastructure/persistence/pipelines/PipelineScheduleRepository.scala:74:    ctx.withUserContext(user.id.value)(table.insertOrUpdate(domainToRow(schedule))).map(_ => schedule)
infrastructure/persistence/pipelines/PipelineScheduleRepository.scala:81:      table.filter(_.pipelineId === pipelineId.value).delete
infrastructure/persistence/pipelines/PipelineScheduleRepository.scala:98:      table.filter(_.id === id.value).map(s => (s.nextRunAt, s.lastRunAt)).update((nextRunAt, lastRunAt))
infrastructure/persistence/pipelines/PipelineStepRepository.scala:147:                  _             <- stepsTable.filter(_.id === stepId.value).map(s => (s.config, s.updatedAt)).update((newConfigJson, Instant.now()))
infrastructure/persistence/pipelines/PipelineStepRepository.scala:269:      _        <- stepsTable += row
infrastructure/persistence/pipelines/PipelineStepRepository.scala:439:      // runs INSIDE this method's own existing DBIO chain, ahead of the `stepsTable += row`
infrastructure/persistence/pipelines/PipelineStepRepository.scala:466:      _        <- stepsTable += row
infrastructure/persistence/pipelines/PipelineStepRepository.scala:542:        stepsTable.filter(_.id === row.id).update(newRow).map(_ => newRow)
infrastructure/persistence/pipelines/PipelineStepRepository.scala:552:            case (r, i) if r.id == row.id => stepsTable.filter(_.id === r.id).update(r.copy(position = i))
infrastructure/persistence/pipelines/PipelineStepRepository.scala:553:            case (r, i)                   => stepsTable.filter(_.id === r.id).map(s => (s.position, s.updatedAt)).update((i, now))
infrastructure/persistence/pipelines/PipelineStepRepository.scala:593:        case (row, i) if row.id == newId => stepsTable += row.copy(position = i)
infrastructure/persistence/pipelines/PipelineStepRepository.scala:594:        case (row, i)                    => stepsTable.filter(_.id === row.id).map(s => (s.position, s.updatedAt)).update((i, now))
infrastructure/persistence/pipelines/PipelineStepRepository.scala:680:      // this method's own existing DBIO chain, ahead of the `stepsTable += newRow` write below --
infrastructure/persistence/pipelines/PipelineStepRepository.scala:710:      _                 <- stepsTable += newRow
infrastructure/persistence/pipelines/PipelineStepRepository.scala:718:                                 .update((Some(newId), None, now))
infrastructure/persistence/pipelines/PipelineStepRepository.scala:793:      _        <- stepsTable += row
infrastructure/persistence/pipelines/PipelineStepRepository.scala:826:                           stepsTable.filter(_.id === id.value).map(s => (s.position, s.updatedAt)).update((index, now))
infrastructure/persistence/pipelines/PipelineStepRepository.scala:904:              stepsTable.filter(_.id === id.value).map(s => (s.parentStepId, s.rootId, s.position, s.updatedAt)).update((newParent, newRootId, 0, now))
infrastructure/persistence/pipelines/PipelineStepRepository.scala:1021:                  .update((deletedRow.parentStepId, deletedRow.rootId, deletedRow.position))
infrastructure/persistence/pipelines/PipelineStepRepository.scala:1024:            _ <- if (tailDescendantIds.nonEmpty) stepsTable.filter(_.id.inSet(tailDescendantIds)).delete
infrastructure/persistence/pipelines/PipelineStepRepository.scala:1026:            _ <- stepsTable.filter(_.id === deletedRow.id).delete
infrastructure/persistence/pipelines/PipelineStepRepository.scala:1193:   *  NULL`) -- per-id `sqlu` calls rather than a single `= ANY(...)` array bind, since Slick's
infrastructure/persistence/pipelines/PipelineStepRepository.scala:1209:        sqlu"DELETE FROM node_snapshots WHERE pipeline_id = ${pipelineId.value} AND node_step_id = $sid"
infrastructure/persistence/pipelines/PipelineStepRepository.scala:1211:      _ <- sqlu"DELETE FROM node_snapshots WHERE pipeline_id = ${pipelineId.value} AND root_id = ${rootId.value} AND node_step_id IS NULL"
infrastructure/persistence/pipelines/PipelineStepRepository.scala:1212:      _ <- if (stepIdsUnderRoot.nonEmpty) stepsTable.filter(_.id.inSet(stepIdsUnderRoot)).delete else DBIO.successful(0)
infrastructure/persistence/workspace/WorkspaceTeardownRepository.scala:155:          val deletePipelines  = pipelinesTable.filter(_.id.inSet(pipelineIds)).delete
infrastructure/persistence/workspace/WorkspaceTeardownRepository.scala:156:          val deleteSources    = dataSourcesTable.filter(_.id.inSet(sourceIds)).delete
infrastructure/persistence/workspace/WorkspaceTeardownRepository.scala:160:          val deleteDashboards = dashboardsTable.filter(_.id.inSet(dashboardIds)).delete
services/panels/PanelLifecycleWrites.scala:46:    panelRepo.delete(panelId).map {
services/panels/PanelLifecycleWrites.scala:48:        audit("panel.delete", Some(panelId.value), user)
services/patchsets/PatchSetUndoService.scala:108:      case ("panel", "create")        => restoreCreateUndo(edit, id => panelService.delete(PanelId(id), user))
services/patchsets/PatchSetUndoService.scala:111:      case ("dashboard", "create")    => restoreCreateUndo(edit, id => dashboardService.delete(DashboardId(id), user))
services/patchsets/PatchSetUndoService.scala:113:      // HEL-987: `DataSourceService.delete` returns `Either[DataSourceDeleteError, Unit]` now
services/patchsets/PatchSetUndoService.scala:116:      case ("dataSource", "create")   => restoreCreateUndo(edit, id => dataSourceService.delete(DataSourceId(id), user).map(_.left.map(_.err)))
services/patchsets/PatchSetUndoService.scala:162:    restoreCreateUndo(edit, id => pipelineService.delete(PipelineId(id), user)).flatMap {
services/patchsets/PatchSetUndoService.scala:178:        panelService.update(PanelId(prior.id), PatchSetUndoInverse.fullPanelInverse(prior), user).map {
services/patchsets/PatchSetUndoService.scala:206:        dashboardService.update(DashboardId(prior.id), PatchSetUndoInverse.fullDashboardInverse(prior), user, LayoutWritePolicy.RestorePriorStored).map {
services/patchsets/PatchSetUndoService.scala:219:        dataSourceService.update(DataSourceId(prior.id), UpdateDataSourceRequest(name = Some(prior.name)), user).map {
services/pipelines/OutputService.scala:245:          audit("output.delete", Some(id.value), user)
## S4: FK ON DELETE CASCADE into or through the fingerprinted tables (migrations)
backend/src/main/resources/db/migration/V23__pipeline_steps.sql:3:  pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
backend/src/main/resources/db/migration/V99__prevent_zero_root_pipelines.sql:3:-- V22:4 had `pipelines.source_data_source_id ... REFERENCES data_sources(id) ON DELETE CASCADE`
backend/src/main/resources/db/migration/V61__alert_events.sql:26:    alert_rule_id       TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
backend/src/main/resources/db/migration/V62__pipeline_schedules.sql:25:    pipeline_id  TEXT NOT NULL UNIQUE REFERENCES pipelines(id) ON DELETE CASCADE,
backend/src/main/resources/db/migration/V22__pipelines.sql:4:    source_data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
backend/src/main/resources/db/migration/V18__user_preferences.sql:11:  CONSTRAINT fk_user_dashboard_zoom_dashboard FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE
backend/src/main/resources/db/migration/V94__outputs_model.sql:208:    pipeline_id   TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
backend/src/main/resources/db/migration/V94__outputs_model.sql:209:    node_step_id  TEXT NULL REFERENCES pipeline_steps(id) ON DELETE CASCADE,
backend/src/main/resources/db/migration/V94__outputs_model.sql:344:ALTER TABLE panels ADD COLUMN output_id TEXT NULL REFERENCES outputs(id) ON DELETE CASCADE;
backend/src/main/resources/db/migration/V94__outputs_model.sql:391:ALTER TABLE alert_rules ADD COLUMN target_output_id TEXT NULL REFERENCES outputs(id) ON DELETE CASCADE;
backend/src/main/resources/db/migration/V94__outputs_model.sql:394:ALTER TABLE alert_events ADD COLUMN target_output_id TEXT NULL REFERENCES outputs(id) ON DELETE CASCADE;
backend/src/main/resources/db/migration/V94__outputs_model.sql:425:ALTER TABLE binary_refs ADD COLUMN pipeline_id TEXT NULL REFERENCES pipelines(id) ON DELETE CASCADE;
backend/src/main/resources/db/migration/V94__outputs_model.sql:426:ALTER TABLE binary_refs ADD COLUMN node_step_id TEXT NULL REFERENCES pipeline_steps(id) ON DELETE CASCADE;
backend/src/main/resources/db/migration/V110__pipeline_auto_run_debounce.sql:15:    pipeline_id  TEXT PRIMARY KEY REFERENCES pipelines(id) ON DELETE CASCADE,
backend/src/main/resources/db/migration/V2__cascade_delete.sql:4:        FOREIGN KEY (dashboard_id) REFERENCES dashboards(id) ON DELETE CASCADE;
backend/src/main/resources/db/migration/V101__share_tokens.sql:26:  dashboard_id TEXT NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
backend/src/main/resources/db/migration/V115__output_snapshot_history.sql:24:  output_id      TEXT NOT NULL REFERENCES outputs(id) ON DELETE CASCADE,
backend/src/main/resources/db/migration/V98__pipeline_roots.sql:80:    pipeline_id   TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
backend/src/main/resources/db/migration/V98__pipeline_roots.sql:81:    data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
backend/src/main/resources/db/migration/V98__pipeline_roots.sql:119:ALTER TABLE pipeline_steps ADD COLUMN root_id TEXT REFERENCES pipeline_roots(id) ON DELETE CASCADE;
backend/src/main/resources/db/migration/V98__pipeline_roots.sql:145:ALTER TABLE outputs        ADD COLUMN root_id TEXT REFERENCES pipeline_roots(id) ON DELETE CASCADE;
backend/src/main/resources/db/migration/V98__pipeline_roots.sql:147:ALTER TABLE binary_refs    ADD COLUMN root_id TEXT REFERENCES pipeline_roots(id) ON DELETE CASCADE;
backend/src/main/resources/db/migration/V106__dataset_rows.sql:32:    data_source_id TEXT        NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
backend/src/main/resources/db/migration/V24__pipeline_runs.sql:3:  pipeline_id  TEXT        NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
backend/src/main/resources/db/migration/V116__node_payload_history.sql:25:  pipeline_id    TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
## S4b: FKs from users into the fingerprinted tables, any ON DELETE action
## S4c: ON DELETE SET NULL / SET DEFAULT on the fingerprinted tables
backend/src/main/resources/db/migration/V5__panel_type_binding.sql:1:ALTER TABLE panels ADD COLUMN type_id TEXT REFERENCES data_types(id) ON DELETE SET NULL;
backend/src/main/resources/db/migration/V76__panel_metric_id.sql:17:ALTER TABLE panels ADD COLUMN metric_id TEXT REFERENCES metrics(id) ON DELETE SET NULL;
## S5: SQL functions and triggers whose bodies write a table (migrations)
backend/src/main/resources/db/migration/V122__strip_deleted_panel_layout_items.sql:72:  UPDATE dashboards d
backend/src/main/resources/db/migration/V123__strip_existing_ghost_layout_items.sql:74:    UPDATE dashboards d
backend/src/main/resources/db/migration/V128__stored_object_deletions.sql:49:  INSERT INTO stored_object_deletions (storage_key, source_table) VALUES (OLD.storage_key, 'image_uploads');
backend/src/main/resources/db/migration/V128__stored_object_deletions.sql:66:      INSERT INTO stored_object_deletions (storage_key, source_table) VALUES (key, 'data_sources');
backend/src/main/resources/db/migration/V132__form_and_conversation_object_deletions.sql:42:  INSERT INTO stored_object_deletions (storage_key, source_table, claimed_at, not_before)
backend/src/main/resources/db/migration/V132__form_and_conversation_object_deletions.sql:70:  INSERT INTO stored_object_deletions (storage_key, source_table, claimed_at, not_before)
backend/src/main/resources/db/migration/V132__form_and_conversation_object_deletions.sql:101:    INSERT INTO stored_object_deletions (storage_key, source_table, claimed_at, not_before)
backend/src/main/resources/db/migration/V132__form_and_conversation_object_deletions.sql:118:  INSERT INTO stored_object_deletions (storage_key, source_table, claimed_at, not_before)
backend/src/main/resources/db/migration/V132__form_and_conversation_object_deletions.sql:131:  INSERT INTO stored_object_deletions (storage_key, source_table, claimed_at, not_before)
backend/src/main/resources/db/migration/V132__form_and_conversation_object_deletions.sql:148:  INSERT INTO stored_object_deletions (storage_key, source_table, claimed_at, not_before)
backend/src/main/resources/db/migration/V132__form_and_conversation_object_deletions.sql:166:  INSERT INTO stored_object_deletions (storage_key, source_table, claimed_at, not_before)
```

### Reconciliation: every hit is a listed writer or excluded with a reason

| Hit | Disposition |
|---|---|
| S1 `OutputRepository.scala:321` `DELETE FROM panels WHERE output_id` | listed: Output delete (`deleteWithPanelsInternal`), panels |
| S1 `PipelineRunRepository.scala:403` `UPDATE pipelines p` | excluded: writes `last_run_*` only (outside the fingerprint) |
| S1 `NodePayloadHistoryRepository.scala:180` `USING pipelines p` | excluded: a read join; it deletes `node_payload_history` |
| S3 `AlertRuleRepository.scala:79,90,100` | listed (insert, update, delete); no `target_output_id` write in `update` |
| S3 `DashboardContentsOps.scala:66-67` | listed: `replaceContents` deletes and inserts panels |
| S3 `DashboardRepository.scala:164,190` | excluded: `dashboards` row insert/layout update, not fingerprinted; `:199` dashboard delete is listed (cascades panels) |
| S3 `DashboardSnapshotRepository.scala:63-64,191-192` | listed: `duplicate`, `importSnapshot` insert panels |
| S3 `PanelMutationRepository.scala:27,75,129-131,170` | listed: `insertPlaced`, `duplicate`, `batchUpdate` (config incl. `output_id`), `insertBatchPlaced` |
| S3 `PanelMutationRepository.scala:100,116` | excluded: title and appearance only |
| S3 `PanelRepository.scala:212` | excluded: `insert` has no production caller (grep of `panelRepo.insert`: scaladoc only) |
| S3 `PanelRepository.scala:231,262` | listed: `delete` (caller `PanelLifecycleWrites.scala:46`), `replace` (caller `PanelPatchApplier.scala:53`) |
| S3 `PanelRepository.scala:223,241` | excluded: title and appearance only |
| S3 `OutputRepository.scala:266,284-285,322` | listed: `insertInternalAction`, `updateOwned`, delete; `:274` `updateSchemaInternal` excluded (`schema` not fingerprinted) |
| S3 `PipelineRepository.scala:318,390,463,519` | listed: `updateName`, create, create action, delete |
| S3 `PipelineRepository.scala:556,590,606,618` | excluded: `last_run_*` and `last_source_schema` |
| S3 `PipelineRootRepository.scala:94,141,151` | listed: `add`, `addAction`, `removeAction`; `:165` root `position` excluded (the fingerprint reads root id and data source only) |
| S3 `PipelineScheduleRepository.scala:74,81` | listed: `upsert`, `delete`; `:98` `next_run_at`/`last_run_at` excluded |
| S3 `PipelineStepRepository.scala:147,269,466,542,552-553,593-594,710,718,793,826,904,1021-1026,1212` | listed: `rewriteUpsertTargetAction`, `insertRootStep` (dead), `insertInternalAction`, `updateInternal`/position-scoped update, `insertAtInternal`, splice insert and its re-parent, `attachTail`, `reorderInternal`, `reorderTrunkInternal`, `deleteInternal`, `removeRootCascadeAction` |
| S3 `WorkspaceTeardownRepository.scala:155-160` | listed: deletes pipelines, sources, dashboards whole |
| S3 `PipelineRunRepository.scala`, `NodeSnapshotRepository.scala`, `BinaryRefRepository.scala`, `ApiRoutes.scala` (`futures +=`), `PatchSetUndoService.scala`, `OutputService.scala:245`, `PanelLifecycleWrites.scala:46-48` | excluded: other tables (`pipeline_runs`, run assertions, `node_snapshots`, `binary_refs`), an unrelated collection, or service-level calls into the repositories above |
| S4 cascades | the sources are `pipelines`, `pipeline_steps`, `pipeline_roots`, `outputs`, `dashboards` (`panels.dashboard_id`, V2:4) and `data_sources` (`pipeline_roots.data_source_id`, V98:81); each is a delete listed above (pipeline/step/root/Output deleters, dashboard deleters, `DataSourceRepository.delete`, `WorkspaceTeardownRepository`) |
| S4b | none: no FK from `users` into the fingerprinted tables |
| S4c | `panels.type_id` and `panels.metric_id` `SET NULL`: columns the fingerprint does not read |
| S5 | the only function/trigger bodies that write are `dashboards.layout` strippers (V122, V123) and `stored_object_deletions` enqueuers (V128, V132): none writes a fingerprinted table; `hel1498_lock_panels` (V129/V130) and the zero-root guards (V99/V100) write nothing |

Result of the search: the 7 panel writers named in review (and `PanelRepository.replace`, which has a production caller) were missing from the
earlier table and are added. **No writer the candidate lock order does not cover:** every added writer inserts or updates `panels.output_id`, so it takes
the foreign-key key-share on the Output row that candidate step 3 blocks, and the dashboard-side writers (`duplicate`, `importSnapshot`, `replaceContents`,
dashboard delete) lock the dashboard first, as `PanelRowLocks.scala:11-21` requires.

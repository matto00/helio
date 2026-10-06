# helio-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
Helio's REST API as agent tools: **read tools, write/composition tools, and a
workspace-context resource**, all authenticated with a Personal Access Token.
For the bigger picture (auth model, the canonical path, the shell-script twin,
and the proposal→review→apply flow) see [`docs/agent-native.md`](../docs/agent-native.md).

The server is a **thin wrapper**: every tool is a typed call to an existing
Helio endpoint. It adds no business logic — where a capability the brief named
did not exist as a single endpoint, the gap is documented (see
[Endpoint reality](#endpoint-reality-vs-the-brief)) rather than papered over.

This package is **standalone** — its own `package.json`/`tsconfig.json`, not part
of the root Helio npm workspace.

## Prerequisites

- Node.js ≥ 20 (uses the built-in `fetch`).
- A running Helio backend (default `http://localhost:8080`).
- A Personal Access Token (PAT). PATs are the durable agent credential added in
  HEL-148 Phase 1.

## Creating a PAT

Log in to Helio, then mint a token (the raw value is shown **once**):

```bash
# 1. Get a session token (or use your browser's stored one)
SESSION=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"…"}' | jq -r .token)

# 2. Mint a PAT
curl -s -X POST http://localhost:8080/api/tokens \
  -H "Authorization: Bearer $SESSION" -H 'Content-Type: application/json' \
  -d '{"name":"fable-mcp"}' | jq -r .token
# → helio_pat_xxxxxxxx…  (copy this now; it is never shown again)
```

## Configuration

| Env var              | Required | Default                 | Notes                                                  |
| -------------------- | -------- | ----------------------- | ------------------------------------------------------ |
| `HELIO_PAT`          | yes      | —                       | `helio_pat_…`; server fails fast if unset or malformed |
| `HELIO_API_BASE_URL` | no       | `http://localhost:8080` | Base URL of a running backend                          |

## Build & run

```bash
npm install
npm run build         # → dist/
HELIO_PAT=helio_pat_… npm start   # serves MCP over stdio
```

For development without a build step: `HELIO_PAT=helio_pat_… npm run dev`.

### Wiring into an MCP client

The server speaks MCP over **stdio**. Example client config:

```json
{
  "mcpServers": {
    "helio": {
      "command": "node",
      "args": ["/absolute/path/to/helio-mcp/dist/index.js"],
      "env": { "HELIO_PAT": "helio_pat_…", "HELIO_API_BASE_URL": "http://localhost:8080" }
    }
  }
}
```

All diagnostic logging goes to **stderr**; stdout carries only the JSON-RPC
protocol stream.

## Tool catalog

| Tool                    | Endpoint(s) used                                                  | Purpose                                                                                                                                                                                                                                  |
| ----------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_dashboards`       | `GET /api/dashboards`                                             | Paginated dashboard list                                                                                                                                                                                                                 |
| `get_dashboard`         | `GET /api/dashboards` + `GET /api/dashboards/:id/export`          | One dashboard **with its panels** (composed — see below)                                                                                                                                                                                 |
| `list_data_sources`     | `GET /api/data-sources`                                           | Data sources (csv/rest_api/sql/static)                                                                                                                                                                                                   |
| `list_source_objects`   | `GET /api/data-sources/:id/preview` or `/api/sources/:id/preview` | Inspect a source's shape (composed — see below)                                                                                                                                                                                          |
| `list_pipelines`        | `GET /api/pipelines`                                              | Pipeline summaries                                                                                                                                                                                                                       |
| `get_pipeline`          | `GET /api/pipelines/:id` + `GET /api/pipelines/:id/steps`         | One pipeline **with its steps** (composed)                                                                                                                                                                                               |
| `analyze_pipeline`      | `GET /api/pipelines/:id/analyze`                                  | Source schema + per-step input/output schema                                                                                                                                                                                             |
| `list_pipeline_shapes`  | `GET /api/pipeline-shapes`                                        | Smart pipeline shape catalog (id/label/description/paramsSchema/outputContract, **HEL-400**)                                                                                                                                             |
| `get_workspace_context` | fan-out (see below)                                               | One compact snapshot of the whole workspace (**HEL-222**), now including `pipelineShapes` (**HEL-400**), source `inferredSchema`, and pipeline `outputs[]` (kind/schema/placements) instead of an implicit output DataType (**HEL-907**) |

The Output/pipeline/placement tool families (`add_output`/`update_output`/`delete_output`/`list_outputs`/`get_output_rows`/`preview_outputs`/`get_output_capabilities`, `add_outputs_from_shape`, `place_outputs`/`create_content_panel`) added by HEL-906/HEL-907 are not yet documented in this catalog table — a known gap, flagged rather than silently left stale; see `src/tools/outputs.ts`/`src/tools/pipelines.ts`/`src/tools/placements.ts` for their descriptions in the meantime.

### Output provenance (HEL-1206)

`get_output_provenance(outputId)` reads `GET /api/outputs/:id/provenance`: the source(s) feeding an
Output (name + kind), its pipeline, the step path to its node, the last non-dry run (status,
completedAt, row count of the Output's own node snapshot) and assertion counts, in one call. It
never carries `errorLog` or assertion `observed` values. Status codes, probed live: `200`; `404`
for an unknown/malformed/unreadable Output id; `401` for a missing or invalid token. A separate
tool rather than a field on `get_output`, so ordinary Output reads do not pay its query budget.

### Output history (HEL-1274)

`get_output_history(outputId, limit?, since?, includeSummaries?)` reads
`GET /api/outputs/:id/history`: the last N recorded values (`limit` 1..100, default 30) of an Output in
one call, as `sparkline` (oldest first) and `points` (newest first), plus the Output's
`config.compare` resolved to `current`/`baseline`/`delta`/`pct`/`availableFrom`. Values are non-null
only for **metric** Outputs. History is thinned as it ages, so a `previous_run` baseline is the
second-newest _retained_ point, not necessarily the last run. `points[].summary` is dropped unless
`includeSummaries: true`. `add_output`, `update_output`, `create_pipeline` and `propose_pipeline`
document the optional `config.compare` (`previous_run | 1d | 7d | 30d | custom:<ISO-8601 duration>`);
the backend validates it (400 otherwise), and `place_outputs` does not take it.

### Output-panel controls (HEL-1193)

`get_output_filter_capabilities(outputId)` reads `GET /api/outputs/:id/filter-capabilities`
(per column: `operators` and `controlKinds`; not to be confused with `get_output_capabilities`,
the pipeline node's field-mapping menu). `add_output_control` / `update_output_control` /
`remove_output_control` (`dashboardId` + `panelId`) read-modify-write the panel's
`config.controls`; `add_output_control` mints the id and, when `column` is omitted, binds the
first column in schema order whose `controlKinds` includes the kind. An ineligible control is
the backend's HTTP 400 `control not eligible: column '<c>', kind '<k>'`, surfaced unchanged.
Proposals (`propose_dashboard`, `apply_proposal`, `apply_combined_proposal`,
`replace_dashboard_contents`) take a first-class `controls` array on output panels;
`get_workspace_context` lists each output placement's `controls`. Patch sets are not checked
at propose time: `apply_patch_set` answers HTTP 200 with `failure: "control not eligible: ..."`.

### Write / composition tools

| Tool                      | Endpoint                                  | Purpose                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_data_source`      | `POST /api/data-sources` (static)         | Create a static source from inline columns + rows                                                                                                                                                                                                                                                               |
| `create_csv_data_source`  | `POST /api/data-sources` (multipart, csv) | Create a CSV source from inline text content — no filesystem access needed                                                                                                                                                                                                                                      |
| `create_connector`        | `POST /api/connectors`                    | Create a **credential-less** Connector only (`authType: none`, **HEL-886**) — accepts no credential under any key; a credentialed host (`authType: bearer/api_key`) is refused with a next step naming the in-app `/connectors` page, no Connector created                                                      |
| `create_rest_data_source` | `POST /api/sources` (`type: rest_api`)    | Create a REST API source against an existing `connectorId` (from `list_connectors`/`create_connector`); returns the companion DataType or a `fetchError`                                                                                                                                                        |
| `create_sql_data_source`  | `POST /api/sources` (`type: sql`)         | Create a SQL source; returns the companion DataType or a `fetchError`                                                                                                                                                                                                                                           |
| `create_pipeline`         | `POST /api/pipelines`                     | Create a pipeline (sourceId or inline source, `steps[]`, optional `outputs[]`) in one agent-facing call (**HEL-907**)                                                                                                                                                                                           |
| `add_pipeline_step`       | `POST /api/pipelines/:id/steps`           | Append a transform step (config keyed by step type; `parentStepId` for tree shape, **HEL-907**). **HEL-1069:** `attachAsTail:true` = new sibling lane (needs `parentStepId`), `false` = deliberate splice, omitted = errors instead of silently re-parenting existing steps; result carries `reparentedStepIds` |
| `run_pipeline`            | `POST /api/pipelines/:id/run`             | Run to completion (synchronous — rows exist on return, no polling). **HEL-1069:** returns `runId`, `stepRowCounts`, and `warnings[]` for zero-row steps with a non-empty input                                                                                                                                  |
| `create_dashboard`        | `POST /api/dashboards`                    | Create an empty dashboard                                                                                                                                                                                                                                                                                       |
| `update_panel_appearance` | `PATCH /api/panels/:id`                   | Update panel appearance (partial)                                                                                                                                                                                                                                                                               |
| `update_panel`            | `PATCH /api/panels/:id`                   | Update a panel's title/type/config in place (**HEL-627**) — placement fields only (**HEL-907**); `config`/`appearance` are genuine per-field partial merges; `type` is validated against the panel's stored kind (no-op on match, 400 on mismatch)                                                              |
| `update_data_source`      | `PATCH /api/data-sources/:id`             | Rename a data source (**HEL-328**) — rename-only, no other field is patchable                                                                                                                                                                                                                                   |
| `update_pipeline`         | `PATCH /api/pipelines/:id`                | Rename a pipeline (**HEL-328**) — rename-only, no other field is patchable                                                                                                                                                                                                                                      |
| `update_pipeline_step`    | `PATCH /api/pipeline-steps/:id`           | Edit a step's config and/or position in place (**HEL-328**) — no `type` field (immutable at the backend)                                                                                                                                                                                                        |
| `teardown_resources`      | `POST /api/workspace/teardown`            | Bulk-delete every owned data source/pipeline/dashboard carrying a `tag` (**HEL-366**; dashboards added **HEL-907**); refuses the whole call on any out-of-batch dependent; `dryRun: true` previews without deleting                                                                                             |

Each write tool returns the created resource's id so an agent can chain the
canonical path without re-listing. A panel now binds to an Output via
`place_outputs` (see the Output tool families noted above), not `bind_panel`
(removed, **HEL-907** — the DataType-bound field-mapping panel-creation path
no longer exists). `create_csv_data_source` does not return a companion
DataType inline (same as `create_data_source`) — inspect it via
`list_source_objects`.
`create_rest_data_source`/`create_sql_data_source` return `dataType: null` +
`fetchError` when the initial fetch/query fails at creation time, rather than
an opaque error, so the agent can diagnose and retry. Credentials (SQL
password, REST bearer token/api-key value) are redacted server-side and never
appear in any of these tools' results.

### Refinement tools (conversational, over live state — HEL-411)

| Tool                | Endpoint                                              | Purpose                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `propose_patch_set` | `POST /api/refinements`                               | Turn a natural-language message into a reviewable `PatchSet`, grounded in a target dashboard/pipeline's REAL current live state + workspace-wide context — writes NOTHING. `conversationId` (optional) continues the same conversation across turns.                                                                                     |
| `apply_patch_set`   | `POST /api/patch-sets/apply` (**HEL-406**, unchanged) | Apply an accepted `PatchSet` atomically — every edit applies in order, and a mid-set failure rolls back everything already applied. Does NOT decompose into individual `update_panel`/`update_pipeline`/etc. calls — the atomic primitive, not a loop. Returns `applicationId` (**HEL-413**) when the apply succeeded and was journaled. |
| `undo_patch_set`    | `POST /api/patch-sets/:id/undo` (**HEL-413**)         | Undo a previously-applied `PatchSet`, using the `applicationId` a successful `apply_patch_set` call returned. Restores every edit to its pre-apply state, or restores NONE of them — a resource changed since the apply, or a delete edit with no restoring create API, refuses the whole undo rather than partially reverting.          |

`propose_patch_set` + `apply_patch_set` are the conversational-refinement analogue of
`propose_dashboard`/`apply_proposal` above, but target an EXISTING dashboard/pipeline instead of
creating a new one, and produce N targeted edits (a `PatchSet`) instead of a whole-dashboard
`DashboardProposal`. Typical flow: `propose_patch_set({target: {kind: "dashboard", id}, message:
"make that a bar chart, group by month"})` → inspect/edit the returned `patchSet` → `apply_patch_set
({patchSet})` → optionally `undo_patch_set({applicationId})` to revert it.

Plus one **resource**: `helio://workspace/context` — the same payload as
`get_workspace_context`, so an MCP client can attach it as ambient context.

Tool descriptions encode the canonical `Source → Pipeline → Output →
Dashboard` path (HEL-904/HEL-907): a Panel binds to an Output (`nodeStepId: null`
means the Output is attached directly to the pipeline's source; otherwise it
targets a specific step's projected schema). Binding a fieldMapping against a
column that isn't actually in the targeted node's grounded schema is rejected —
the error is surfaced verbatim, never worked around.

### End-to-end composition

`e2e/sleeper-rebuild.ts` (with `HELIO_PAT` + `HELIO_API_BASE_URL`) drives the
write tools through a real MCP client to build several full dashboards from
scratch — source → pipeline (single-call `create_pipeline` with `steps[]`/
`outputs[]`) → run → dashboard → `place_outputs` — then reads them back to
assert the chain, plus a daily schedule set+read-back. This is the
composition verified rendering real data in the running app (see
`docs/agent-native.md` → "End-to-end proof"). `scripts/verify.ts`
(`npm run verify`) is the companion verification harness — every read tool plus
a small `create_pipeline`/`add_outputs_from_shape` write check; it does not
compose a dashboard.

## Context serializer

`get_workspace_context` (and the resource) return one snapshot (HEL-907
design.md Decision 6 — retargeted onto Outputs, types/metrics dropped
entirely):

```
{ generatedAt, counts,
  dataSources: [{id,name,type,tag,inferredSchema:[{name,type}]}],
  pipelines:   [{…summary, steps:[{position,type,outputColumns[],validationError}],
                 lastRunAssertions, outputs:[{id,name,kind,nodeStepId,schema[],placements[{dashboardId,panelId,controls[]}]}]}],
  dashboards:  [{id,name,panelCount}],
  pipelineShapes, truncation, agentContext, connectors }
```

It is a **client-side fan-out** over existing endpoints — no backend
aggregation. Call budget: `2` list calls (sources, dashboards) `+ 1` pipelines
list `+ 1` analyze per pipeline `+ 1` run-history per pipeline `+ 1`
pipeline-shapes catalog call `+ 1` (paginated) outputs fetch across every
pipeline = **4 + 2N(pipelines)** — the outputs fetch is one paginated
`listAllOutputs` call, not a per-pipeline fan-out, so it stays flat in
pipeline count. For workspace-sized data (handfuls of each) this is
comfortably fast. There is no more per-column sample-row/statistics fetch —
that was the DataType/Metric enumeration (HEL-857's 220k-char overflow) that
no longer exists in this model; a 25-source/43-pipeline fixture
(`context.test.ts`) verifies the result stays comfortably under the byte
budget without a separate truncation strategy.

**When to add a backend `/api/context`:** only if pipeline count grows enough
that the `2N` analyze/run-history calls become the bottleneck. Not needed at
Phase 2 scale — this is flagged, not built, per the brief.

> **spray-json gotcha (load-bearing):** the backend omits `Option` fields that
> are `None` from the JSON entirely. An Output attached directly to a
> pipeline's source has `nodeStepId = None`, so the wire has **no
> `nodeStepId` field at all**. The serializer normalizes a missing
> `nodeStepId` to `null` — reading `nodeStepId === null` without that
> normalization would fail to distinguish it from a step-targeted Output on
> the wire.

## Endpoint reality vs. the brief

The Phase-2 brief's endpoint→tool map named three endpoints that **do not exist
on `main`**. Each is composed from endpoints that do, with the composition
documented at the call site in `src/helioApi.ts`:

1. **`GET /api/dashboards/:id`** — no single-dashboard GET exists. `get_dashboard`
   finds the record in the dashboard list and pulls panels from `/:id/export`.
2. **`GET /api/dashboards/:id/panels`** — no per-dashboard panel list exists;
   panels come from the export snapshot (above).
3. **`GET /api/data-sources/:id/sources`** — documented in `openspec/config.yaml`
   but never implemented. `list_source_objects` surfaces the real per-source
   `/preview` instead (CSV/static → headers+rows; REST/SQL → row objects),
   selecting the endpoint by source type exactly as the frontend's `usePanelData`
   does.

These are wrappers over real endpoints — no backend logic is duplicated. If a
future tool needs behavior the API genuinely lacks, that is a signal to add a
backend endpoint deliberately, not to thicken this server.

## Verifying

`scripts/verify.ts` spawns the built server with the real MCP SDK **client** over
stdio and exercises every read tool, the resource, and the `create_pipeline` /
`add_outputs_from_shape` write tools:

```bash
npm run build
HELIO_API_BASE_URL=http://localhost:8080 HELIO_PAT=helio_pat_… npm run verify
```

`HELIO_PAT` is only the bootstrap credential. Each run mints its own PAT
(`expiresInDays: 1`, named `HEL-1264 verify <runId>`), runs the server under
it, and at the end deletes every pipeline and inline data source it created and
revokes the PAT, each by exact id and each confirmed (404 / 401). A failed
teardown prints the id and exits non-zero.

The write payloads are built by `scripts/verifyPayloads.ts`.
`scripts/verifyPayloads.test.ts` (collected by the root Jest run) sends each one
through the real registered tool in-process, so a payload the tool's input
schema rejects fails the suite without a backend.

### Isolated verify run (HEL-1297)

The harness's last section proves `get_output_history` with 30 real pipeline runs and reads all 30
points back in one call. Against the shared dev database that read can come back short: every worktree
backend shares one DB and each runs the hourly Output-history retention pass (HEL-1272), whose thin
`DELETE` covers **every** Output in the table using the **purging** backend's own policy. A sibling
backend at defaults collapses the fixture to about one point per five minutes, whatever
`OUTPUT_HISTORY_*` the verify backend itself runs with. (HEL-1343's lock-busy retry makes contending
backends purge _more_ often, not less.) The harness fails loudly rather than passing falsely, but it
fails intermittently. Plain `npm run verify` against a shared DB is therefore a smoke run only.

For the deterministic check use the isolated mode:

```bash
npm run build                                 # helio-mcp/dist
(cd ../backend && sbt assembly)               # backend/target/scala-2.13/helio-backend.jar
npm run verify:isolated
```

It needs `psql`, `createdb`, `dropdb`, `java` and `backend/.env` (its `DATABASE_URL` supplies the
Postgres host and credentials; the role needs `CREATEDB`). No other lane's DB or server is touched. It:

1. creates a uniquely named database `helio_verify_<random hex>`;
2. starts the backend jar as the JVM itself (the recorded PID is the server) on an OS-chosen
   ephemeral port, against that database, with `OUTPUT_HISTORY_PURGE_INTERVAL_MINUTES=1440` and
   `OUTPUT_HISTORY_LOCK_RETRY_SECONDS=86400` (capped at the interval by the backend), so after its
   startup pass no retention pass can fall inside the run, a busy or failed one included;
3. waits for the startup pass to finish (a second scheduler tick is observed in `pg_stat_user_tables`);
4. checks the port's listener is the recorded JVM, registers a throwaway user, confirms that user's row
   is in the dedicated database, and mints a bootstrap PAT;
5. runs the unchanged `scripts/verify.ts`, then revokes the PAT, stops the JVM by its recorded PID and
   drops the database by its recorded name, whether the run passed, failed or was interrupted
   (Ctrl-C); any removal it cannot confirm is named on stderr and makes the exit non-zero.

**Why it holds when other backends purge.** A purge can only delete rows in the database its backend
connects to. Nothing else connects to the dedicated database, so no other backend's pass, at any
interval, can reach the fixture. The lock-retry interaction (HEL-1343) is closed the same way: sibling
backends cannot take the purge advisory lock on a database they never open, and the isolated backend's own
overlap with a pipeline run (a write-time payload trim takes the same key shared) would re-arm a pass
only after the retry window, which is pinned to the 1440-minute interval.

Every identifier it creates (database, uploads directory, JVM PID, user id, PAT id, harness PID) is
printed as a `LEDGER` line and appended to a ledger file under the OS temp dir (path printed first), so
an interrupted or crashed run leaves exact names for manual removal. The cost is one JVM and Flyway
migration on a fresh database, roughly 20 seconds. The isolated backend also lifts the per-user API and
pipeline-run rate limits, since it has one user and a 429 whose `Retry-After` outlasts the MCP client's
60 second request timeout would otherwise fail the run.

## Project layout

```
src/
  index.ts       MCP server entry (stdio); registers tools + the context resource
  config.ts      env → { baseUrl, pat }, fail-fast on missing/malformed PAT
  httpClient.ts  thin typed fetch wrapper (mirrors frontend httpClient conventions)
  helioApi.ts    one typed function per capability (incl. the composed ones)
  context.ts     workspace-context serializer (HEL-222)
  types.ts       TS mirrors of the backend response shapes
  tools/read.ts  registers the read tools + get_workspace_context
  tools/write.ts registers the write/composition tools
scripts/
  verify.ts          end-to-end harness (real MCP client over stdio)
  verifyPayloads.ts  pure builders for verify's write-tool payloads
  verifyFixtures.ts  verify's PAT mint/revoke + exact-id teardown
  verifyIsolated.ts  `npm run verify:isolated` entry (HEL-1297)
  isolatedRun.ts     isolated run lifecycle: dedicated DB, backend JVM, harness, teardown
  isolatedDb.ts      psql/createdb/dropdb helpers and backend/.env parsing
  isolatedBackend.ts backend JVM launch, identity check, stop by exact PID
  isolatedAuth.ts    throwaway user + bootstrap PAT
```

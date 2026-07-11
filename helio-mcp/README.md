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

| Tool                    | Endpoint(s) used                                                  | Purpose                                                                      |
| ----------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `list_dashboards`       | `GET /api/dashboards`                                             | Paginated dashboard list                                                     |
| `get_dashboard`         | `GET /api/dashboards` + `GET /api/dashboards/:id/export`          | One dashboard **with its panels** (composed — see below)                     |
| `list_data_sources`     | `GET /api/data-sources`                                           | Data sources (csv/rest_api/sql/static)                                       |
| `list_source_objects`   | `GET /api/data-sources/:id/preview` or `/api/sources/:id/preview` | Inspect a source's shape (composed — see below)                              |
| `list_data_types`       | `GET /api/types`                                                  | DataTypes with columns; flags pipeline-output (bindable) vs source-companion |
| `get_data_type_rows`    | `GET /api/types/:id/rows`                                         | Latest pipeline-run row snapshot                                             |
| `list_pipelines`        | `GET /api/pipelines`                                              | Pipeline summaries                                                           |
| `get_pipeline`          | `GET /api/pipelines/:id` + `GET /api/pipelines/:id/steps`         | One pipeline **with its steps** (composed)                                   |
| `analyze_pipeline`      | `GET /api/pipelines/:id/analyze`                                  | Source schema + per-step input/output schema                                 |
| `get_workspace_context` | fan-out (see below)                                               | One compact snapshot of the whole workspace (**HEL-222**)                    |

### Write / composition tools

| Tool                      | Endpoint                                  | Purpose                                                                    |
| ------------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| `create_data_source`      | `POST /api/data-sources` (static)         | Create a static source from inline columns + rows                          |
| `create_csv_data_source`  | `POST /api/data-sources` (multipart, csv) | Create a CSV source from inline text content — no filesystem access needed |
| `create_rest_data_source` | `POST /api/sources` (`type: rest_api`)    | Create a REST API source; returns the companion DataType or a `fetchError` |
| `create_sql_data_source`  | `POST /api/sources` (`type: sql`)         | Create a SQL source; returns the companion DataType or a `fetchError`      |
| `create_pipeline`         | `POST /api/pipelines`                     | Create a pipeline → a new panel-bindable output DataType                   |
| `add_pipeline_step`       | `POST /api/pipelines/:id/steps`           | Append a transform step (config keyed by step type)                        |
| `run_pipeline`            | `POST /api/pipelines/:id/run`             | Run to completion (synchronous — rows exist on return, no polling)         |
| `create_dashboard`        | `POST /api/dashboards`                    | Create an empty dashboard                                                  |
| `create_panel`            | `POST /api/panels`                        | Create a panel on a dashboard                                              |
| `bind_panel`              | `PATCH /api/panels/:id`                   | Bind metric/chart/table to a pipeline-output DataType + mapping            |
| `update_panel_appearance` | `PATCH /api/panels/:id`                   | Update panel appearance (partial)                                          |

Each write tool returns the created resource's id so an agent can chain the
canonical path without re-listing. `bind_panel` field-mapping keys by type:
metric → `{value,label?,unit?}`; chart → `{xAxis,yAxis,series?}`; table →
`{columns}`. `create_csv_data_source` does not return a companion DataType
inline (same as `create_data_source`) — inspect it via `list_source_objects`.
`create_rest_data_source`/`create_sql_data_source` return `dataType: null` +
`fetchError` when the initial fetch/query fails at creation time, rather than
an opaque error, so the agent can diagnose and retry. Credentials (SQL
password, REST bearer token/api-key value) are redacted server-side and never
appear in any of these tools' results.

Plus one **resource**: `helio://workspace/context` — the same payload as
`get_workspace_context`, so an MCP client can attach it as ambient context.

Tool descriptions encode the canonical `DataSource → Pipeline → DataType →
Panel` path and the pipeline-only binding rule (V41): a panel may bind only to a
DataType whose `sourceId` is null (a pipeline output). Binding a source companion
is rejected with 400 — the error is surfaced verbatim, never worked around.

### End-to-end composition

`scripts/compose.ts` (`npm run compose`, with `HELIO_PAT` + `HELIO_API_BASE_URL`)
drives the write tools through a real MCP client to build a full dashboard from
scratch — source → pipeline → sort step → run → dashboard → metric/chart/table
panels bound to the pipeline output — then reads it back to assert the chain.
This is the composition verified rendering real data in the running app (see
`docs/agent-native.md` → "End-to-end proof").

## Context serializer

`get_workspace_context` (and the resource) return one snapshot:

```
{ generatedAt, counts,
  dataSources: [{id,name,type}],
  dataTypes:   [{id,name,sourceId,pipelineOutput,columns[],computedColumns[],version}],
  pipelines:   [{…summary, steps:[{position,type,outputColumns[],validationError}]}],
  dashboards:  [{id,name,panelCount}] }
```

It is a **client-side fan-out** over existing endpoints — no backend
aggregation. Call budget: `3` list calls (sources, types, dashboards) `+ 1`
pipelines list `+ 1 analyze per pipeline` = **4 + N(pipelines)**. For
workspace-sized data (handfuls of each) this is comfortably fast (the verified
run below was a single-digit number of calls completing in well under a second).

**When to add a backend `/api/context`:** only if pipeline count grows enough
that `N` analyze calls become the bottleneck. Not needed at Phase 2 scale — this
is flagged, not built, per the brief.

> **spray-json gotcha (load-bearing):** the backend omits `Option` fields that
> are `None` from the JSON entirely. A DataType that is a pipeline output has
> `sourceId = None`, so the wire has **no `sourceId` field at all**. The
> serializer normalizes a missing `sourceId` to `null` before deciding
> `pipelineOutput` — reading `sourceId === null` alone would misclassify the one
> panel-bindable DataType as a source companion.

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
stdio and exercises every tool + the resource:

```bash
npm run build
HELIO_API_BASE_URL=http://localhost:8080 HELIO_PAT=helio_pat_… npm run verify
```

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
  compose.ts     end-to-end composition harness (real MCP client, write tools)
  verify.ts      end-to-end harness (real MCP client over stdio)
```

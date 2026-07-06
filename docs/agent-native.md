# The Agent-Native Layer

Helio's REST API is the agent surface. This document describes how an agent —
Fable via MCP, any MCP client, or a plain shell script — goes from a **raw data
source to a finished multi-panel dashboard** entirely through tools,
authenticated as a real Helio user and honoring the ownership/RLS model and the
canonical `DataSource → Pipeline → DataType → Panel` path.

There are two client paths over one unchanged server:

```
  Agent (Fable / MCP client)              Shell script (curl + jq)
        │  MCP stdio/tools                       │  HTTP + PAT
        ▼                                        ▼
  helio-mcp/  (typed tool wrappers) ─────────────┴────►  Helio REST API
        │  + workspace context resource                  (unchanged, + PAT auth)
        └────────────────────────────────────────────────────►  Postgres (RLS)
```

Neither client holds business logic — both are thin wrappers over the same REST
endpoints. The only backend addition is Personal Access Token authentication.

## Authentication: Personal Access Tokens

Agents authenticate with a **Personal Access Token** (PAT) — a durable, hashed,
revocable credential distinct from a login session (HEL-148 Phase 1).

- Mint: `POST /api/tokens` (while logged in) → returns a raw `helio_pat_…` token
  **once**; only its SHA-256 hash is stored.
- Use: `Authorization: Bearer helio_pat_…` on any authenticated route.
- Manage: `GET /api/tokens` (metadata only), `DELETE /api/tokens/:id` (revoke).

A PAT resolves to the same `AuthenticatedUser` a session does, so it inherits
that user's exact row visibility — RLS is neither bypassed nor weakened. Revoked
and expired tokens return the standard 401.

```bash
SESSION=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"you@example.com","password":"…"}' | jq -r .token)
export HELIO_PAT=$(curl -s -X POST http://localhost:8080/api/tokens \
  -H "Authorization: Bearer $SESSION" -H 'Content-Type: application/json' \
  -d '{"name":"fable-mcp"}' | jq -r .token)
```

## The canonical path

A panel can only render data that has flowed through the full chain — this is
enforced server-side (V41) and mirrored in every tool description:

```
DataSource ──create_pipeline──► Pipeline ──run──► DataType (pipeline output) ──bind──► Panel
   (raw)        (+ steps)                  (rows)     (sourceId = null)          (chart/metric/table)
```

A DataType with a non-null `sourceId` is a **source companion** and is NOT
panel-bindable; binding one returns HTTP 400. Only pipeline outputs
(`sourceId = null`) may be bound.

> **Wire note:** spray-json omits `None` fields, so a pipeline-output DataType
> arrives with **no `sourceId` field at all**. Detect a bindable type as
> `(sourceId ?? null) === null`, never `=== null`.

## Endpoint → tool map

| Primitive            | Endpoint(s)                                                       | MCP tool / script                         |
| -------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| Create PAT           | `POST /api/tokens`                                                | — (bootstrap)                             |
| Workspace snapshot   | fan-out over the read endpoints                                   | `get_workspace_context` · `workspace.sh`  |
| List dashboards      | `GET /api/dashboards`                                             | `list_dashboards`                         |
| Get dashboard+panels | `GET /api/dashboards` + `GET /api/dashboards/:id/export`          | `get_dashboard` (composed)                |
| List data sources    | `GET /api/data-sources`                                           | `list_data_sources`                       |
| Inspect a source     | `GET /api/data-sources/:id/preview` \| `/api/sources/:id/preview` | `list_source_objects` (composed)          |
| List DataTypes       | `GET /api/types`                                                  | `list_data_types`                         |
| DataType rows        | `GET /api/types/:id/rows`                                         | `get_data_type_rows`                      |
| List pipelines       | `GET /api/pipelines`                                              | `list_pipelines`                          |
| Get pipeline+steps   | `GET /api/pipelines/:id` + `/:id/steps`                           | `get_pipeline` (composed)                 |
| Analyze pipeline     | `GET /api/pipelines/:id/analyze`                                  | `analyze_pipeline`                        |
| Create data source   | `POST /api/data-sources` (static)                                 | `create_data_source` · `create-source.sh` |
| Create pipeline      | `POST /api/pipelines`                                             | `create_pipeline` · `create-pipeline.sh`  |
| Add step             | `POST /api/pipelines/:id/steps`                                   | `add_pipeline_step` · `add-step.sh`       |
| Run pipeline         | `POST /api/pipelines/:id/run` (synchronous)                       | `run_pipeline` · `run-pipeline.sh`        |
| Create dashboard     | `POST /api/dashboards`                                            | `create_dashboard`                        |
| Create panel         | `POST /api/panels`                                                | `create_panel` · `create-panel.sh`        |
| Bind panel           | `PATCH /api/panels/:id`                                           | `bind_panel` · `bind-panel.sh`            |
| Panel appearance     | `PATCH /api/panels/:id`                                           | `update_panel_appearance`                 |

Three endpoints named in the original design do not exist on `main`; the tools
compose real endpoints instead (documented in `helio-mcp/README.md` →
"Endpoint reality"): there is no `GET /api/dashboards/:id`, no
`GET /api/dashboards/:id/panels`, and no `GET /api/data-sources/:id/sources`.

**Runs are synchronous.** `POST /api/pipelines/:id/run` returns only after the
in-process engine finishes and writes rows, so a panel can be bound immediately
after — there is no async run to poll and no race.

## Running the two clients

### MCP server (`helio-mcp/`)

```bash
cd helio-mcp && npm install && npm run build
HELIO_PAT=helio_pat_… node dist/index.js     # MCP over stdio
```

Wire it into an MCP client with `command: node`, `args: [dist/index.js]`, and
`HELIO_PAT` in `env`. See `helio-mcp/README.md` for the full tool catalog.

### Shell scripts (`scripts/agent/`)

```bash
export HELIO_PAT=helio_pat_…
scripts/agent/compose-demo.sh     # source → pipeline → run → dashboard → panels
scripts/agent/workspace.sh | jq   # inspect the workspace
```

## End-to-end proof

Using only the MCP write tools, an agent composes:

1. `create_data_source` — a static "Quarterly Sales" source (region, revenue).
2. `create_pipeline` + `add_pipeline_step` (sort by revenue desc).
3. `run_pipeline` — synchronous; writes 4 rows to the output DataType.
4. `create_dashboard` + three `create_panel`/`bind_panel` pairs (metric, chart,
   table), each bound to the pipeline-output DataType.

The dashboard then renders real data in the running app — the table sorted
320/265/210/180, a descending line chart, and a "320 / North" metric, all marked
"Data as of …". Reproduce the composition with `helio-mcp/scripts/compose.ts`
(`npm run compose`) or `scripts/agent/compose-demo.sh`.

> Note: the original brief referenced a "seeded demo CSV source" — `DemoData`
> seeds only dashboards (no sources/pipelines), so the proof creates its own
> static source, which exercises the write path more completely.

## Proposal → Review → Apply

Beyond direct tool composition, there is a human-in-the-loop path: an agent
produces a structured **dashboard proposal** (no writes), a user reviews it
in-app (accept / edit / reject), and only on acceptance is it applied. The
proposal is one shared artifact (`schemas/dashboard-proposal.schema.json`) used
by both the MCP `propose_dashboard`/`apply_proposal` tools and the in-app
Proposal Review UI. Apply goes through `POST /api/dashboards/apply-proposal`,
which validates and then creates the dashboard + panels via the existing
services under the caller's RLS context — no direct DB access, no bypass of the
canonical path. See that endpoint and the review UI for details.

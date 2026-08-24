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

For a recurring external workflow that should be confined to re-running one or
two specific pipelines rather than carrying the account's full authority, mint
a **scoped** token instead — see
["Scoped tokens + the external-trigger hook"](#scoped-tokens--the-external-trigger-hook-hel-369)
below.

```bash
SESSION=$(curl -s -X POST http://localhost:8080/api/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"you@example.com","password":"…"}' | jq -r .token)
export HELIO_PAT=$(curl -s -X POST http://localhost:8080/api/tokens \
  -H "Authorization: Bearer $SESSION" -H 'Content-Type: application/json' \
  -d '{"name":"fable-mcp"}' | jq -r .token)
```

### Scoped tokens + the external-trigger hook (HEL-369)

For a recurring, unattended workflow (a systemd timer, Cloud Scheduler, cron)
that should only ever be able to re-run one or two specific pipelines — never
the account's full authority — mint a **scoped** token instead of a full-access
PAT: pass `scopedPipelineIds`, an allow-list of pipeline ids the caller owns or
has **editor** access to (viewer-only access is rejected at mint time — a
viewer grantee can never trigger a run, so a token scoped to one would mint
successfully but never work).

```bash
export HELIO_HOOK_PAT=$(curl -s -X POST http://localhost:8080/api/tokens \
  -H "Authorization: Bearer $HELIO_PAT" -H 'Content-Type: application/json' \
  -d '{"name":"helio-news-rebuild","scopedPipelineIds":["<pipeline-id>"]}' | jq -r .token)
```

A scoped token authenticates like any other `helio_pat_…` bearer credential,
with one hard restriction: it is confined to **`POST /api/hooks/run`** and,
within that route, to the pipeline ids in its allow-list — every other
authenticated route (including public/optional-auth read routes) rejects it
with `403 Forbidden`, even though it resolves to the token owner's real
identity under the hood. This confinement is enforced once, ahead of every
route family, so it cannot be bypassed by any route that resolves PAT bearer
identity — see `AuthDirectives.confineScopedToken`. An unscoped PAT (no
`scopedPipelineIds`) is completely unaffected and keeps working exactly as
described above.

Trigger a rebuild:

```bash
curl -s -X POST http://localhost:8080/api/hooks/run \
  -H "Authorization: Bearer $HELIO_HOOK_PAT" -H 'Content-Type: application/json' \
  -d '{"pipelineId":"<pipeline-id>"}'
# {"runId":"…","pipelineId":"<pipeline-id>","status":"succeeded"}
```

The hook delegates straight to the same synchronous run-lifecycle path
`POST /api/pipelines/:id/run` and the HEL-415 scheduler use
(`PipelineRunService.submit`, `trigger_source = "external"`) — there is no
second run-invocation path, and no async run to poll. Every triggered run is
readable via the existing `GET /api/pipelines/:id/run-history`, tagged
`triggerSource: "external"`. When a **scoped** token authenticated the
trigger, the run record also carries `triggeredByTokenId` — the audit trail
this ticket's acceptance criteria ask for; there is no separate audit
endpoint. (An unscoped PAT can call the hook too, exactly as any other
authenticated route — but its `triggeredByTokenId` is absent: the
`AuthDirectives.confineScopedToken` chokepoint only extracts a token's id
for a _scoped_ row, since only scoped tokens need per-request confinement
data. If per-token audit for unscoped PATs matters for a given workflow,
mint the token scoped.) Calling the hook again for a pipeline that already
has a run in flight does not start a second run: it returns the in-flight
run's `runId`/status instead, so a rapid retry from an external scheduler is
a no-op rather than a duplicate rebuild.

**Known exposure**: there is no rate limiting or replay-window enforcement on
`POST /api/hooks/run` in this ticket. The mitigations are the token's narrow
scope (a compromised scoped token can only re-trigger its allow-listed
pipelines), the duplicate-trigger collapse described above, and revocation
(`DELETE /api/tokens/:id`, already supported). A follow-up ticket can add
per-token rate limiting if abuse is observed in practice.

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
| External trigger     | `POST /api/hooks/run` (HEL-369; scoped-or-unscoped PAT)           | — (external scheduler, not MCP)           |
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
proposal is one shared artifact (`schemas/dashboards/dashboard-proposal.schema.json`) used
by both the MCP `propose_dashboard`/`apply_proposal` tools and the in-app
Proposal Review UI. Apply goes through `POST /api/dashboards/apply-proposal`,
which validates and then creates the dashboard + panels via the existing
services under the caller's RLS context — no direct DB access, no bypass of the
canonical path. See that endpoint and the review UI for details.

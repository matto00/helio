# The Agent-Native Layer

Helio's REST API is the agent surface. This document describes how an agent —
Fable via MCP, any MCP client, or a plain shell script — goes from a **raw data
source to a finished multi-panel dashboard** entirely through tools,
authenticated as a real Helio user and honoring the ownership/RLS model and the
canonical `Source → Pipeline → Output → Dashboard` path (HEL-903/904/906/907 —
the pipelines-and-outputs remodel retired the DataType/Metric model this
document originally described; see "Tool renames" below for the full
before/after tool list).

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
enforced server-side and mirrored in every tool description:

```
Source ──create_pipeline──► Pipeline ──run──► Output (attached to a node) ──place──► Panel
 (raw)      (+ steps)                 (rows)   (id/kind/schema)              (output-kind)
```

An Output is the panel-bindable projection of one pipeline node: `nodeStepId`
absent means it is attached directly to the pipeline's source; present, it is
attached to that specific step, grounded against that step's own projected
schema (not the trunk's). `place_outputs` creates one placement panel per
Output on a dashboard.

> **Wire note:** spray-json omits `None` fields, so an Output attached
> directly to a pipeline's source arrives with **no `nodeStepId` field at
> all**. Normalize a missing `nodeStepId` to `null` before deciding which
> case it is, never `=== null` without that normalization.

## Endpoint → tool map

| Primitive               | Endpoint(s)                                                         | MCP tool                         |
| ----------------------- | ------------------------------------------------------------------- | -------------------------------- |
| Create PAT              | `POST /api/tokens`                                                  | — (bootstrap)                    |
| Workspace snapshot      | fan-out over the read endpoints                                     | `get_workspace_context`          |
| List dashboards         | `GET /api/dashboards`                                               | `list_dashboards`                |
| Get dashboard+panels    | `GET /api/dashboards` + `GET /api/dashboards/:id/export`            | `get_dashboard` (composed)       |
| List data sources       | `GET /api/data-sources`                                             | `list_data_sources`              |
| Inspect a source        | `GET /api/data-sources/:id/preview` \| `/api/sources/:id/preview`   | `list_source_objects` (composed) |
| List pipelines          | `GET /api/pipelines`                                                | `list_pipelines`                 |
| Get pipeline+steps      | `GET /api/pipelines/:id` + `/:id/steps`                             | `get_pipeline` (composed)        |
| Analyze pipeline        | `GET /api/pipelines/:id/analyze`                                    | `analyze_pipeline`               |
| List Outputs            | `GET /api/pipelines/:id/outputs` \| `GET /api/outputs`              | `list_outputs`                   |
| Output rows             | `GET /api/outputs/:id/rows`                                         | `get_output_rows`                |
| Preview Output(s)       | `POST /api/pipelines/:id/preview`                                   | `preview_outputs`                |
| Node/Output capability  | `GET /api/pipelines/:id/capabilities`                               | `get_output_capabilities`        |
| Create data source      | `POST /api/data-sources` (static)                                   | `create_data_source`             |
| Create pipeline         | `POST /api/pipelines` (single call: roots/steps/outputs)            | `create_pipeline`                |
| Add step                | `POST /api/pipelines/:id/steps`                                     | `add_pipeline_step`              |
| Add Output(s) via shape | `POST /api/pipeline-shapes/:id/expand` + steps + `POST .../outputs` | `add_outputs_from_shape`         |
| Add one Output          | `POST /api/pipelines/:id/outputs`                                   | `add_output`                     |
| Run pipeline            | `POST /api/pipelines/:id/run` (synchronous)                         | `run_pipeline`                   |
| External trigger        | `POST /api/hooks/run` (HEL-369; scoped-or-unscoped PAT)             | — (external scheduler, not MCP)  |
| Create dashboard        | `POST /api/dashboards`                                              | `create_dashboard`               |
| Place Output(s)         | `POST /api/panels/batch` (+ best-effort auto-layout follow-up)      | `place_outputs`                  |
| Create content panel    | `POST /api/panels` (text/markdown/image/divider — no data binding)  | `create_content_panel`           |
| Panel appearance        | `PATCH /api/panels/:id`                                             | `update_panel_appearance`        |

Three endpoints named in the original design do not exist on `main`; the tools
compose real endpoints instead (documented in `helio-mcp/README.md` →
"Endpoint reality"): there is no `GET /api/dashboards/:id`, no
`GET /api/dashboards/:id/panels`, and no `GET /api/data-sources/:id/sources`.

**Runs are synchronous.** `POST /api/pipelines/:id/run` returns only after the
in-process engine finishes and writes rows, so a panel can be placed
immediately after — there is no async run to poll and no race.

## Tool renames (HEL-903/904/906/907)

The pipelines-and-outputs remodel retired the DataType/Metric model outright
(no deprecation window) and rewrote helio-mcp's tool surface onto Outputs. No
old tool name is aliased to its replacement — a removed tool is genuinely
absent, verified by an exact-tool-name-set test
(`helio-mcp/src/server.test.ts`).

| Old tool                                                                            | Status / replacement                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create_panel` / `create_panels`                                                    | → `place_outputs` (data panels) / `create_content_panel` (text/markdown/image/divider)                                                                                                                 |
| `bind_panel`                                                                        | → `place_outputs` (a panel is created ALREADY bound to an Output; there is no separate bind step)                                                                                                      |
| `create_bound_panel`                                                                | removed outright — its backend route (`POST /api/panels/bound`) no longer exists                                                                                                                       |
| `get_panel_capabilities`                                                            | → `get_output_capabilities(pipelineId, stepId?)`                                                                                                                                                       |
| `create_pipeline_from_shape`                                                        | → `add_outputs_from_shape(pipelineId, stepId?, shape, params)` — expands a shape onto an EXISTING pipeline instead of always creating a new one, and creates a real Output (the old tool created zero) |
| `list_data_types`                                                                   | removed outright — no replacement; a pipeline's Outputs are listed via `list_outputs` / `get_workspace_context`'s `pipelines[].outputs[]`                                                              |
| `get_data_type_rows`                                                                | → `get_output_rows(outputId)`                                                                                                                                                                          |
| `update_data_type` / `delete_data_type`                                             | removed outright — no replacement; an Output has no independent update/delete surface separate from its producing pipeline node                                                                        |
| `list_metrics` / `get_metric` / `create_metric` / `update_metric` / `delete_metric` | removed outright, no replacement — the Metric semantic layer (HEL-446/493) was deleted wholesale by HEL-904, not migrated onto Outputs                                                                 |

`create_pipeline`/`add_pipeline_step` are NOT renamed but ARE reshaped:
`create_pipeline` is now a single agent-facing call accepting `roots[]` (one
or more, each `sourceId` **or** inline source spec — HEL-913 multi-root
pipelines), `steps[]` (with `parentStepId` for tree/branching shape), and
optional `outputs[]`, replacing the old create-then-add-steps-one-at-a-time
flow; `add_pipeline_step` gained `parentStepId` and `rootId`; `add_root`/
`remove_root` manage roots on an existing pipeline.

> **`scripts/agent/*.sh` are STALE, not yet updated for this remodel** —
> `create-panel.sh`/`bind-panel.sh`/`compose-demo.sh`/`workspace.sh` all still
> call the retired DataType-era endpoints/panel shape (`dataTypeId`/
> `fieldMapping` PATCH bodies, `GET /api/types`) and will fail or behave
> incorrectly if run today. Flagged here rather than silently left presented
> as current — fixing them is tracked as follow-up work, not done as part of
> this ticket's `docs/agent-native.md` update (out of this task's stated
> scope: "update `docs/agent-native.md` with the tool rename table"). Prefer
> `helio-mcp/` (kept in parity throughout this remodel, verified by its own
> test suite) for anything beyond ad-hoc `curl`/`jq` exploration until these
> scripts are updated.

## Running the two clients

### MCP server (`helio-mcp/`)

```bash
cd helio-mcp && npm install && npm run build
HELIO_PAT=helio_pat_… node dist/index.js     # MCP over stdio
```

Wire it into an MCP client with `command: node`, `args: [dist/index.js]`, and
`HELIO_PAT` in `env`. See `helio-mcp/README.md` for the full tool catalog.

### Shell scripts (`scripts/agent/`)

**STALE** — see the callout in "Tool renames" above. These predate the
pipelines-and-outputs remodel and still call retired endpoints; do not treat
the commands below as currently working.

```bash
export HELIO_PAT=helio_pat_…
scripts/agent/compose-demo.sh     # source → pipeline → run → dashboard → panels
scripts/agent/workspace.sh | jq   # inspect the workspace
```

## End-to-end proof

**Updated for the pipelines-and-outputs remodel (HEL-903/904/906/907).** The
original proof described here (`create_panel`/`bind_panel` against retired
`metric`/`chart` panel kinds bound to a pipeline-output DataType) no longer
applies to the current model. `helio-mcp/scripts/compose.ts` and
`helio-mcp/scripts/verify-bound-panel.ts` were premised entirely on those
retired tools with no salvageable current-model role — both were deleted
outright (HEL-907 evaluator-1 CR2), along with their `npm run compose`/
`npm run verify-bound-panel` package.json scripts. `helio-mcp/scripts/verify.ts`
retains a valid role (exercising every read tool + the workspace-context
resource against a live backend) and was retargeted onto the current tool
surface in the same fix: `list_data_types` → `list_outputs`,
`get_data_type_rows` → `get_output_rows`, and the `create_pipeline_from_shape`
test block → `add_outputs_from_shape` (run via `npm run verify`).

The current-model composition — `create_data_source` (or an inline source
via `create_pipeline` itself) → `create_pipeline` (with `roots[]`/`steps[]`/
`outputs[]` in one call) → `run_pipeline` → `create_dashboard` →
`place_outputs` — has
been verified for real against a live backend, not just typechecked:
`helio-mcp/e2e/sleeper-rebuild.ts` (tasks.md task 5.1) rebuilds four
representative Sleeper-shaped dashboards (rosters/matchups/standings/
transactions — static, domain-shaped data, not a live Sleeper API pull, per
the script's own header comment) end to end, including a daily refresh
schedule set via `set_pipeline_schedule` and read back via
`get_pipeline_schedule`. Run twice against this project's own isolated
per-worktree backend to confirm the tag-based teardown-then-rebuild path is
idempotent (every created resource — source, pipeline, Output, and dashboard
— is tagged and reclaimable via `teardown_resources`), then cleaned up. See
that script's own header comment for the exact composition and how to run it
again.

## Worked example: multi-root, multi-lane pipeline (HEL-914)

`create_pipeline` accepts more than one `roots[]` element and lets `steps[]` branch into sibling
lanes via `parentStepId`, with a `join`/`union`/`lookup` step rejoining another lane via a
`lane`-kind `secondaryInput`. Below is a real, executed two-root "projections ⨝ ADP" shape — one
root holding player weekly projections, a second holding average-draft-position (ADP) rankings,
joined on a shared key into one combined Output — captured from a genuine run against a real
backend (`Hel914Ac1EndToEndSpec`, embedded Postgres, not hand-typed): the request/response pair
below substitutes this doc's own domain-appropriate names (`Projections`/`ADP`/`projected_points`)
for that test's literal (`Orders`/`Regions`/`amount`) column names, but every id shape, field name,
and structural rule is the actual wire contract exercised end to end — schema-valid, decodable, and
proven to persist exactly the graph shown.

**`create_pipeline`** (`POST /api/pipelines`):

```json
{
  "name": "Projections vs ADP",
  "roots": [
    { "clientId": "r1", "sourceId": "<projections-source-id>" },
    { "clientId": "r2", "sourceId": "<adp-source-id>" }
  ],
  "steps": [
    {
      "clientId": "s1",
      "type": "select",
      "rootClientId": "r1",
      "config": { "fields": ["player_id", "projected_points"] }
    },
    {
      "clientId": "s2",
      "type": "select",
      "rootClientId": "r2",
      "config": { "fields": ["player_id", "adp_rank"] }
    },
    {
      "clientId": "s3",
      "type": "join",
      "parentStepId": "s1",
      "config": {
        "joinKey": "player_id",
        "joinType": "inner",
        "secondaryInput": { "kind": "lane", "stepId": "s2" }
      }
    }
  ],
  "outputs": [
    { "nodeStepClientId": "s1", "kind": "table", "name": "ProjectionsOutput" },
    { "nodeStepClientId": "s2", "kind": "table", "name": "ADPOutput" },
    { "nodeStepClientId": "s3", "kind": "table", "name": "ProjectionsVsADP" }
  ]
}
```

`s1`/`s2` are each parentless and bind their own root explicitly via `rootClientId` (never a silent
default to `roots[0]` — required whenever more than one root is present). `s3` continues `s1`'s lane
(`parentStepId: "s1"`) and rejoins `s2`'s lane via `secondaryInput: {kind: "lane", stepId: "s2"}`,
so its own projected schema carries columns from BOTH lanes.

**Response** (`PipelineSummaryResponse`, ids redacted to the real run's shape):

```json
{
  "id": "<pipeline-id>",
  "name": "Projections vs ADP",
  "roots": [
    {
      "id": "<root-1-id>",
      "dataSourceId": "<projections-source-id>",
      "dataSourceName": "Projections"
    },
    { "id": "<root-2-id>", "dataSourceId": "<adp-source-id>", "dataSourceName": "ADP" }
  ]
}
```

Both roots come back in the SAME order they were submitted — `roots[0]` is always the caller's
first root, never resorted.

**`get_workspace_context`** (`GET /api/workspace/context`) then reflects this pipeline's compact
lane tree — one entry per step, each `parentId`/`rootId` resolved to REAL persisted ids (never the
request-scoped `clientId`s the create call used), and each step's bound Output id:

```json
[
  {
    "id": "<s1-id>",
    "op": "select",
    "rootId": "<root-1-id>",
    "outputIds": ["<projections-output-id>"]
  },
  {
    "id": "<s3-id>",
    "op": "join",
    "parentId": "<s1-id>",
    "rootId": "<root-1-id>",
    "outputIds": ["<projections-vs-adp-output-id>"]
  },
  { "id": "<s2-id>", "op": "select", "rootId": "<root-2-id>", "outputIds": ["<adp-output-id>"] }
]
```

`s3`'s `rootId` is `root-1`'s (it continues `s1`'s lane) even though its own schema derives from
BOTH roots — `rootId` names the node's OWN lane ancestry, never the rejoined lane. Place each
Output with `place_outputs(dashboardId, [{outputId: "<output-id>", title: "..."}])`.

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

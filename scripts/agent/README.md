# Helio agent shell scripts

Thin `curl` + `jq` wrappers over Helio's REST API — the shell-parity twin of the
[`helio-mcp`](../../helio-mcp/) tools. They let a non-MCP agent (or a human, or
Fable-via-Bash) drive Helio from a shell, and they double as **living, runnable
API documentation**: read a script to see the exact request an endpoint expects.

No business logic lives here — each script is one authenticated HTTP call.

## Setup

```bash
export HELIO_API_BASE_URL=http://localhost:8080   # optional; this is the default
export HELIO_PAT=helio_pat_…                       # required; mint via POST /api/tokens
```

Dependencies: `bash`, `curl`, `jq`.

Mint a PAT (see also `helio-mcp/README.md`):

```bash
SESSION=$(curl -s -X POST "$HELIO_API_BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' -d '{"email":"you@example.com","password":"…"}' | jq -r .token)
export HELIO_PAT=$(curl -s -X POST "$HELIO_API_BASE_URL/api/tokens" \
  -H "Authorization: Bearer $SESSION" -H 'Content-Type: application/json' \
  -d '{"name":"agent-shell"}' | jq -r .token)
```

## Scripts

| Script               | Wraps                                       | Purpose                                        |
| -------------------- | ------------------------------------------- | ---------------------------------------------- |
| `workspace.sh`       | GET dashboards/types/pipelines/data-sources | Compact workspace snapshot (fan-out)           |
| `create-source.sh`   | `POST /api/data-sources`                    | Create a static source (inline columns+rows)   |
| `create-pipeline.sh` | `POST /api/pipelines`                       | Create a pipeline → panel-bindable output type |
| `add-step.sh`        | `POST /api/pipelines/:id/steps`             | Append a transform step                        |
| `run-pipeline.sh`    | `POST /api/pipelines/:id/run`               | Run to completion (synchronous)                |
| `create-panel.sh`    | `POST /api/panels`                          | Create a panel                                 |
| `bind-panel.sh`      | `PATCH /api/panels/:id`                     | Bind a panel to a pipeline-output DataType     |
| `compose-demo.sh`    | all of the above                            | End-to-end demo (source → dashboard)           |
| `_lib.sh`            | —                                           | Shared env + `helio_get/post/patch` helpers    |

## End-to-end

```bash
./compose-demo.sh          # builds a full dashboard, prints DASHBOARD_ID=<id>
./workspace.sh | jq        # inspect what now exists
```

## Notes

- **Synchronous runs:** `POST /api/pipelines/:id/run` returns only after the
  in-process engine finishes and writes rows, so `run-pipeline.sh` needs no
  polling and there is no race before binding a panel.
- **Pipeline-only binding (V41):** panels bind only to pipeline-output DataTypes
  (`sourceId` null). `bind-panel.sh` against a source-companion DataType returns
  HTTP 400 by design.
- **spray-json omits `null`:** a DataType with no `sourceId` field on the wire is
  a pipeline output; `workspace.sh` normalizes with `(.sourceId // null)`.

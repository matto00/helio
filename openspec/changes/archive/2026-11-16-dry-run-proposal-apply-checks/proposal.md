## Why

The assistant presented a pipeline proposal whose Output mapped `display_name`, a column absent at its node. Every
propose-time check passed; apply failed. Propose (`PipelineProposalService.validate`, `CombinedProposalService.validate`,
patch-set preview, `DashboardProposalService.validate`) and apply run two different lists of checks, and the
column-existence check (plus several others) exists only on the apply side. MCP `propose_pipeline`/`propose_dashboard`
call no backend validation at all.

## What Changes

- A disabled step now projects as pass-through in apply's column check, as in analyze and the run (apply fix).
- A dry-run validator per proposal kind that runs apply's own pre-write checks, writing nothing. Shared code, not a
  copy: apply calls the same dry run first, and the write path keeps its checks as defense in depth.
- Pipeline (and the pipeline half of combined): inline-csv rejection, inline-source create checks, preflight
  (lanes, Output config), cross-owner and upsert ownership, cycle guard, and each Output's fieldMapping
  slot + column-at-node check against the symbolically analyzed node schema.
- Patch-set `pipeline` create edits: the same pipeline dry run at resolve (preview and apply).
- Combined: layout, `$pipelineOutput` sentinel count, real-Output panel bindings and controls.
- Dashboard and patch-set panel create/update: the panel builder's config decode, `validateConfig`, binding and
  controls checks.
- A rejection is a `Left` the assistant already turns into an `is_error` tool_result with apply's message.
- New HTTP routes `POST /api/pipelines/validate-proposal`, `POST /api/dashboards/validate-proposal`,
  `POST /api/proposals/validate`; helio-mcp `propose_pipeline`/`propose_dashboard` call them.

## Capabilities

### New Capabilities
- `proposal-dry-run-validation`: propose-time dry run of apply's checks for every proposal kind, its HTTP routes, and
  the MCP and assistant surfaces that use it.

### Modified Capabilities
(none)

## Non-goals

- The pipeline run itself (row reads, assertion-blocked runs): not dry-runnable; stays apply-only.
- Workspace changes between propose and apply (stale data): unchanged, separately messaged.
- Patch-set step add/update and data-source edit checks beyond today's preview: follow-up ticket. (Patch-set
  `pipeline` create edits are in scope.)
- Apply-time cycle guards and sentinel-panel controls, if task 0.2 finds they cannot run without writes: recorded
  apply-only with the reason.
- Tool `input_schema` shapes (HEL-1639 release hold) and `ClaudeClient`/`ClaudeProtocol`/`ClaudeModels` (HEL-1636).
- Live Anthropic calls.

## Impact

Backend `services/pipelines`, `services/proposals`, `services/patchsets`, `services/panels`, `services/sources`,
`services/assistant` (no tool-schema change); three routes plus `schemas/`; `helio-mcp` proposal handlers. No migration.

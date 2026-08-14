## Why

`helio-mcp` can create and delete every core resource (data source, DataType, pipeline, pipeline
step) but cannot edit one in place — an agent has to delete-and-recreate to revise a resource,
which is lossy (breaks bindings, run history, ids). The backend already exposes PATCH endpoints
for all four; this wires thin MCP tools over them. This is the stated foundational prerequisite
for the HEL-343 (Conversational Refinement) epic's patch-set editing.

## What Changes

- New `update_data_source` tool (`PATCH /api/data-sources/:id`) — rename only; the backend's
  `UpdateDataSourceRequest` has no other mutable field today.
- New `update_data_type` tool (`PATCH /api/types/:id`) — `name`/`fields`/`computedFields`, each
  independently omittable; when `fields` or `computedFields` IS provided it wholesale-replaces the
  existing array (not a per-item merge) — the tool description states this explicitly.
- New `update_pipeline` tool (`PATCH /api/pipelines/:id`) — rename only (the backend's
  `UpdatePipelineRequest` has exactly one, required field).
- New `update_pipeline_step` tool (`PATCH /api/pipeline-steps/:id`) — `config` and/or `position`.
  Deliberately does NOT expose the backend's `type` field: sending a `type` that differs from the
  step's existing kind always 400s ("delete and create a new one instead"), and a matching `type`
  is a no-op, so exposing it would only invite a dead-end call.
- Each is a thin pass-through in `helio-mcp/src/tools/write.ts` + a method on `HelioApi`, mirroring
  `add_pipeline_step`/`update_panel_appearance`. Reuses the shared `guarded` wrapper so backend
  400/403/404s surface verbatim (RLS + V41 stay authoritative server-side).

## Non-goals

- Full "edit source config" beyond rename (data source, pipeline) — the backend doesn't expose it;
  out of scope to add new backend PATCH fields in this ticket.
- Changing a pipeline step's `type` — the backend enforces immutability by design.
- `update_panel` (title/type/config beyond appearance) — tracked separately as HEL-627.
- Duplicate ops, sharing/permissions routes, `panels/updateBatch`, source refresh, expression
  validation, dashboard import, run introspection, auth/users/tokens — all pre-existing,
  deliberately out-of-scope MCP↔API gaps per the ticket.

## Capabilities

### New Capabilities

- `mcp-edit-in-place-tools`: the four `update_*` MCP tools (data source, DataType, pipeline,
  pipeline step) wrapping existing backend PATCH endpoints.

### Modified Capabilities

(none — no existing capability spec covers write.ts's core CRUD tools; this is a new, standalone
bundle, same shape as `mcp-panel-composition-tools`/`mcp-pipeline-shape-tools`)

## Impact

- New: 4 MCP tools in `helio-mcp/src/tools/write.ts`, 4 methods on `HelioApi`
  (`helio-mcp/src/helioApi.ts`), README tool table entries, `dist/` rebuild.
- No backend changes — all four PATCH endpoints already exist and are unmodified.
- No schema changes (MCP-only; no `schemas/` JSON Schema or Scala protocol touched).

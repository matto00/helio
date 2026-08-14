# HEL-328: helio-mcp: add edit-in-place (PATCH) tools for data-source, DataType, pipeline, and pipeline-step

## Description

The `helio-mcp` server is a curated agent surface over the Helio REST API, covering the `DataSource → Pipeline → DataType → Panel → Dashboard` authoring path (create / read / delete / bind / run / layout / propose / apply). A parity audit against `ApiRoutes.scala` found that the MCP can **create and delete** every core resource but cannot **edit one in place** — agents currently have to delete-and-recreate to revise an existing resource, which is lossy (breaks bindings, run history, ids).

The backend already exposes the PATCH endpoints; this is net-new MCP tooling that wraps them.

This ticket is the stated foundational prerequisite for the HEL-343 epic ("Epic — Conversational Refinement") — its own description calls this out as "the mutation primitives" the epic needs. Delivery order for the epic (per human direction): HEL-328 (this ticket) → HEL-627 → HEL-403 → HEL-406 → HEL-408 → HEL-411 → HEL-413.

## Scope — add MCP tools wrapping existing PATCH endpoints

| New MCP tool | Backend endpoint | Purpose |
| -- | -- | -- |
| `update_data_source` | `PATCH /api/data-sources/:id` | rename / edit source config in place |
| `update_data_type` | `PATCH /api/types/:id` | rename / edit a DataType (e.g. computed fields) |
| `update_pipeline` | `PATCH /api/pipelines/:id` | rename / edit pipeline metadata |
| `update_pipeline_step` | `PATCH /api/pipeline-steps/:id` | edit a step's `config` without delete + re-add (which loses ordering) |

Each is a thin pass-through in `helio-mcp/src/tools/write.ts` + a method on `HelioApi` (`helio-mcp/src/helioApi.ts`), mirroring the existing `add_pipeline_step` / `update_panel_appearance` pattern. Reuse the shared `guarded` error wrapper so the backend's 400/403/404 surfaces verbatim (RLS + V41 stay authoritative server-side).

## Out of scope (tracked separately if wanted)

Other known MCP↔API gaps deliberately excluded from this ticket: duplicate ops (`dashboards/:id/duplicate`, `panels/:id/duplicate`), sharing/permissions routes, `panels/updateBatch`, `data-sources/:id/refresh`, `types/:id/validate-expression`, `dashboards/import`, pipeline run introspection (run-history / status / step-preview / SSE — moot because `run_pipeline` is synchronous in the MCP), and auth/users/tokens (human-app concerns). `update_panel` (title/type/config, not just appearance) is separately tracked as HEL-627, next in the epic's delivery order after this ticket.

## Acceptance criteria

- [ ] The four `update_*` tools registered and callable, each returning the updated resource JSON.
- [ ] Tool descriptions state exactly which fields are patchable and that the patch is partial (only provided fields change).
- [ ] `analyze_pipeline` reflects a step config edited via `update_pipeline_step`.
- [ ] README tool table updated; `dist/` rebuilt.
- [ ] Follows the pipeline-op wiring / apply-infer parity conventions where a step type touches transform config.

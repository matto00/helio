# HEL-1081: MCP tools for datasets

## Description

Expose datasets on the agent surface: create a dataset with a declared schema, append rows, replace rows, read rows. The internal REST API is the agent surface — every endpoint added here is a future MCP tool.

**AC:** an agent can create a dataset, populate it, and build a pipeline over it end to end without a UI.

---

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Acceptance Criteria

- An agent (via helio-mcp tools only, no UI) can:
  - Create a `dataset` data source with a **declared schema** (not just inline columns+rows inference).
  - Append rows to a dataset (validated against the declared schema).
  - Replace all rows in a dataset.
  - Read rows back (paged, with id/seq/updatedAt).
  - Build a pipeline over the dataset source and get a panel-bindable Output — closing the loop end to end with no UI involved.
- Consider (backend already ships these — expose if in scope and cheap): schema GET/update, per-row PATCH/DELETE.

## Ground truth confirmed during premise validation (2026-09-12)

Backend REST surface is fully shipped on `main` (8ce3710b) — no migration needed, no backend changes expected:

- `GET/PATCH /api/data-sources/:id/schema` — declared-schema read/full-replace (HEL-1121/1124/1122).
- `GET/POST/PUT /api/data-sources/:id/rows` — paged read / append / replace (HEL-1077, HEL-1121).
- `PATCH/DELETE /api/data-sources/:id/rows/:rowId` — per-row edit/delete with `updatedAt` precondition (HEL-1078).
- `POST /api/data-sources` already exists as `create_data_source` in helio-mcp, but only takes inline `columns`+`rows` (inferred schema) — no declared-schema creation path.
- helio-mcp (`helio-mcp/src/tools/write.ts`, `read.ts`, `helioApi.ts`) has **zero** tool/API coverage for the schema or rows endpoints above. This ticket is purely an MCP-surface (helio-mcp) addition — no backend changes.

Route definitions: `backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala` lines 89-183.

## Context

`helio-mcp` already exposes thin pass-through tools for dashboards/panels/data-sources/types/
pipelines (`read.ts`/`write.ts`), each a single `HelioApi` method call wrapped in `guarded`/
`jsonResult`. HEL-493 shipped `/api/metrics` (`MetricRoutes.scala`/`MetricProtocol.scala`) with
the exact wire shapes this design mirrors. No new architectural pattern is introduced; this is a
straight extension of the existing pattern to a fifth resource, five-CRUD-endpoint set.

## Goals / Non-Goals

**Goals:**
- Add `list_metrics`, `get_metric`, `create_metric`, `update_metric`, `delete_metric`, matching
  the existing tool conventions exactly (naming, `guarded`, error surfacing, response shape).
- Client-side Zod validation catches an invalid `aggregation` value before any HTTP call.
- `update_metric` correctly expresses the server's absent-vs-null PATCH convention.

**Non-Goals:**
- No workspace-context/`propose_dashboard` grounding wiring (418-E, explicitly out of scope).
- No new backend behavior — HEL-493 already validates dataTypeId/measureField/allowedDimensions/
  aggregation server-side; the MCP layer duplicates only the cheap client-side aggregation-enum
  check, not the DataType-ownership/field-existence checks (those require a round trip anyway).

## Decisions

1. **Wire types mirror `MetricProtocol.scala` field-for-field.** `MetricResponse` = `{id, ownerId,
   dataTypeId, name, description?, measureField, aggregation, allowedDimensions, format,
   deprecated, createdAt, updatedAt}`; `format` = `{unit?, decimals?, prefix?, suffix?}`
   (`MetricFormat`, all fields optional — spray-json drops `Option = None` on the wire, so every
   optional field is typed `?:` per the existing `types.ts` convention, e.g. `DataTypeResponse.
   tag?`). `CreateMetricRequest` = `{dataTypeId, name, description?, measureField, aggregation,
   allowedDimensions, format?}`.

2. **`update_metric`'s Zod schema uses `.nullable().optional()` for `description`/`format`, plain
   `.optional()` for the rest**, matching `UpdateMetricRequest`'s two field kinds (design.md
   Decision 3 in HEL-493, same absent-vs-null idiom already used for
   `MetricPanelConfig.Patch`/`Option[Option[X]]`). The tool builds the JSON body by including a
   key **only when the parsed value is not `undefined`** (so an omitted arg stays absent — server
   sees "unchanged" — while an explicit `null` is forwarded as `null` — server sees "clear").
   This is a small, local body-builder in `write.ts`, not a new shared helper — no other tool in
   this codebase yet needs the absent-vs-null idiom on the client side, so a shared abstraction
   would be premature.

3. **Aggregation enum validated client-side via `z.enum(["sum","avg","min","max","count",
   "countDistinct"])`**, matching `MetricAggregation.values` in `backend/.../domain/model.scala`
   exactly. This is a hardcoded literal mirror (same approach `mcp-pipeline-shape-tools` already
   takes for its own enums), not a values-fetching round trip — the allow-list is stable and
   small.

4. **`create_metric`/`update_metric` descriptions state the V41 rule** ("`dataTypeId` must be a
   caller-owned pipeline-output DataType — `sourceId` absent, per `list_data_types`'
   `isPipelineOutput`/`sourceId` fields") and steer agents to prefer `list_metrics` /
   `get_panel_capabilities`-style reuse over re-deriving a measure inline, mirroring the existing
   `create_data_source`/`bind_panel` description style.

## Risks / Trade-offs

- [Client Zod validation drifts from the server allow-list if `MetricAggregation.values` changes]
  → Low risk (the set is domain-stable, unlikely to change without its own ticket); the server
  remains the source of truth regardless — a stale client enum only means a slightly later 400
  instead of an earlier one, never an incorrect success.
- [Duplicating the absent-vs-null body-building logic per PATCH-capable tool, rather than a shared
  helper] → Accepted per Decision 2; revisit if a second PATCH tool needs the same idiom.

## Planner Notes

- Capability name `mcp-metric-tools` follows the existing `mcp-<domain>-tools` naming convention
  (`mcp-data-source-tools`, `mcp-panel-composition-tools`, `mcp-pipeline-shape-tools`).
- No spec deltas to other capabilities — this change is purely additive to the tool registry.

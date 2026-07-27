## Why

`GET /api/workspace/context` (HEL-371) and the MCP's `buildWorkspaceContext` describe DataType
*structure* — column names/types — but never a single real value. An agent grounding a dashboard
proposal can't tell a boolean flag from a category, or an ISO timestamp from epoch millis, without
seeing actual rows. The backend already stores the latest pipeline-run snapshot
(`DataTypeRowRepository`/`GET /api/types/:id/rows`); this ticket surfaces a bounded slice of it inline
per DataType so an agent doesn't need a second round-trip per DataType it's curious about.

## What Changes

- `WorkspaceContextService`: for each pipeline-output DataType, attach up to 5 sample rows read from
  the existing row snapshot, bounded at the SQL layer (`LIMIT`), not fetched-then-sliced. Source-companion
  DataTypes (never written to the snapshot table) get `sampleRows: []` without a query.
- `DataTypeRowRepository.listRows` / `DataTypeService.listRows` gain an optional `limit` parameter
  (backward-compatible default `None` = today's unbounded behavior) so both the new caller and a future
  one can bound at the database tier.
- `GET /api/types/:id/rows` gains an optional `?limit=` query param forwarding to the service — additive,
  existing callers unaffected.
- A pure sanitizer caps sample-row shape by construction: 5 rows, first 40 declared columns (by the
  DataType's own field order), 200 chars per cell (oversized values truncated with a marker).
- `helio-mcp/src/context.ts`'s `buildWorkspaceContext` fetches the same bounded rows via
  `api.getDataTypeRows(id, limit)` and applies the identical row/column/cell caps in TypeScript, matching
  the codebase's existing pattern of independently-duplicated parity logic (`panelCount`,
  `flattenRowCount`) — there is no shared runtime between the two implementations.
- `schemas/workspace-context.schema.json`: `dataTypes[].sampleRows` (array, `maxItems: 5`, always present
  — never `Option`, so no spray-json omission concern).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `workspace-context-assembly`: `dataTypes[]` entries gain a bounded `sampleRows` field (row/column/cell
  caps enforced by construction); DataTypes without a run snapshot report `sampleRows: []`.

## Impact

- Affected code: `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala`,
  `backend/src/main/scala/com/helio/api/protocols/WorkspaceContextProtocol.scala`,
  `backend/src/main/scala/com/helio/infrastructure/DataTypeRowRepository.scala`,
  `backend/src/main/scala/com/helio/services/DataTypeService.scala`,
  `backend/src/main/scala/com/helio/api/routes/DataTypeRoutes.scala`,
  `schemas/workspace-context.schema.json`, `helio-mcp/src/context.ts`, `helio-mcp/src/helioApi.ts`,
  `helio-mcp/src/types.ts`.
- No migrations; additive wire field only, existing consumers ignoring `sampleRows` unaffected.
- Consumed by HEL-341/HEL-342 planners; extended next by HEL-373 (column stats) onto the same
  per-DataType seam.

## Non-goals

- Aggregated column statistics, semantic/joinability hints (separate HEL-345 tickets).
- A deterministic *global* (cross-field) token budget — this ticket only enforces its own local caps
  (HEL-377 owns cross-field budgeting).
- Any redaction/opt-out affordance for sample-row content (see design.md's explicit call-out).

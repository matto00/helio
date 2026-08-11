## Why

HEL-493 (418-B) exposes `MetricDefinition` CRUD over REST, but nothing in `helio-mcp` can reach
it yet. An agent composing a dashboard has no way to list or create reusable DEFINED metrics, so
it keeps re-deriving ad-hoc measures per panel instead of referencing the semantic layer the
epic exists to establish.

## What Changes

- Add five typed `HelioApi` client methods (`listMetrics`, `getMetric`, `createMetric`,
  `updateMetric`, `deleteMetric`) wrapping `/api/metrics` (list/get/post/patch/delete).
- Add `MetricResponse`, `CreateMetricRequest`, `UpdateMetricRequest`, `MetricFormat` TS types in
  `helio-mcp/src/types.ts` mirroring the HEL-493 wire (`MetricProtocol.scala`).
- Register `list_metrics` + `get_metric` in `read.ts`; `create_metric`, `update_metric`,
  `delete_metric` in `write.ts`, each a thin pass-through following the existing
  `guarded`/`jsonResult` helper pattern. Zod input schemas validate the `aggregation` enum
  (`sum|avg|min|max|count|countDistinct`) and `allowedDimensions`/`format` shapes client-side,
  ahead of the server's own validation. `update_metric`'s schema uses nullable-optional fields for
  `description`/`format` to preserve the absent-vs-null PATCH convention
  (`UpdateMetricRequest`), sending a key only when the caller actually supplied it.
- Tool descriptions state the V41 pipeline-output-binding rule for `dataTypeId` and steer the
  agent toward referencing a defined metric instead of re-deriving a measure inline.

## Capabilities

### New Capabilities
- `mcp-metric-tools`: the `list_metrics`/`get_metric`/`create_metric`/`update_metric`/
  `delete_metric` MCP tool surface over the HEL-493 `/api/metrics` REST API.

### Modified Capabilities
(none — this is additive to the existing tool registry, no other capability's requirements change)

## Impact

- `helio-mcp/src/helioApi.ts`, `helio-mcp/src/types.ts`, `helio-mcp/src/tools/read.ts`,
  `helio-mcp/src/tools/write.ts`.
- No backend changes (418-B already shipped). No schema changes (`schemas/` already covers the
  REST contract from HEL-493).
- Out of scope: `propose_dashboard`/workspace-context grounding (418-E), panel binding (418-C).

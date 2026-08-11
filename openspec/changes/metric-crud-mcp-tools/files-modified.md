- `helio-mcp/src/types.ts` — added `MetricFormat`, `MetricResponse`, `CreateMetricRequest`,
  `UpdateMetricRequest` TS types mirroring `MetricProtocol.scala` field-for-field (optional fields
  typed `?:` per the existing spray-json-omits-`None` convention; `UpdateMetricRequest`'s
  `description`/`format` are `T | null | undefined` for the absent-vs-null PATCH convention).
- `helio-mcp/src/helioApi.ts` — added `listMetrics`, `getMetric`, `createMetric`, `updateMetric`,
  `deleteMetric` typed client methods wrapping `/api/metrics` (list/get/post/patch/delete), same
  thin pass-through pattern as every other `HelioApi` method.
- `helio-mcp/src/tools/read.ts` — registered `list_metrics` and `get_metric` MCP tools (thin
  pass-through to the new `HelioApi` methods, `guarded`/`jsonResult` pattern).
- `helio-mcp/src/tools/write.ts` — registered `create_metric`, `update_metric`, `delete_metric` MCP
  tools; added the shared `metricAggregationSchema` (`z.enum([...])` mirroring
  `MetricAggregation.values`) and `metricFormatSchema` Zod schemas; added the exported
  `buildUpdateMetricBody` pure function implementing the absent-vs-null PATCH body-builder (design.md
  Decision 2) so `update_metric` sends a key only when the caller actually supplied that argument.
- `helio-mcp/src/tools/write.test.ts` (new) — unit tests for `buildUpdateMetricBody`: omitted args
  stay absent from the body, explicit `null` on `description`/`format` is forwarded as `null`, and a
  round-trip through `JSON.stringify`/`JSON.parse` confirms the wire shape.
- `openspec/changes/metric-crud-mcp-tools/tasks.md` — marked all tasks complete.

## 1. MCP Types

- [x] 1.1 Add `MetricFormat`, `MetricResponse`, `CreateMetricRequest`, `UpdateMetricRequest` types
      to `helio-mcp/src/types.ts`, mirroring `MetricProtocol.scala` field-for-field

## 2. MCP Client

- [x] 2.1 Add `listMetrics(limit?, offset?)`, `getMetric(metricId)`, `createMetric(input)`,
      `updateMetric(metricId, patch)`, `deleteMetric(metricId)` to `helio-mcp/src/helioApi.ts`
- [x] 2.2 `updateMetric` builds its PATCH body including a key only when the caller-supplied value
      is not `undefined` (absent-vs-null convention, per design.md Decision 2)

## 3. MCP Tools

- [x] 3.1 Register `list_metrics` and `get_metric` in `helio-mcp/src/tools/read.ts`
- [x] 3.2 Register `create_metric`, `update_metric`, `delete_metric` in
      `helio-mcp/src/tools/write.ts`, following the `guarded`/`jsonResult` pattern
- [x] 3.3 Zod schemas: `aggregation` as `z.enum(["sum","avg","min","max","count",
      "countDistinct"])`; `allowedDimensions` as `z.array(z.string())`; `format` as an object with
      optional `unit`/`decimals`/`prefix`/`suffix`; `update_metric`'s `description`/`format` as
      `.nullable().optional()`
- [x] 3.4 Tool descriptions state the V41 pipeline-output-binding rule for `dataTypeId` and the
      "reference a defined metric" guidance (create/update tools)

## 4. Tests

- [x] 4.1 `npm run build` (helio-mcp) succeeds with no `any` leakage
- [x] 4.2 Any existing helio-mcp test suite still passes; add coverage for the new tools if the
      existing suite has a pattern for tool-registration/schema tests (added
      `helio-mcp/src/tools/write.test.ts` for `buildUpdateMetricBody`, the absent-vs-null PATCH
      body builder — the one piece of new non-trivial logic; the tool registrations themselves are
      thin pass-throughs with no existing registration-test pattern to extend)

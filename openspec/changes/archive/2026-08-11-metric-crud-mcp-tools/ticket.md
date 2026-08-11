# HEL-541: Metric CRUD MCP tools

## Description

418-B (HEL-493) exposes metrics over REST. This ticket adds the MCP tool surface so an agent using `helio-mcp` can list and manage metrics — the tool layer through which the agent composes DEFINED metrics instead of re-inventing measures per panel (the epic's central lever). Mirrors the existing thin pass-through tools in `helio-mcp/src/tools/read.ts` and `write.ts`, each calling one `HelioApi` method.

## Scope

* `helio-mcp/src/helioApi.ts`: add typed client methods for `GET /api/metrics`, `GET /api/metrics/:id`, `POST /api/metrics`, `PATCH /api/metrics/:id`, `DELETE /api/metrics/:id`.
* `helio-mcp/src/types.ts`: `Metric` / `CreateMetricRequest` / `UpdateMetricRequest` types matching the 418-B wire.
* Tools: `list_metrics` + `get_metric` in `read.ts`; `create_metric`, `update_metric`, `delete_metric` in `write.ts`. Zod input schemas mirroring the server validation (aggregation enum `sum|avg|min|max|count|countDistinct`, allowedDimensions string[], format shape). Descriptions must encode that a metric binds to a pipeline-output DataType (V41) and is the reusable measure a panel should reference.
* Keep everything additive to the tool registry; follow the `guarded`/`jsonResult` helper pattern.

## Acceptance criteria

- [ ] Five metric tools registered and callable via `helio-mcp`, each a thin pass-through to a `HelioApi` method returning the server JSON verbatim.
- [ ] Zod schemas reject invalid aggregation values before hitting the server; server errors surface via the existing `guarded` error path.
- [ ] Tool descriptions state the pipeline-output-binding (V41) rule and the "reference a defined metric" guidance.
- [ ] `npm run build` (helio-mcp) succeeds and any helio-mcp tests pass; types compile with no `any` leakage.

## Out of scope

* Exposing metrics in `propose_dashboard`/workspace-context grounding (418-E).
* Backend routes (418-B) and panel binding (418-C).

## Dependencies

* Blocked by 418-B (HEL-493) — status: Done, merged via PR #315.

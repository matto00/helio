# HEL-233 — Pipeline analyze endpoint — return pipeline with inferred per-step schemas

**Priority**: Urgent
**Parent**: HEL-141 (Data Pipeline Editor)
**Project**: Helio v1.3 — Data Pipeline & Registry Hardening

## Description

Add `GET /api/pipelines/:id/analyze` that returns the pipeline along with its full step list, where each step carries its inferred input and output schemas.

## Why

Pipeline op editor UIs (Select, Rename, Cast, Filter, Compute, Aggregate, Limit, Sort) all need to know which fields are available at the point in the pipeline where the step sits. Today the only way to learn that is to run the full pipeline and read `runResult.rows[0]` keys. This caused HEL-187 to spin for 4 evaluator cycles — every cycle exposed another piece of the broken "must run first" contract.

Schema inference is pure schema math — no data execution required. The Source DataSource has a known field list; each op transforms the schema deterministically. Doing this on the backend in one place means every op editor can rely on accurate, consistent field info from day one.

## Endpoint Shape

`GET /api/pipelines/:id/analyze` →

```json
{
  "id": "...",
  "name": "...",
  "sourceDataSourceName": "...",
  "outputDataTypeName": "...",
  "outputDataTypeId": "...",
  "sourceSchema": [
    { "name": "order_id",   "type": "string" },
    { "name": "amount",     "type": "number" },
    { "name": "created_at", "type": "string" }
  ],
  "steps": [
    {
      "id": "...",
      "position": 0,
      "op": "select",
      "config": "{\"fields\":[\"order_id\",\"amount\"]}",
      "inputSchema":  [ ...same as sourceSchema... ],
      "outputSchema": [
        { "name": "order_id", "type": "string" },
        { "name": "amount",   "type": "number" }
      ]
    },
    {
      "id": "...",
      "position": 1,
      "op": "rename",
      "config": "...",
      "inputSchema":  [ ...output of step 0... ],
      "outputSchema": [ ... ]
    }
  ]
}
```

Step 0's `inputSchema` equals `sourceSchema`. Step N's `inputSchema` equals step N-1's `outputSchema`.

## Inference Rules Per Op

* **select** — `outputSchema = inputSchema.filter(f => config.fields.includes(f.name))`
* **rename** — `outputSchema` replaces names per `config.renames` map
* **cast** — `outputSchema` retypes fields per `config.casts` map
* **filter** — identity (`outputSchema = inputSchema`)
* **compute** — `outputSchema = inputSchema ++ config.outputs` (each output: `{ name, type }` declared by user)
* **aggregate** — `outputSchema = config.groupBy ++ config.aggregations.map(a => ({ name: a.alias, type: aggResultType(a.fn, a.field) }))`
* **limit / sort** — identity

If a step's config is malformed or references a non-existent field, surface a `validationError` on that step and continue inference (subsequent steps get the same input schema as if the step were a no-op). Frontend shows the error inline; the run path keeps its existing 422 behavior on actual execution.

## Out of Scope

* Caching schema inference results — recompute on each call; cheap, no I/O beyond the pipeline+steps fetch
* Running any actual data through the pipeline — schema only
* Modifying existing endpoints (`GET /api/pipelines/:id`, `GET /api/pipelines/:id/steps`) — they stay as-is

## Acceptance Criteria

* `GET /api/pipelines/:id/analyze` returns the pipeline + steps with `inputSchema` / `outputSchema` populated for every step
* Source schema is derived from the bound DataSource (existing schema introspection used by data-types creation flow)
* Editor can render the Select / Rename / Cast / Compute config UIs without ever calling `/run`
* OpenAPI spec + JSON Schema for the response added; `npm run check:schemas` passes
* Backend tests cover: each op's inference rule; malformed-config validationError; empty step list; renamed-field cascading through later steps

## Implementation Strategy (Orchestrator Decision)

Only `select` is implemented in the engine today (HEL-187). The inference rules for all 8 ops are defined in the ticket, but only `select`'s engine exists. 

**Decision**: Implement full inference rules for all 8 ops now (select, rename, cast, filter, compute, aggregate, limit, sort). The inference is pure schema math — it does not require the op engine to exist. When HEL-188–194 land their op engines, the inference rules will already be wired. This avoids a second pass over this file for each op ticket.

Each op's inference rule is trivial to implement (pattern match on op type, parse config JSON, apply transform). The `select` inference rule already has a working reference. Rename, cast, compute all have well-specified config shapes. Filter/limit/sort are identity and require no parsing.

**Validation errors**: If config is malformed or references non-existent fields, attach `validationError` to that step and treat it as identity for downstream inference.

## Notes

This is a prerequisite for HEL-188–194. Land before HEL-188 to avoid repeating HEL-187's cycle pain.

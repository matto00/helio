# HEL-393: Smart shape: single-row (reduce a source to one row)

## Context

A metric panel needs exactly one row (a single value / a small set of measures). The single-row shape reduces a source to one row by aggregation (empty groupBy) or filter-to-one. Built on the shape abstraction from HEL-391 (Smart shapes: shape abstraction, registry, backend model, catalog endpoint) and the existing `aggregate`/`filter`/`limit` ops in `backend/src/main/scala/com/helio/domain/steps/`.

## Scope

Backend:

* Register a `single-row` shape in the `PipelineShape.Registry` (`backend/src/main/scala/com/helio/domain/shapes/`). Params: a set of measures `[{ fn, field, alias }]` (expands to an `aggregate` step with empty `groupBy`) OR a filter-to-one config (expands to `filter` + `limit 1`). Output contract: exactly one row with the declared measure columns.
* Expansion produces standard step create-payloads (no new step kinds). No inline fully-qualified names.
* Extend the shape catalog + `schemas/`/`openspec/` if the params schema needs surfacing.

## Acceptance criteria

- [ ] The `single-row` shape appears in `GET /api/pipelines/shapes` with its params schema + output contract (exactly one row).
- [ ] `expand(params)` yields a valid step list (aggregate-empty-groupBy or filter+limit1) that, when run, produces exactly one row with the declared columns.
- [ ] Tests: expansion → expected step list; an end-to-end run of an expanded shape yields one row (reuse `InProcessPipelineEngineSpec` patterns).
- [ ] Backward compatible: additive; no persisted schema change; reuses existing ops only.

## Out of scope

* Panel wiring, MCP surface, and editor UX (sibling tickets).

## Dependencies

* Blocked by HEL-391 (shape abstraction + registry) — MERGED to main (commit b28731a5, PR #288). Uses existing aggregate/filter/limit ops (no HEL-336 dependency).

## Orchestrator pre-briefing notes (HEL-391 contract recap)

- `trait PipelineShape` in `backend/src/main/scala/com/helio/domain/shapes/` — `expand(params: JsObject): Either[String, Vector[ShapeStepExpansion]]` is a PURE function (no repo, no network, no ActorSystem). `Registry`/`shapeFor` mirrors `PipelineStep.Registry` (keyed map of companions).
- `ShapeStepExpansion(kind, config)` is domain-layer and maps positionally to the API's `CreatePipelineStepRequest` (kind<->`type`, config<->config). `domain/shapes` must NOT import `com.helio.api.protocols` — layering is enforced by a grep-clean check.
- `OutputContract(rowCount, fields, description)`. `RowCountContract = ExactlyOne | AtMostParam(paramName) | Unbounded` (wire: `{"kind":"exactly-one"}` / `{"kind":"at-most-param","paramName":"n"}` / `{"kind":"unbounded"}`). `OutputFieldContract(name, dataType, nullable)` — EXACTLY 3 fields; there is deliberately NO `role` field (dropped as speculative — do not re-add).
- `paramsSchema` is descriptive metadata only (like `ConnectorFieldDescriptor`), NOT validating JSON Schema. Real validation happens inside `expand`.
- Catalog endpoint is `GET /api/pipeline-shapes` — a DISTINCT top-level prefix, deliberately NOT nested under `/api/pipelines/` (that collides with the `PipelineIdSegment` catch-all matcher and would ship an unreachable route with green tests). Note: the ticket's acceptance criteria text says `GET /api/pipelines/shapes` — this is stale/incorrect per the HEL-391 contract; the actual, correct endpoint is `GET /api/pipeline-shapes`. Verify against the merged HEL-391 code, not the ticket text.
- Reference shape `passthrough` (expands to one select step) is the template to mirror.
- single-row is `ExactlyOne` row count — it should be the natural first real user of that variant.

**Two items HEL-391 explicitly deferred to this ticket:**
1. A registry-parity / drift test (it needed a 2nd shape to assert against — single-row is that 2nd shape).
2. `RowCountContract` is not sealed outside its file; seal it if that's still the right call.

Fold both into this ticket's scope unless the design gate argues otherwise.

## Scope constraints

- single-row reduces a source to one row via the EXISTING `aggregate` / `filter` ops already on main — no new pipeline op.
- No Flyway migration expected (the shape registry is code-level, like `ConnectorRegistry`). If design implies a migration, re-check the abstraction. Main is at V72 if a migration genuinely is needed — assign the next free V and re-confirm max at write time AND again pre-push.
- Panel wiring, MCP surface, and editor UX are explicitly out of scope (sibling tickets).

# HEL-398: Smart shape: pivot / matrix (built on the pivot op)

## Context

Crosstab/matrix panels want a wide grid: one row per index key, one column per category, aggregated cells. The pivot/matrix shape wraps the pivot op with an optional pre-aggregate. Built on the shape abstraction (HEL-391) and the `pivot` op (HEL-375).

## Scope

Backend:

- Register a `pivot-matrix` shape in `PipelineShape.Registry`. Params: `index` (rows), `column` (category to spread), `values` (measure), `agg`. Expansion → optional `aggregate` (to pre-collapse) + `pivot`. Output contract: one row per `index` tuple; note that the value columns are data-dependent (inherit the pivot op's documented dynamic-columns handling — see HEL-375). No inline fully-qualified names.
- Extend the catalog + `schemas/`/`openspec/` as needed.

## Acceptance criteria

- [ ] The `pivot-matrix` shape appears in the catalog with params (index, column, values, agg) + output contract, documenting the dynamic-columns caveat inherited from the pivot op.
- [ ] `expand(params)` yields (optional aggregate +) pivot; a run produces the expected matrix.
- [ ] Tests: expansion → expected step list; end-to-end run yields a correct crosstab.
- [ ] Backward compatible: additive; no persisted schema change.

## Out of scope

- Panel wiring, MCP surface, editor UX (sibling tickets: HEL-402, HEL-400, HEL-399).

## Dependencies

- Blocked by HEL-391 (shape abstraction) and HEL-375 (pivot op). Both are on main already.

## Orchestrator pre-brief notes (from the human)

HEL-398 is the fourth and last concrete shape in the HEL-337 Smart Shapes epic. Main is at `a9605a18` (HEL-396 time-series merged, PR #291).

Prior shapes for convention reference (all in `backend/src/main/scala/com/helio/domain/shapes/`):
- HEL-391 (PR #288) — registry foundation + reference `passthrough` shape.
- HEL-393 (PR #289) — `single-row`.
- HEL-394 (PR #290) — `top-n`.
- HEL-396 (PR #291) — `time-series`.

Conventions settled by prior shapes, to follow rather than re-litigate:
- Enum-ish param values validate case-insensitively. HEL-396 found: normalize `granularity` to lowercase before emitting, because `DateBucketStep`'s own matching is case-sensitive while `AggregateStep.fn` is not. Check the case-sensitivity of whatever step this shape emits into and handle it explicitly.
- A shape expands to a small fixed vector of EXISTING step kinds; no new op.
- HEL-396 rejects a measure `alias` that collides with the groupBy key, having confirmed the hazard against `AggregateStep`'s `keyMap ++ aggMap` merge semantics. Look for the analogous collision hazard in this shape's expansion and test it.
- There is ONE registry-parity/drift test and ONE named-shape catalog HTTP assertion covering all shipped shapes — EXTEND both, don't write parallel ones.

HEL-391 contract:
- `trait PipelineShape` — `expand(params: JsObject): Either[String, Vector[ShapeStepExpansion]]` is PURE (no repo, network, or ActorSystem).
- `ShapeStepExpansion(kind, config)` is domain-layer, maps positionally to `CreatePipelineStepRequest` (kind↔`type`). `domain/shapes` must NOT import `com.helio.api.protocols` (grep-enforced layering).
- `OutputContract(rowCount, fields, description)`, where `outputContract` is a STATIC `val` with no access to params. `RowCountContract = ExactlyOne | AtMostParam(paramName) | Unbounded`, sealed. `OutputFieldContract(name, dataType, nullable)` — exactly 3 fields, deliberately no `role`.
- Every shape shipped so far declares `fields = Vector.empty` — this is a KNOWN OPEN ISSUE the human is raising separately at the epic level (affects surface tickets 399/400/402, not shape tickets). For HEL-398: declare `fields = Vector.empty` consistent with siblings and do NOT redesign `OutputContract`. Pivot's dynamic arity means empty is the honest answer anyway.
- `paramsSchema` is descriptive metadata only, not validating JSON Schema — real validation lives in `expand`.
- Catalog: `GET /api/pipeline-shapes` — distinct top-level prefix, NOT under `/api/pipelines/` (collides with the `PipelineIdSegment` catch-all).

Ticket-specific instructions:
- pivot/matrix wraps the `pivot` op (HEL-375, migration V65) with an OPTIONAL pre-aggregate. Both ops exist on main. No new op, no Flyway migration — the registry is code-level like `ConnectorRegistry`. If the design implies a migration, the abstraction has been misread; re-check. Main is at V72 if a migration genuinely proves necessary (it should not).
- Read `PivotStep.scala` and its analyze/infer path directly. HEL-375 solved pivot's data-dependent arity this way: analyze returns an INDEX-ONLY output schema; the dynamic `<values>_<v>` columns are never statically enumerated; and their absence from the analyze schema is deliberately NOT a validation error (a real error is raised only for an unknown index/column/values field). This shape must be consistent with that decision — it directly constrains what the output contract can honestly promise.

Settle deliberately at the design gate:
1. What the optional pre-aggregate is for and when it's emitted. Pivot with duplicate index/column pairs needs an aggregation rule; be explicit about whether the pre-aggregate is how this is handled, and what happens when it's omitted.
2. The `RowCountContract` variant — reason about what's honest for a pivoted matrix; don't copy a sibling's choice verbatim without justification.
3. Any collision hazard between index/column/values fields and pre-aggregate aliases.

Process notes:
- Design-gate escalation criterion: a round-N REFUTE that is an incomplete application of an already-decided fix, or a pure consistency nit, is NOT new grounds — the orchestrator will authorize a continuation round itself. Escalate only genuinely-new substantive design flaws.
- Commit before yielding at any phase boundary.

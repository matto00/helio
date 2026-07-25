# HEL-396: Smart shape: time-series (date-bucket + aggregate over a time column)

## Context

Line/area charts want one row per time bucket with a measure aggregated over that bucket. The time-series shape encapsulates date-bucket + aggregate. Built on the shape abstraction (HEL-391) and the `datebucket` op (HEL-378) plus the existing `aggregate` op.

## Scope

Backend:

* Register a `time-series` shape in `PipelineShape.Registry`. Params: `timeField`, `granularity` (day/week/month/quarter/year), and measures `[{ fn, field, alias }]`. Expansion → `datebucket` (on `timeField` to `granularity`) + `aggregate` (groupBy the bucket column, the measures). Output contract: one row per bucket, columns = bucket + measures, sorted by bucket (append a `sort` if needed for chart-friendly ordering). No inline fully-qualified names.
* Extend the catalog + `schemas/`/`openspec/` as needed.

## Acceptance criteria

- [ ] The `time-series` shape appears in the catalog with params (timeField, granularity, measures) + output contract.
- [ ] `expand(params)` yields datebucket + aggregate (+ optional sort); a run produces one row per bucket with the measures, ordered by bucket.
- [ ] Tests: expansion → expected step list; end-to-end run over a dated fixture yields correct buckets.
- [ ] Backward compatible: additive; no persisted schema change.

## Out of scope

* Gap-filling empty buckets (leave to fill-null / a follow-up).
* Panel wiring, MCP surface, editor UX (sibling tickets).

## Dependencies

* Blocked by HEL-391 (shape abstraction) and HEL-378 (date-bucket op). Uses the existing aggregate op.

---

## Orchestrator pre-brief (HEL-396)

This is the THIRD concrete shape in the HEL-337 Smart Shapes epic. Main is at `8c516dff`.
- HEL-391 (PR #288) — registry foundation.
- HEL-393 (PR #289) — `single-row`, first real shape.
- HEL-394 (PR #290, `8c516dff`) — `top-n`.

Read both `SingleRowShape.scala` and `TopNShape.scala` (plus their specs) before designing — they are templates and establish conventions to follow rather than re-litigate:
- Param validation is CASE-INSENSITIVE for enum-ish values (HEL-394 settled this and fixed `single-row`'s `fn` to match `AggregateStep`'s own runtime behavior). Follow that.
- A shape expands to a small fixed vector of existing step kinds; no new op.
- There is a registry-parity/drift test and a named-shape catalog HTTP assertion (currently covering `single-row` and `top-n`) — EXTEND both to include this shape, don't write parallel ones.

Remaining after this ticket: 398 pivot/matrix, then the three surfaces (402 editor UX, 400 MCP, 399 panel wiring).

### The HEL-391 contract

- `trait PipelineShape` in `backend/src/main/scala/com/helio/domain/shapes/` — `expand(params: JsObject): Either[String, Vector[ShapeStepExpansion]]` is PURE (no repo, no network, no ActorSystem).
- `ShapeStepExpansion(kind, config)` is domain-layer, maps positionally to `CreatePipelineStepRequest` (kind↔`type`). **`domain/shapes` must NOT import `com.helio.api.protocols`** — grep-enforced layering.
- `OutputContract(rowCount, fields, description)`. `RowCountContract = ExactlyOne | AtMostParam(paramName) | Unbounded`, sealed. `OutputFieldContract(name, dataType, nullable)` — exactly 3 fields, deliberately NO `role`; do not re-add.
- `paramsSchema` is descriptive metadata only, not validating JSON Schema — real validation lives in `expand`.
- Catalog: `GET /api/pipeline-shapes` — distinct top-level prefix, NOT under `/api/pipelines/` (collides with the `PipelineIdSegment` catch-all and would ship unreachable with green tests).

### Ticket-specific

time-series = date-bucket + aggregate over a time column, both EXISTING ops on main. **No new op, no Flyway migration** (the registry is code-level like `ConnectorRegistry`). If the design implies a migration, that's a signal the abstraction was misread — re-check. Main is at V72 if one genuinely proves necessary.

The `datebucket` op shipped in HEL-336 as HEL-378 (migration V64) — floors a timestamp to day/week/month/quarter/year. **Read its implementation and its analyze/infer behavior before designing**; in particular confirm whether it appends a derived column or overwrites in place, because that determines the output contract's field list. Do not take prior claims at face value — verify directly.

Three things to settle DELIBERATELY at the design gate rather than letting them fall out of the implementation:
1. **Ordering.** Charts want buckets in chronological order. Decide whether the expansion emits a trailing `sort` on the bucket column, and justify it. State it in the output contract.
2. **Gap-filling.** Missing/empty time buckets are a real product question for line charts. Almost certainly OUT of scope here (there's no gap-fill op on main), but decide explicitly and file a spinoff under HEL-337 rather than leaving it unstated — that's what HEL-394 did with per-group top-N (HEL-621).
3. **Row count contract.** Reason about which `RowCountContract` variant is honest for a bucketed series, and don't just copy a sibling's choice.

### Process notes

- Design-gate escalation criterion: a round-N REFUTE that is an incomplete application of an already-decided fix, or a pure consistency nit, is NOT new grounds — continue rather than escalate. Escalate only genuinely-new substantive design flaws.
- Commit before yielding at any phase boundary.
- No inline fully-qualified names anywhere (code or prose in artifacts).

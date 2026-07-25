## Why

Metric panels need exactly one row (a single value or a small set of measures). HEL-391 landed the
`PipelineShape` abstraction, registry, and catalog endpoint with one trivial reference shape
(`passthrough`); this change adds the first real concrete shape — `single-row` — reducing a source to
one row via the existing `aggregate`/`filter`/`limit` ops, and closes the two items HEL-391 explicitly
deferred to a second shape (a registry-parity drift test; confirming `RowCountContract`'s sealing).

## What Changes

- Register a `single-row` shape in `PipelineShape.Registry` (`backend/src/main/scala/com/helio/domain/shapes/`).
  Two expansion modes selected by a `mode` param: `"aggregate"` (measures → one `aggregate` step with
  empty `groupBy`) or `"filter"` (conditions → `filter` + `limit 1`). Both reuse existing step kinds —
  no new pipeline op.
- Output contract: `RowCountContract.ExactlyOne`, param-driven `fields` (empty, mirroring `passthrough`
  — the shape doesn't know measure aliases or filtered source columns ahead of `expand`-time).
- Add a registry-parity drift test (`PipelineShape.Registry` vs. an independently-authored id set),
  mirroring `ConnectorRegistrySpec` — deferred by HEL-391 until a second shape existed.
- Confirm `RowCountContract`'s sealing (already `sealed` in code; its doc comment incorrectly claims
  otherwise — fix the stale comment as part of this change).
- Tests: expansion → expected step list (both modes + validation failure cases); an end-to-end run of
  each expanded mode through `InProcessPipelineEngine` yields exactly one row.

## Capabilities

### New Capabilities

(none — this change extends the existing `pipeline-shape-registry` capability with a second shape)

### Modified Capabilities

- `pipeline-shape-registry`: the registry now contains two shapes (`passthrough`, `single-row`); adds
  a registry-parity drift-test requirement; the catalog endpoint's response gains a second entry with a
  non-`Unbounded` `rowCount`.

## Impact

- `backend/src/main/scala/com/helio/domain/shapes/` — new `SingleRowShape.scala`; `Registry` gains one
  line; `OutputContract.scala` doc-comment fix only (already `sealed`).
- `backend/src/test/scala/com/helio/domain/shapes/` — new `SingleRowShapeSpec.scala`, registry-parity
  additions to `PipelineShapeSpec.scala`.
- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — new end-to-end cases
  (or a sibling spec file) proving each expanded mode yields one row.
- No Flyway migration, no route/schema wire-shape change (the existing catalog response/schema already
  represents a non-empty `fields` list and any `RowCountContract` variant generically).
- Out of scope: panel wiring, MCP surface, editor UX (sibling tickets).

## Non-goals

- Any UI/editor surface for authoring `single-row` params.
- Persisting a shape reference on a pipeline/panel.
- Guaranteeing `ExactlyOne` at runtime when the underlying data can't produce a row (e.g. filter mode
  matching zero source rows) — the contract is a declared guarantee under normal use, not a runtime
  enforcement layer; documented as a known limitation in design.md.

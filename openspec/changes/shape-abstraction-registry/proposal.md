## Why

The smart-pipelines vision wants panels to declare "I need a single value / top-N / a time series"
and get a trivially-bindable output — but today a pipeline is only a raw ordered list of steps with
no notion of a named, parameterized template. HEL-391 is the foundation leaf of the HEL-337 epic: it
must land the `PipelineShape` abstraction, registry, and catalog endpoint that every one of the seven
sibling tickets (concrete shapes, panel binding, MCP surface, editor UX) builds on. Getting the
contract wrong here is expensive to unwind across eight tickets.

## What Changes

- New `com.helio.domain.shapes` package: a `PipelineShape` trait (`id`, `label`, `description`,
  `paramsSchema`, `outputContract`, `expand(params: JsObject): Either[String, Vector[ShapeStepExpansion]]`)
  and a `PipelineShape.Registry` mirroring `PipelineStep.Registry`'s map-of-companions pattern.
- `OutputContract` model: a shape-level (not per-invocation) declaration of the guaranteed output
  shape — row-count contract (`ExactlyOne` / `AtMostParam(name)` / `Unbounded`) plus any statically
  known output fields (reusing `DataFieldType`). This is what panels (HEL-402) bind to.
- One trivial reference shape (`passthrough` — selects caller-chosen fields via a single `SelectStep`
  expansion) registered for real, proving the abstraction end-to-end and anchoring the tests. No
  single-row/top-N/time-series/pivot shape logic — those are sibling tickets (393/394/396/398).
- `GET /api/pipeline-shapes` catalog endpoint (new `PipelineShapeRoutes` + `PipelineShapeService`) —
  a distinct top-level prefix, not nested under `/api/pipelines/`, since `PipelineRoutes`'s
  unvalidated `path(PipelineIdSegment)` matcher would otherwise swallow a `shapes` literal segment as
  a pipeline-id lookup. Returns the registry: id, label, description, params descriptors,
  output-contract summary. Authenticated like other pipeline routes; no DB access (code-level
  registry, like `ConnectorRegistry`).
- New `PipelineShapeProtocol` (Spray JSON) for the catalog response wire shape.
- `schemas/pipeline-shape-catalog.schema.json` + `openspec/specs/pipeline-shape-registry/spec.md`.

## Capabilities

### New Capabilities
- `pipeline-shape-registry`: the `PipelineShape` abstraction, registry, expansion contract, output
  contract model, and the `GET /api/pipeline-shapes` catalog endpoint.

### Modified Capabilities
(none — purely additive; no existing spec's requirements change)

## Non-goals

- The four concrete shapes (single-row, top-N, time-series, pivot/matrix) — sibling tickets.
- Persisting a shape reference on a pipeline/panel, or any DB migration — deferred to the
  panel-declares-shape ticket; this ticket is code-only, like `ConnectorRegistry`.
- MCP tool surface and editor UX — sibling tickets.

## Impact

- New: `backend/src/main/scala/com/helio/domain/shapes/**`, `PipelineShapeRoutes.scala`,
  `PipelineShapeService.scala`, `PipelineShapeProtocol.scala`.
- Modified: `ApiRoutes.scala` (mount new route), `schemas/`, `openspec/specs/`.
- No Flyway migration, no frontend changes, no changes to existing pipeline/step behavior.

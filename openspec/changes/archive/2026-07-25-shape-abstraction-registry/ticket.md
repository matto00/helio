# HEL-391: Smart shapes: shape abstraction + registry (backend model + catalog endpoint)

## Context

The product vision (see the smart-pipelines concept) wants pre-configured pipeline shapes to be first-class primitives: a panel declares "I need a single value / top-N / a time series", a shape produces exactly that output contract from a source, and binding is trivial. Today a pipeline is only a raw ordered list of steps (`backend/src/main/scala/com/helio/domain/steps/`, `PipelineStep.scala`); there is no notion of a named, parameterized template. This ticket builds the foundation the individual shapes and the panel/agent/UX tickets all depend on.

A shape is a named, parameterized template that (a) expands to an ordered list of standard pipeline steps given its params, and (b) declares a known output contract (the schema/row-shape it guarantees). Expansion produces ordinary steps — shapes are authoring sugar over the existing step engine, not a new execution path.

## Scope

Backend:

* New module `backend/src/main/scala/com/helio/domain/shapes/` with a `PipelineShape` trait + a `PipelineShape.Registry` (mirror the pattern of `PipelineStep.Registry` in `PipelineStep.scala`). Each shape exposes: `id`, human `label`, a typed params schema, an `expand(params): Vector[step config]` producing standard step create-payloads, and an `outputContract` describing the guaranteed output shape.
* A shapes catalog read endpoint (e.g. `GET /api/pipelines/shapes`) returning the registry (id, label, params schema, output-contract summary). New route under `backend/src/main/scala/com/helio/api/routes/` wired into `ApiRoutes.scala`; logic in a service. No inline fully-qualified names (CONTRIBUTING.md imports rule).
* A protocol file under `backend/src/main/scala/com/helio/api/protocols/` for the catalog response (Spray JSON formats).
* Update `schemas/` + `openspec/` with the shape catalog contract.

This ticket delivers the abstraction, the registry, expansion, output-contract model, and the catalog endpoint — but registers NO concrete shapes itself (they are the sibling tickets) beyond, optionally, one trivial reference shape used only by tests.

## Acceptance criteria

- [ ] A `PipelineShape` trait + `Registry` exist; a shape can `expand(params)` into a `Vector` of standard step create-payloads and declare an `outputContract`.
- [ ] `GET /api/pipelines/shapes` returns the catalog (id, label, params schema, output contract); authenticated like other pipeline routes.
- [ ] Expansion produces steps that are valid against the existing step CRUD/validation path (an expanded shape could be persisted as ordinary steps).
- [ ] `schemas/` + `openspec/` updated for the catalog contract.
- [ ] Tests: registry lookup, one reference shape's expansion → expected step list, catalog endpoint response shape.
- [ ] Backward compatible: purely additive; existing pipelines and the step engine are unchanged; no persisted schema change (shape binding persistence is deferred to the panel-declares-shape ticket).

## Out of scope

* Concrete shapes (single-row / top-N / time-series / pivot-matrix) — sibling tickets.
* Persisting a shape reference on a pipeline/panel — handled by the panel-declares-shape ticket.
* MCP/agent surface and editor UX — sibling tickets.

## Dependencies

* None. Blocks every other HEL-337 (epic: Smart Pipeline Shapes) child.

## Orchestrator notes (from user brief)

This is the FOUNDATION ticket of the HEL-337 Smart Pipeline Shapes epic (v1.6) — the first of 8 leaves, and a hard prerequisite for all 7 others. Get the abstraction right.

- Study `ConnectorRegistry` + `ConnectorMetadata` (HEL-484, on main) as the closest precedent for a code-level registry + capability-metadata + catalog endpoint pattern — reuse that shape of solution.
- Shapes EXPAND to steps built from the op vocabulary just completed in HEL-336 (datebucket/pivot/aggregate/sort/limit etc., all now on main up to migration V72) — make sure the abstraction can express those expansions.
- Get the output-contract concept right — it's what panels bind to (single value / top-N / time-series / pivot-matrix, per the smart-pipelines concept).
- Likely NO Flyway migration (shapes are code-defined, not persisted user data) — but if the design decides shapes need persistence, re-confirm the current max migration (main is at V72) before adding one.
- The design gate should scrutinize the CONTRACT hardest since this is a greenfield abstraction that everything else builds on.

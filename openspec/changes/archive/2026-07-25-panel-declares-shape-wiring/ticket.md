# HEL-399: Smart shapes: panel-declares-shape wiring (panel references a shape; creation offers shapes)

## Context

The payoff of shapes is that a panel says "I need a single value / top-N / a time series" and the shape produces exactly that output contract, making binding trivial. This ticket connects panels to shapes: the panel creation flow offers the relevant shape(s) for a panel type, instantiates the shape into a pipeline, and binds the resulting output DataType. Built on the shape abstraction (HEL-391) and the concrete shapes.

## Scope

Backend:

* If a persisted link is needed (panel or pipeline records which shape + params produced it, for round-trip/editing), add it via a Flyway migration (e.g. a nullable `shape` + `shape_params` on `pipelines`, or on the panel binding). Use the next available VNN, assigned at scheduling time (main at V59; three v1.6 lanes may contend). If the team decides expansion is fire-and-forget (no persisted link), state that and skip the migration — decide in design.
* Wire shape instantiation into the pipeline/panel creation service: given a shape id + params + source, expand to steps, create the pipeline + output DataType, ready for binding.

Frontend:

* Panel creation flow (`frontend/src/features/panels/ui/creationSteps/`) offers the shape(s) appropriate to the chosen panel type (metric → single-row, chart → time-series/top-N, table → top-N/pivot-matrix) and collects the shape params, then instantiates.

## Acceptance criteria

- [ ] Creating a data panel can offer a matching shape; choosing one instantiates the pipeline from the shape and binds the panel to its output.
- [ ] The mapping of panel type → offered shape(s) is implemented and documented.
- [ ] If persisted: Flyway migration applies cleanly and the shape reference round-trips; if not persisted: the decision is documented.
- [ ] Tests: instantiation flow (shape + params → pipeline + bound panel); frontend creation-step test for shape selection.
- [ ] Backward compatible: additive; panels created without shapes behave exactly as today; any new column is nullable.

## Out of scope

* The agent/MCP surface (sibling ticket, HEL-400 — already shipped) and the in-editor shape instantiation UX (sibling ticket, HEL-402 — already shipped).

## Dependencies

* Blocked by HEL-391 (shape abstraction). Consumes the concrete shapes (HEL-393/394/396 + HEL-398 pivot-matrix).

## Epic

This ticket CLOSES the HEL-337 Smart Pipeline Shapes epic. It is the last of eight tickets.

## Orchestrator pre-brief (constraints from the human, binding for this run)

1. **Bind via the runtime DataType schema, NOT a static field contract.** `outputContract.fields` is `Vector.empty` for every shape and STAYS that way. Binding works by instantiate → expand → create pipeline + steps → run → read the resulting DataType's schema → auto-map the panel's fields. Do NOT make `outputContract` param-aware and do NOT add fields to it. `rowCount` and `description` are the informative parts of the contract; `rowCount` is useful for matching a shape to a panel kind (e.g. `ExactlyOne` fits a metric panel).
2. **Shape-seeded steps carry NO persisted link back to their originating shape** (deliberate HEL-402 decision — seeded steps are plain, independent, editable steps). Do not assume step-level provenance exists. If the design needs the *panel* to remember which shape it was created from, that's a new panel-level concern that must be justified explicitly at the design gate.
3. Binding is strictly source → pipeline → type → panel (enforced on main). Anything built must respect it.
4. spray-json omits `Option = None` on the wire. Any new optional field on a panel config or request must be normalized at the service boundary, with a test for the field ABSENT (not just null) — required test case.
5. Frontend: `DESIGN.md` binding (tokens, spacing/type scale, shared components, UI state patterns). `CONTRIBUTING.md` binds code quality incl. co-located `*.test.tsx`. Zero-warnings lint. Never inline fully-qualified names.
6. Design against the HEL-336 `lookup`-op defect pattern: an empty/default-param picker POST silently failing and the frontend swallowing the error, leaving the user with no feedback. The instantiate → run → bind chain has multiple failure points (expand validation, pipeline run failure, empty params). Every failure must surface visibly — the 422 carries the shape's own validation message verbatim; show it. Verify live in a browser, not from unit tests alone.
7. Report explicitly whether `outputContract.fields` was ever actually needed by this ticket, for the human's later YAGNI deletion call (mirrors HEL-391 dropping the speculative `role` field).

## Scope decisions to settle at the design gate

1. Which panel kinds offer which shapes, and how `rowCount` drives that matching.
2. What the creation flow actually is — concrete number of user steps from panel-type choice to bound panel.
3. Failure/partial states across the instantiate → run → bind chain — what the user sees at each failure point, no half-built panel with silent failure.
4. Whether the panel records its originating shape at all (see constraint 2 above) — if yes, justify explicitly.

# HEL-402: Smart shapes: shape instantiation UX in the pipeline editor

## Context

A human authoring a pipeline should be able to pick a smart shape, fill its params, and have the editor seed the corresponding steps — a fast start they can then refine by hand. Built on the shape abstraction + catalog (HEL-391). The editor is `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` (+ `CreatePipelineModal.tsx`); op metadata lives in `frontend/src/features/pipelines/state/stepNarrowing.ts`.

## Scope

Frontend:

* Fetch the shape catalog via a new service call in `frontend/src/features/pipelines/services/pipelineService.ts`.
  * **CORRECTION to ticket text**: the ticket text says `GET /api/pipelines/shapes`, but the actual, verified endpoint is **`GET /api/pipeline-shapes`** — a distinct top-level prefix, deliberately NOT nested under `/api/pipelines/` (that would collide with the `PipelineIdSegment` catch-all matcher). Verify against the running backend during planning/execution, not by inferring from the ticket text.
* Add a "Start from a shape" affordance in the pipeline editor / create-pipeline flow that lists shapes, collects params (driven by the catalog's params schema), and seeds the expanded steps into the editor (the user can then edit/preview them like any other steps).
* Ensure the seeded steps render through the existing `StepCard` / `OP_TYPES` machinery.

## Acceptance criteria

- [ ] The editor offers shape selection; picking a shape + filling params seeds the correct step cards.
- [ ] Seeded steps are normal, editable, previewable steps (no special-casing downstream).
- [ ] The params form is driven by the catalog's params schema (not hardcoded per shape where avoidable).
- [ ] Frontend tests cover shape selection → seeded steps.
- [ ] Follows `DESIGN.md` tokens/components; backward compatible (additive UI; manual step authoring unchanged).

## Out of scope

* Panel-declares-shape and agent/MCP surfaces (sibling tickets, HEL-400/HEL-399).
* Generic design-system authoring work (belongs to v1.7).

## Dependencies

* Blocked by HEL-391 (shape catalog) — SHIPPED (PR #288).
* Complements the concrete shape tickets — ALL SHIPPED: HEL-393 single-row (PR #289), HEL-394 top-n (PR #290), HEL-396 time-series (PR #291), HEL-398 pivot-matrix (PR #292).

## Important context from orchestrator pre-brief

Registered shape ids today: `passthrough`, `single-row`, `top-n`, `time-series`, `pivot-matrix`. Read them all in `backend/src/main/scala/com/helio/domain/shapes/` so the UI matches what the catalog actually serves.

Catalog contract:
- `GET /api/pipeline-shapes` — schema: `schemas/pipeline-shape-catalog.schema.json`. Verify the actual response shape against the running server rather than inferring it.
- Each catalog entry carries `paramsSchema` and an `outputContract`.
- `paramsSchema` is DESCRIPTIVE METADATA ONLY — it is NOT validating JSON Schema (same pattern as `ConnectorFieldDescriptor`). Do not build a form generator that assumes it can fully validate client-side. Real validation lives server-side inside each shape's `expand`, which returns `Left(message)` on bad params. **The UI must surface that error message to the user** — an expand failure that vanishes silently is the failure mode to design against.
- `outputContract.fields` is currently `Vector.empty` for EVERY shape — there is an open epic-level design question about whether `OutputFieldContract` becomes param-aware or gets dropped. Do not build UI that depends on `fields` being populated. `rowCount` and `description` carry real information today; use those. Showing projected output columns is out of scope.

### A real defect pattern to design against (HEL-336 lookup-op picker bug)

During HEL-336, the `lookup` op shipped a bug that green unit tests missed entirely: the pipeline editor's "+ Add step" picker POSTed an EMPTY default for a required id field, the backend rejected it, and the frontend silently swallowed the failed POST — so the step simply vanished on reload with no error shown. It was caught only by a live browser check, and the fix needed both a backend guard and a toast surface on the previously-silent catch.

This ticket is structurally the same shape of risk: a picker that instantiates something with initially-empty params. So:
- Exercise the real picker-add path in a live browser, with EMPTY/default params, not just with pre-filled valid values.
- Make sure a failed instantiate/expand surfaces visibly (toast or inline error), never a silent swallow.
- The evaluator/skeptic must verify this live, not from unit tests alone.

## Design decisions to make explicit at the design gate

1. **Where instantiation happens**: new-pipeline flow, an "add from shape" affordance in the editor, or both — and how it composes with hand-authored steps.
2. **Whether seeded steps are plain editable steps after insertion** (recommended default — the ticket calls them a starting point to refine) **or retain a link back to the shape.** The latter has real implications for HEL-399 (panel-declares-shape wiring) — if chosen, say so loudly and flag prominently for HEL-399.
3. **What happens when a shape is instantiated into a pipeline that already has steps**: append, replace, or refuse.

## Process notes

- Design-gate escalation criterion: a round-N REFUTE that is an incomplete application of an already-decided fix, or a pure consistency nit, is NOT new grounds for escalation — continue iterating. Escalate only genuinely-new substantive design flaws.
- Frontend standards binding: `DESIGN.md` (tokens/spacing/type scales/shared components/UI state patterns), `CONTRIBUTING.md` (code quality, co-located `*.test.tsx`, never inline fully-qualified names).
- Mirror how existing step config editors (`*Config.tsx`) are built and tested in `frontend/src/features/pipelines/`.

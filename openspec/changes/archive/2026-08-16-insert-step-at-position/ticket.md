# HEL-410: Authoring UX: add/insert a step between existing steps (not only append)

## Description

Steps can currently only be appended to the end (the `handleAddStep` flow in `PipelineDetailPage.tsx` + `OP_TYPES` picker). Authors need to insert a step at an arbitrary position. `pipeline_steps` already has a `position` column and the create/PATCH endpoints exist (`PipelineStepRoutes`, `CreatePipelineStepRequest`, `UpdatePipelineStepRequest.position`).

## Scope

Backend:

* Support inserting a step at a given position: either accept an optional `position` on `CreatePipelineStepRequest` (shifting later steps down) or add a small insert-at endpoint. Ensure positions stay contiguous/consistent. Logic in the step service/repository (`PipelineStepRepository`, `PipelineService`). No inline fully-qualified names. Update `schemas/`/`openspec/` if the create request gains a field.

Frontend:

* Add an "insert step here" affordance between step cards (and before the first) in `PipelineDetailPage.tsx`; wire it to create the step at that position, then refresh analyze/preview.

## Acceptance criteria

- [ ] A step can be inserted at any position (start, middle, end); subsequent steps' positions shift correctly and persist.
- [ ] The insert affordance appears between/around step cards; inserting refreshes analyze + previews.
- [ ] Existing append behavior still works.
- [ ] Tests: backend insert-at-position (positions reindex correctly); frontend insert flow.
- [ ] Backward compatible: `position` on create is optional (absent = append, current behavior); no enum break; `schemas/`/`openspec/` updated if a field is added.

## Out of scope

* Drag-reorder of existing steps (sibling ticket HEL-407 — shipped).
* DAG/branching model.

## Dependencies

* None. Complements the drag-reorder ticket (both manipulate `position` — HEL-407 shipped the atomic reorder endpoint and the page's optimistic local-state handling this builds beside).

## Delivery notes (orchestrator)

* Fifth ticket in epic HEL-339 (404/405/407/409 all merged; base 6612e291 includes them).
* Ground truth: `insertInternal` appends via MAX(position)+1; `deleteStep` never renumbers, so positions can have gaps today (HEL-407 finding) — any insert-at design must be correct under gaps.
* No Flyway migration expected (`position` exists). If one somehow becomes necessary, STOP and escalate — shared dev Postgres with parallel deliveries; check origin/main HEAD for latest V<N> first.
* Live checks: this run's ports only (dev 5842 / backend 8749) via `start-servers.sh`; never leave servers running. Shared-dev-DB fixtures from earlier reviews ("HEL-407 eval reorder test", "Skeptic Test *") are not this run's to delete.
* File budgets: `PipelineDetailPage.tsx` 626, `StepCard.tsx` 529 (HEL-682 owns splits) — minimize growth, record numbers in files-modified.md.

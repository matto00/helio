# HEL-407: Authoring UX: drag-reorder steps (with re-validation + preview refresh)

## Description

Steps can only be added/removed today; reordering requires delete + re-add. Authors need to drag a step to a new position and have the pipeline re-validate. The backend already models `position` on `pipeline_steps` and supports updating it (`UpdatePipelineStepRequest.position`, `PATCH /api/pipelines/:id/steps/:stepId`); the editor is `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` (steps rendered via `StepCard` / `PipelineRiverView`).

## Scope

Frontend:

* Add drag-to-reorder for step cards in the pipeline editor (keyboard-accessible reorder as well).
* On drop, persist the new `position` ordering via the existing step PATCH endpoint (batch or sequential; ensure a consistent final order).
* Re-run analyze (`useAnalyzePipeline`) and refresh per-step previews after reorder so schema/validation reflect the new order.

Backend:

* Reuse the existing position PATCH. Only add a batch-reorder endpoint if per-step PATCH proves insufficient for a clean atomic reorder (decide in design; if added, put it under `backend/src/main/scala/com/helio/api/routes/` and wire into `ApiRoutes.scala`, no inline FQNs).

## Acceptance criteria

- [ ] Steps can be reordered by drag and by keyboard; the new order persists and survives reload.
- [ ] Analyze + previews refresh after reorder, surfacing any newly-invalid step (e.g. a step now referencing a column produced later).
- [ ] Follows `DESIGN.md`; frontend tests cover reorder → persisted order + analyze refresh.
- [ ] Backward compatible: reuses existing position semantics; no enum/wire break (or additive batch endpoint only).

## Out of scope

* The DAG/branching model (separate design-gated epic) — linear reorder only.

## Dependencies

* None.

## Delivery notes (orchestrator)

* Priority: Medium. Third ticket in epic HEL-339 delivery order (after HEL-404 inline preview, HEL-405 schema diff — both merged; this branch is based on 608bf25f and includes both).
* Backend involvement is a design-gate decision (batch endpoint vs per-step PATCH). If backend code is added: NO Flyway migration should be needed (`position` already exists); if one somehow becomes necessary, check origin/main HEAD for the latest V<N> first — shared dev Postgres with parallel deliveries.
* Live UI checks must use this run's assigned ports (dev 5839 / backend 8746) via `scripts/concertino/start-servers.sh`; never leave servers running.
* Adjacent-file caution: `PipelineDetailPage.tsx` (583) and `StepCard.tsx` (434) are past the 400-line budget; HEL-682 owns the splits — do not bundle them, minimize growth, record numbers in files-modified.md.
* HEL-404 shipped auto-refreshing per-step previews (effect keyed on config fingerprint + preview-open state): reorder-triggered preview refresh should compose with that mechanism, not duplicate it.

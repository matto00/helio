# HEL-404: Authoring UX: inline per-step output preview (rows + schema) in the editor

## Description

Authors need to see what a step produces without leaving the page or running the whole pipeline. A per-step preview already exists: `StepCard.tsx` has a "Preview data" toggle calling `fetchStepPreview` (`frontend/src/features/pipelines/services/pipelineService.ts`), backed by `PipelineRunService.previewStep` (runs the step prefix, returns up to 10 rows). This ticket makes that preview inline and richer: show the output schema alongside the sample rows, and keep it fresh as config changes.

## Scope

Frontend:

* `frontend/src/features/pipelines/ui/StepCard.tsx` — surface the output schema (column names + types, from the analyze endpoint's `outputSchema` for this step — already available via `useAnalyzePipeline`/`analyzeSchema` plumbing) together with the sample rows in the preview tray; make it feel inline (auto-open or persistent per user preference) rather than a bare toggle.
* Refresh the preview after a config PATCH settles (debounced) so rows/schema track edits.
* Reuse the existing `DataGrid` preview variant for rows.

Backend:

* Reuse the existing `previewStep` path; only extend if the schema isn't already derivable client-side from analyze (prefer client-side — analyze already returns per-step input/output schema).

## Acceptance criteria

- [ ] Each StepCard can show, inline, both the sample output rows (≤10) and the output schema (column name + type) for that step.
- [ ] The preview refreshes after config edits settle (debounced), without a full manual run.
- [ ] Loading and error states are handled (reuse existing preview error handling).
- [ ] Follows `DESIGN.md`; frontend tests cover rows+schema rendering and refresh-on-edit.
- [ ] Backward compatible: no wire/enum change; existing preview endpoint reused.

## Out of scope

* The per-step schema diff visualization (sibling ticket HEL-405) — this ticket shows the schema, the diff ticket shows what changed vs input.

## Dependencies

* None. Complements the schema-diff ticket (both read `analyze_pipeline`).

## Delivery notes (orchestrator)

* Priority: High. Part of epic HEL-339 (Pipeline Authoring UX). Sibling HEL-405 depends on the same `analyze_pipeline` plumbing — this ticket lands first.
* Parallel-run hazard: another delivery (HEL-419 epic) shares the same dev Postgres. If a Flyway migration is ever needed (not expected — this is frontend-scoped), check origin/main HEAD for the latest V<N> first.
* Any live UI check must use this run's assigned ports (dev 5836 / backend 8743) via `scripts/concertino/start-servers.sh`, and servers must not outlive the check.

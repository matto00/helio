# HEL-412: Authoring UX: duplicate a step, and disable/enable a step without deleting

## Description

Authors want to duplicate a configured step (clone + tweak) and to temporarily disable a step without losing its config (toggle it out of the run). Neither exists today. `pipeline_steps` has no `enabled` flag, so disable needs persistence; the engine (`InProcessPipelineEngine`, executed via `PipelineRunService`) and analyze (`PipelineAnalyzeService`) must skip disabled steps.

## Scope

Backend:

* Flyway migration — add a `pipeline_steps.enabled BOOLEAN NOT NULL DEFAULT true` column. Use the next available VNN, assigned at scheduling time (ticket text said "main at V59" — stale; see Delivery notes: origin/main HEAD is at V84, V85 is claimed by the parallel HEL-462 lane, so this change takes V86, coordinator-confirmed).
* Thread `enabled` through the domain (`PipelineStep` + step repository), the step response protocol (`PipelineStepProtocol`), and the create/PATCH requests (so it can be toggled). The engine and analyze must SKIP disabled steps (drop them from the executed/analyzed step list). No inline fully-qualified names.
* Duplicate: an endpoint or create-flow that clones a step's kind+config and inserts it (position after the original) — mirror the existing panel/pipeline duplicate patterns if present.
* Update `schemas/`/`openspec/` for the `enabled` field + duplicate endpoint.

Frontend:

* `StepCard.tsx` — a disable/enable toggle (disabled cards render visually muted and are excluded from analyze/preview) and a "Duplicate step" action; wire through `useStepCardState` / `PipelineDetailPage.tsx`.

## Acceptance criteria

- [ ] A step can be duplicated (clone kind+config, inserted after the original) via the UI.
- [ ] A step can be disabled/enabled; disabled steps are persisted, excluded from runs AND from analyze/preview, and re-enable cleanly.
- [ ] Flyway migration applies cleanly on fresh + existing DBs; existing steps default to `enabled = true`.
- [ ] Tests: backend run/analyze skip a disabled step; duplicate produces an equivalent step; frontend toggle + duplicate.
- [ ] Backward compatible: `enabled` defaults true so existing pipelines behave identically; `enabled` is additive on the wire (absent = true).

## Out of scope

* DAG/branching model.

## Dependencies

* None. Interacts with the insert-between and reorder tickets via `position` (both shipped — this branch's base 68a2dd32 includes `insertAtInternal`, which duplicate reuses).

## Delivery notes (orchestrator)

* Final ticket of epic HEL-339 (404/405/407/409/410 all merged).
* **MIGRATION NUMBER — RESOLVED**: origin/main HEAD's latest migration is `V84__pipeline_run_assertions.sql`; the parallel HEL-462 delivery (pipeline-schema-drift-detection, same shared dev Postgres) has claimed **V85** for its `last_source_schema` migration (confirmed across its own gates, mid-delivery). The coordinator therefore confirmed **V86** for this change (escalation raised end of Planning, answered use-V86). V86 is used everywhere: filename, spec delta text, tests. Do not renumber without a new coordinator decision.
* Live checks: this run's ports only (dev 5844 / backend 8751); never leave servers running. Note: applying the migration via a backend start in ANY worktree applies it to the shared dev DB — the migration is additive with DEFAULT true, so it is safe for the other lane once the number is confirmed.
* File budgets (HEL-682 owns splits): `PipelineDetailPage.tsx` 653, `PipelineRiverView.tsx` 289, `StepCard.tsx` 529 — minimize growth, record actuals in files-modified.md.

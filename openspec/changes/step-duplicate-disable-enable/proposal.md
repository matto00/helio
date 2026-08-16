# Proposal: step-duplicate-disable-enable

## Why

Cloning a configured step means manual re-entry; temporarily removing a step from a run means
deleting it and losing its config. HEL-412 (final ticket of epic HEL-339) adds both affordances:
duplicate (clone + insert after the original — directly reusing HEL-410's transactional
`insertAtInternal`) and disable/enable (a persisted `enabled` flag the engine, analyze, and
preview all skip).

## What Changes

- **Migration**: `pipeline_steps.enabled BOOLEAN NOT NULL DEFAULT true` — **V86**, coordinator-
  confirmed (V85 is claimed by the parallel HEL-462 lane's `last_source_schema` migration on the
  shared dev Postgres; origin/main HEAD is V84).
  Existing rows default true → identical behavior.
- **Backend**: `enabled` threaded through domain/repository/response protocol (every step
  response subtype gains `enabled: Boolean`, always serialized); `CreatePipelineStepRequest` and
  `UpdatePipelineStepRequest` gain `enabled: Option[Boolean]` (absent = true on create /
  no-change on PATCH). Runs, analyze, and step preview all operate on the enabled-only step list
  (a disabled step is dropped from execution and analysis; previewing a disabled step itself →
  422). New `POST /api/pipeline-steps/:id/duplicate` (mirrors the dashboard/panel duplicate
  route shape): clones kind+config+enabled, inserts at the original's list index + 1 via
  `insertAtInternal`, returns the created step.
- **Frontend**: StepCard gains Disable/Enable and Duplicate actions (sibling controls in the
  HEL-407 actions cluster); disabled cards render muted (token-only `--disabled` modifier) with
  their preview unavailable; page-local handlers with the editor's optimistic + revert/keep
  conventions; analyze/preview freshness via extended fingerprints.
- **Schemas**: `create-pipeline-step-request.schema.json` gains `enabled`.

## Capabilities

### New Capabilities

- `pipeline-step-lifecycle`: duplicate + disable/enable — the skip semantics (run/analyze/
  preview), the duplicate endpoint, and the editor affordances.

### Modified Capabilities

- `pipeline-steps-persistence`: table requirement (enabled column + migration), POST (optional
  `enabled`), PATCH (toggle `enabled`).

## Impact

- Backend: migration, `model.scala` (PipelineStep), `PipelineStepRepository`,
  `PipelineStepProtocol` (~23 response subtypes + 2 requests), `PipelineService` (duplicate +
  enabled), `PipelineRunService` (run + preview filtering), analyze call site, routes, tests.
- Frontend: `types/step.ts` + `stepNarrowing`, `StepCard.tsx`, `PipelineRiverView.tsx`,
  `PipelineDetailPage.tsx`, `pipelineService.ts`, CSS, tests.

## Non-goals

- DAG/branching. Renumber-on-delete. Bulk disable. Run-history backfill of the flag.

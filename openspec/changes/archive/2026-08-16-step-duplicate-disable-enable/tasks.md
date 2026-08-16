# Tasks: step-duplicate-disable-enable

## 1. Backend — enabled flag

- [x] 1.1 Flyway migration `V86__pipeline_steps_enabled.sql` (number COORDINATOR-CONFIRMED: V85 is taken by the parallel HEL-462 lane — do not renumber): `ALTER TABLE pipeline_steps ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true;`
- [x] 1.2 Domain + repo: `PipelineStep.enabled: Boolean`, row mapping, all reads/writes (`PipelineStepRepository`), `insertInternal`/`insertAtInternal` accept enabled (default true)
- [x] 1.3 Protocol: every `PipelineStepResponse` subtype + sealed-trait accessor gains `enabled: Boolean` (formats bumped); `CreatePipelineStepRequest.enabled: Option[Boolean] = None` (None→true); `UpdatePipelineStepRequest.enabled: Option[Boolean]` (None→no-change)
- [x] 1.4 Skip semantics at ALL FIVE list-assembly boundaries (design Decision 3): full run + dry run filter `_.enabled`; the live analyze call site filters before `PipelineAnalyzeService.analyze`; `PipelineService.analyzeProposal` and `BoundPanelService.projectSchema` filter `enabled.getOrElse(true)` from their `CreatePipelineStepRequest`-shaped step inputs; `previewStep` filters the prefix and returns 422 when the target step itself is disabled
- [x] 1.5 Update `schemas/create-pipeline-step-request.schema.json` (add `enabled`); `npm run check:schemas` green

## 2. Backend — duplicate endpoint

- [x] 2.1 `PipelineService.duplicateStep(stepId, user)`: findByIdInternal → NotFound masking + editor/owner ACL (updateStep pattern) → typed config round-trip decode → `insertAtInternal(pipelineId, kind, config, originalListIndex + 1)` cloning enabled → 201 created-step response
- [x] 2.2 Route `POST pipeline-steps/:id/duplicate` in `PipelineStepRoutes.scala` (thin shell, mirrors dashboard/panel duplicate path shape; no inline FQNs)
- [x] 2.3 Backend tests (`PipelineStepRoutesSpec` + run/analyze/preview specs): run + dry-run skip a disabled step; analyze covers enabled-only; preview prefix skips disabled; preview of disabled target → 422; all-steps-disabled = zero-step passthrough; enabled defaults true on create + existing rows; PATCH enabled round-trips; duplicate lands at index+1 with equivalent kind/config/enabled (incl. disabled clone), 403 viewer, 404 masking; analyzeProposal excludes a proposal step with enabled:false; projectSchema excludes a BoundPipelineSpec step with enabled:false

## 3. Frontend

- [x] 3.1 Types: `Step.enabled` + `PipelineStep.enabled` (normalize `enabled ?? true` at the service boundary); `pipelineStepToStep` maps it
- [x] 3.2 Services: `updatePipelineStepEnabled(stepId, enabled)` (PATCH `{enabled}`); `duplicatePipelineStep(stepId)` (POST duplicate)
- [x] 3.3 `StepCard.tsx`: Disable/Enable + Duplicate buttons as siblings in the actions cluster (accessible action names; toggle label flips with state); `--disabled` muted card modifier (token-only); preview button hidden when disabled; error chip naturally absent (no analyze entry)
- [x] 3.4 `PipelineDetailPage.tsx`: `handleToggleStepEnabled` (optimistic flip → PATCH → reconcile; revert + toast on failure) and `handleDuplicateStep` (POST → splice clone after original; toast on failure, non-optimistic); thread through `PipelineRiverView`
- [x] 3.5 Freshness: extend `stepsFingerprint` with `enabled`; StepCard preview fingerprint gains an `enabledBits` prop (`${stepIndex}:${enabledBits}:${config}`)
- [x] 3.6 CSS: `--disabled` modifier + any action-button styles, token-only per `DESIGN.md`

## 4. Tests + gates

- [x] 4.1 Frontend tests: toggle mutes card + hides preview + persists (optimistic revert on failure); duplicate splices after original; disabled card shows no error chip; fingerprint assertions (toggle re-dispatches analyze; toggle refreshes open previews via enabledBits)
- [x] 4.2 Record file growth + notes in `files-modified.md` (529/653/289 pre-change; HEL-682 owns splits)
- [x] 4.3 Run gates: backend `sbt test`; frontend `npm run lint` + `npm run format:check` + `npm test`; `npm run check:schemas` — all clean

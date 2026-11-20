## Why

On a shared pipeline's detail page a viewer grantee sees Run pipeline and Dry run, which the server refuses, and every grantee sees "This pipeline reads from a source type we don't yet recognize" for any root they do not own. A grantee on a pipeline with a compute step also sees "A step in this pipeline has a problem…" and an editor loses `canRun`, because analyze validates steps against the grantee's own (empty) view of the root schema. All of these read like bugs, and the editor ones are wrong.

## What Changes

- Analyze computes the cost verdict and each step's validity from the pipeline definition as the OWNER sees it, once pipeline access is confirmed:
  - root kinds for the cost estimator come from the privileged root read the run path and the auto-run trigger already use;
  - step `validationError` and the `step-config-invalid` reasons come from a validation pass over the owner's root schemas.
- Nothing new about a source reaches a grantee. `sourceSchemas`, step input/output schemas and `warnings` stay computed from the caller's view exactly as today. For a non-owner, every estimator reason's `detail` is a neutral per-code sentence; a `validationError` text is sent only if it names nothing a grantee does not already receive.
- The pipeline detail page hides every run entry from a viewer: desktop header Dry run / Run pipeline / Save & run, the phone pills (Dry run / Run pipeline / Save & run), the Output sheet's Run pipeline, and the save-toast Run now. Discard stays for a viewer who has a draft. "Run to update" is already gated by `canRun`.
- A viewer sees a "View only" indicator in the header on desktop and phone (HEL-1782's recipe).
- A follow-up ticket covers making the whole pipeline page read-only for viewers.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-analyze-api`: cost verdict and step validity follow the pipeline definition for every admitted caller; non-owners get neutral reason detail.
- `pipeline-detail-spine-layout`: a viewer gets no run entries and a "View only" indicator.
- `pipeline-detail-mobile-layout`: a viewer gets no run pills and a "View only" indicator.

## Impact

- Backend: `PipelineAnalyzeReads.scala` (cost-input `resolveRoot`, an owner-view validation pass, non-owner detail neutralizing). Possibly a small helper in `domain/engine`. Not `PipelineService.scala`. No migration, no wire-shape change.
- Frontend: `features/pipelines` header, mobile actions, Output sheet preview card, save-toast wiring, run handlers, run-history empty copy for viewers.
- Behaviour change: for editors and viewers, `costVerdict.autoRunnable`, `reasons` and `canRun`, plus step `validationError`, change from the grantee-view value to the owner's.

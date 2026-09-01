## MODIFIED Requirements

### Requirement: Applying a pipeline-step patch preserves PipelineStep.enabled
Applying a patch-set operation that adds, removes, or modifies a `PipelineStep` SHALL preserve
that step's `enabled` field exactly as specified by the operation, with no implicit default —
fixing HEL-766, where `PatchSetApplyRollback`'s inverse builders (`fullPipelineStepInverse`,
`pipelineStepCreateRequestFromPrior`) omitted `enabled`, silently falling through to
`CreatePipelineStepRequest.enabled`'s `None` default.

#### Scenario: Modify-patch on a disabled step keeps it disabled after apply
- **WHEN** a patch-set modifies a `PipelineStep` that is currently `enabled: false` without an
  explicit `enabled` change
- **THEN** the step remains `enabled: false` after the patch is applied

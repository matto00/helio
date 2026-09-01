## MODIFIED Requirements

### Requirement: Undo of a pipeline-step patch restores PipelineStep.enabled exactly
Undoing an applied patch-set operation on a `PipelineStep` SHALL restore that step's `enabled`
field to its prior value exactly, via `fullPipelineStepInverse`/`pipelineStepCreateRequestFromPrior`
explicitly setting `enabled = prior.enabled` (HEL-766) rather than relying on
`CreatePipelineStepRequest.enabled`'s own default.

#### Scenario: Undo restores a step's prior enabled state
- **WHEN** an applied patch-set operation that changed a `PipelineStep`'s `enabled` field is undone
- **THEN** the step's `enabled` field reverts to its value before the patch was applied

#### Scenario: Undo restores a removed placement
- **WHEN** an applied patch-set operation removed a dashboard placement and is then undone
- **THEN** the placement is recreated with the same `outputId` and position it had before removal

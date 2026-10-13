## ADDED Requirements

### Requirement: pipelineStep update preview resolves for every registered step kind
A `POST /api/patch-sets/preview` containing a `pipelineStep` `update` edit SHALL resolve for every step kind registered in `PipelineStep.Registry`: a position-only update and a valid config update SHALL each return 200 with an `after` reflecting the requested position/config, never a 500 and never a 400 claiming a config/kind type mismatch. The preview's acceptance SHALL agree with apply's for the same edit.

#### Scenario: Position-only update of a convertformat, analyzewithai or generatetext step
- **WHEN** a patch set updating only the `position` of an existing `convertformat`, `analyzewithai` or `generatetext` step is previewed
- **THEN** the response is 200 and the edit's `after` carries that step's `type`, its unchanged config, and the requested position

#### Scenario: Config update of a convertformat, analyzewithai or generatetext step
- **WHEN** a patch set replacing the `config` of such a step with a valid config of the same kind is previewed
- **THEN** the response is 200 and the edit's `after.config` equals the requested config

#### Scenario: A newly registered step kind without a projection arm
- **WHEN** a step kind is added to `PipelineStep.Registry` without a matching arm in the preview projection
- **THEN** the backend test suite fails, naming the kind

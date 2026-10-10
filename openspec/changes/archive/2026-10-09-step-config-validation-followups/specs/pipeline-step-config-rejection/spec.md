## ADDED Requirements

### Requirement: A patch-set pipelineStep create edit with a rejected config fails at resolve and preview

A patch-set `pipelineStep` create edit whose supplied configuration the REST step create surface would reject with 422
SHALL be rejected when the patch set is resolved, before any edit in it is applied: applying such a patch set SHALL
return a 422 response whose message is `edit <index>: ` followed by the same rejection message the step create surface
returns, and previewing it SHALL be rejected with the same 422 and message. No step SHALL be created and no other edit
in that patch set SHALL be applied. This is the same status and message shape a patch-set `pipelineStep` update edit
already returns for a rejected configuration. A configuration this surface accepts SHALL still apply, and an incomplete
draft that the step create surface accepts SHALL still be accepted.

#### Scenario: Step-create edit with an unknown compute function is rejected on apply
- **GIVEN** a pipeline owned by the caller and a patch set whose first edit updates that pipeline and whose second edit
  creates a `compute` step on it with expression `$a + nosuchfn($b)`
- **WHEN** the patch set is applied
- **THEN** the response status is 422 and the message starts with `edit 1: ` and names `nosuchfn`
- **AND** the first edit is not applied and no step is created

#### Scenario: Step-create edit with an unknown compute function is rejected on preview
- **WHEN** the same patch set is previewed
- **THEN** the response status is 422 and the message starts with `edit 1: `

#### Scenario: Step-create edit with a valid config still applies
- **WHEN** a patch set creating a `compute` step with a parseable expression is applied
- **THEN** the step is created and the response reports no failure

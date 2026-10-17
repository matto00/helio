## ADDED Requirements

### Requirement: Undo of a pipeline-definition save
`POST /api/patch-sets/:id/undo` SHALL dispatch a `pipelineDefinition` journal row to an atomic restore that re-applies
the journaled prior definition through the draft-save transaction against the post-save fingerprint, including trunk
order, recreating deleted steps and Outputs under their original ids.

#### Scenario: Undo restores order and deleted steps
- **WHEN** a save reordered steps and deleted an unbound step, and nothing changed since
- **THEN** undo restores the prior order and recreates the step under its original id in one transaction

#### Scenario: Later edit blocks undo
- **WHEN** the pipeline changed after the save
- **THEN** undo returns 409 `PATCH_SET_STALE` and writes nothing

#### Scenario: Cascade removed panels or alert rules
- **WHEN** the save's cascade removed a bound panel or a targeting alert rule
- **THEN** undo returns 409 naming each such panel and alert rule and writes nothing

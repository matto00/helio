## ADDED Requirements

### Requirement: Undo SHALL refuse when it would delete Outputs or pipeline steps the patch set did not create
Before restoring anything, undo SHALL find every Output and every pipeline step that the undo of a `pipeline` or `pipelineStep` `create` edit would delete. For a pipeline that is every Output and every step of that pipeline. For a pipeline step it is every descendant step the step delete removes with it, and every Output on the step or on those descendants. If any such Output or step was not created by the same patch set, undo SHALL refuse the whole undo with a conflict error and restore no edit. Only Outputs and steps the same patch set itself created are excused: those its `output` and `pipelineStep` `create` edits created, and those its `pipeline` or `pipelineStep` `create` edit made as part of that create. This holds regardless of which user created or owns the Output or step.

The conflict message SHALL name each blocking Output the undoing user can read, by Output name, and SHALL report only a count of blocking Outputs the undoing user cannot read, never their names or ids. Blocking steps SHALL be described without their ids. No id of a blocking Output or step SHALL appear in the message.

#### Scenario: An Output an editor added to a created pipeline refuses the undo
- **WHEN** user A applies a patch set that creates a pipeline, user B (an editor grantee on that pipeline) adds an Output to it, and A calls `POST /api/patch-sets/:id/undo`
- **THEN** the call is rejected with a conflict error naming B's Output, and the pipeline, B's Output and every other resource in that application remain exactly as they were before the undo call

#### Scenario: An Output the same user added after the apply refuses the undo
- **WHEN** user A applies a patch set that creates a pipeline, A then adds an Output to it outside the patch set, and A undoes
- **THEN** the call is rejected with a conflict error naming that Output, and nothing is restored

#### Scenario: A step added to a created pipeline after the apply refuses the undo
- **WHEN** user A applies a patch set that creates a pipeline, a step is then added to it outside the patch set (by A or by an editor), and A undoes
- **THEN** the call is rejected with a conflict error and nothing is restored

#### Scenario: Outputs and steps the patch set itself created do not block
- **WHEN** a patch set creates a pipeline with inline steps and Outputs, nothing else is added to the pipeline, and the applying user undoes
- **THEN** the undo succeeds and removes the pipeline with its steps and Outputs

#### Scenario: A later Output on a created step refuses the undo
- **WHEN** a patch set creates a pipeline step on an existing pipeline, an Output (or a descendant step) is later added on it outside the patch set, and the applying user undoes
- **THEN** the whole undo is refused with a conflict error, and the step and the later Output remain

#### Scenario: An Output added during the undo is not deleted silently
- **WHEN** an Output is added to a created pipeline after undo's pre-check passed but before the pipeline is deleted, and the re-check immediately before the delete sees it
- **THEN** the pipeline is not deleted and the undo reports that edit as failed rather than restored

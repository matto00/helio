## ADDED Requirements

### Requirement: Undo SHALL refuse when it would delete alert rules, a schedule or pipeline roots the patch set did not create
Before restoring anything, undo SHALL find every alert rule that targets an Output the undo of a `pipeline`, `pipelineStep` or `output` `create` edit would delete (the Outputs named by the requirement on later Outputs and steps, or, for an `output` create, the created Output itself). For a `pipeline` `create` edit it SHALL also find the pipeline's schedule, if any, and every root of the pipeline that the create did not make. If any such alert rule, schedule or root exists, undo SHALL refuse the whole undo with a conflict error and restore no edit. A patch set never creates alert rules or schedules, so every one found blocks; a root is excused only if the same `pipeline` create made it. This holds regardless of which user created or owns the alert rule, schedule or root.

The conflict message SHALL name an alert rule only to the user who owns it, by rule name, and SHALL count the others. It SHALL name a blocking root by its data source's name only when the undoing user can read that data source, and SHALL count the others. No id of a blocking alert rule, schedule, root or data source SHALL appear in the message. Immediately before each delete, undo SHALL re-check and report the edit as failed, with counts only, when a blocking alert rule, schedule or root has appeared since the pre-check.

#### Scenario: An alert rule added to a created Output refuses the undo
- **WHEN** user A applies a patch set that creates a pipeline with an Output, A then creates an alert rule targeting that Output, and A calls `POST /api/patch-sets/:id/undo`
- **THEN** the call is rejected with a conflict error naming A's alert rule, and the pipeline, its Output, the alert rule and every other resource in that application remain exactly as they were before the undo call

#### Scenario: An alert rule on an Output created by an output create edit refuses the undo
- **WHEN** a patch set creates an Output on an existing pipeline, an alert rule is later created targeting it, and the applying user undoes
- **THEN** the whole undo is refused with a conflict error, and the Output and the alert rule remain

#### Scenario: An alert rule on an Output under a created step refuses the undo
- **WHEN** a patch set creates a pipeline step with an Output on an existing pipeline, an alert rule is later created targeting that Output, and the applying user undoes
- **THEN** the whole undo is refused with a conflict error, and the step, the Output and the alert rule remain

#### Scenario: A schedule added to a created pipeline refuses the undo
- **WHEN** user A applies a patch set that creates a pipeline, A then sets a schedule on it, and A undoes
- **THEN** the call is rejected with a conflict error that mentions the schedule, and the pipeline and its schedule remain

#### Scenario: A root an editor added to a created pipeline refuses the undo
- **WHEN** user A applies a patch set that creates a pipeline, user B (an editor grantee) adds a root on B's own data source, and A undoes
- **THEN** the call is rejected with a conflict error that counts the root without naming B's data source or exposing any id, and the pipeline and the root remain

#### Scenario: Roots the pipeline create made do not block
- **WHEN** a patch set creates a pipeline with its roots (more than one when the create request allows it), nothing is added to it afterwards, and the applying user undoes
- **THEN** the undo succeeds

#### Scenario: An alert rule added during the undo is not deleted silently
- **WHEN** an alert rule targeting a doomed Output is created after undo's pre-check passed but before the delete, and the re-check immediately before the delete sees it
- **THEN** that resource is not deleted and the undo reports the edit as failed rather than restored

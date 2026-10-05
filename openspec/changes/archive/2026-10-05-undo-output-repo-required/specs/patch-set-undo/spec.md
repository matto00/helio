## ADDED Requirements

### Requirement: Undo SHALL refuse the whole undo with a typed error when a needed Output repository is unavailable
Before restoring anything, undo SHALL check whether any journaled edit in the application needs the Output
repository: a `pipelineStep` create edit (whose undo reports the removed placement count), or a `pipelineStep` delete
edit whose journaled prior state captured one or more bound Outputs (whose undo recreates them). If such an edit is
present and the Output repository is not configured, undo SHALL reject the entire call with a server error whose
message is `Output repository is not configured`, and SHALL NOT restore any edit in that application. It SHALL NOT
fail with an unhandled null dereference, recreate a step without its bound Outputs, or report a fabricated `0`
placement count. An application with no such edit SHALL undo normally, whether or not the Output repository is
configured.

#### Scenario: A lane-delete undo with bound Outputs and no Output repository is refused before any restore
- **WHEN** undo is called on an application containing a `pipelineStep` delete edit whose journal captured bound
  Outputs, and the Output repository is not configured
- **THEN** the call fails with a server error naming `Output repository is not configured`, and no step, Output, or
  placement is recreated

#### Scenario: A lane-create undo with no Output repository is refused rather than reporting a zero count
- **WHEN** undo is called on an application containing a `pipelineStep` create edit, and the Output repository is not
  configured
- **THEN** the call fails with a server error naming `Output repository is not configured`, and the created step is
  not deleted

#### Scenario: An application that never needs the Output repository undoes normally
- **WHEN** undo is called on an application containing only panel/dashboard edits, and the Output repository is not
  configured
- **THEN** the undo succeeds exactly as it would with the Output repository configured

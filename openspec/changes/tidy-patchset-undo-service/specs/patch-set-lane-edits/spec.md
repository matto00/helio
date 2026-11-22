## REMOVED Requirements

### Requirement: Undoing an added lane removes the lane, its Outputs, and their placements
**Reason**: HEL-1720 and HEL-1795 made undo refuse whenever removing a lane would delete an Output or a placement the
patch set did not create, and a patch set cannot create an Output on a step it creates in the same set, so the cascade
this requirement described (and its placement count, always 0 since) no longer happens.
**Migration**: Superseded by "Undoing an added lane removes the lane and never deletes work the patch set did not
create" below. A client that read `resultingState.removedPlacementCount` from a restored `pipelineStep` create-undo
should treat it as absent (it was always 0); neither the web client nor helio-mcp reads it.

## ADDED Requirements

### Requirement: Undoing an added lane removes the lane and never deletes work the patch set did not create
Undo of a patch set that added a lane SHALL remove every step the patch set created. Undo SHALL NOT delete an Output,
a pipeline step or a panel placement that the patch set did not create: when removing the lane would delete one, the
whole undo SHALL be refused with a conflict error and nothing SHALL be removed, under the same rules, conflict
messages and re-check immediately before the delete that the `patch-set-undo` capability states for a `pipelineStep`
create edit (a narrow window between that re-check and the delete remains, as documented in the undo service). Undo SHALL NOT leave an Output bound
to a deleted node, and SHALL NOT leave a panel placed on a deleted Output.

The undo outcome for the lane's create edit SHALL report it `restored` with the removed step's id as `newId`, and SHALL
carry no `resultingState` (in particular no placement count), the same as every other restored create edit.

Undo SHALL be atomic: if any part of the removal cannot be performed, the whole undo is refused and
nothing is removed, rather than a partial teardown.

#### Scenario: Undo of an added lane with nothing added since removes it
- **WHEN** a patch set that added a lane is undone, and no Output, step or placement has been added to that lane since
- **THEN** the lane's step is gone, and the edit's undo outcome is `restored` with the step's id as `newId` and no
  `resultingState`

#### Scenario: Undo of an added lane carrying a later Output and placement is refused
- **WHEN** an Output is added to a lane after the patch set that added it was applied, a panel is placed on that
  Output, and the patch set is undone
- **THEN** the whole undo is refused with a conflict error naming the panel, and the lane's step, the Output and the
  placement remain

#### Scenario: Undo of an added lane leaves the rest of the pipeline intact
- **WHEN** a patch set that added a lane to a pipeline with an existing trunk is undone
- **THEN** the trunk's steps, Outputs, and placements are unchanged, and the pipeline still has at
  least one lane

#### Scenario: A surviving rejoin referencing the added lane refuses the undo
- **WHEN** a step added after the patch set carries a `lane`-kind secondary input referencing a node
  the undo would delete
- **THEN** the whole undo is refused with a named error identifying the referencing step, and nothing
  is removed

#### Scenario: Removing a lane by patch set and undoing it restores its Outputs and placements
- **WHEN** a patch set deletes a lane carrying a placed Output, and is then undone
- **THEN** the lane's steps, its Output, and its placement are restored

## ADDED Requirements

### Requirement: Undo SHALL refuse when a resource it would delete carries panels the patch set did not create
Before restoring anything, undo SHALL find every panel that the undo of an `output`, `pipelineStep`, `pipeline` or `dashboard` `create` edit would delete. For an Output that is a panel bound to it. For a pipeline step it is a panel bound to any Output on a step that the step delete would remove, which includes the descendant steps the delete removes with it. For a pipeline it is a panel bound to any Output of that pipeline. For a dashboard it is a panel on that dashboard. If any such panel was not created by the same patch set, undo SHALL refuse the whole undo with a conflict error and restore no edit. Only panels the same patch set itself created (its `panel` `create` edits) are excused, because the reverse walk deletes them before the resource. This holds regardless of which user owns the panel.

The conflict message SHALL name each blocking panel the undoing user can read, by panel title and dashboard name. It SHALL report only a count of blocking panels the undoing user cannot read, never their titles or dashboard names.

#### Scenario: Another user's panel bound to a created Output refuses the undo
- **WHEN** user A applies a patch set that creates an Output, user B (an editor on A's dashboard) duplicates a panel bound to that Output so that B owns the copy, and A calls `POST /api/patch-sets/:id/undo`
- **THEN** the call is rejected with a conflict error naming B's panel, and the Output, B's panel and every other resource in that application remain exactly as they were before the undo call

#### Scenario: A panel the same user bound after the apply refuses the undo
- **WHEN** user A applies a patch set that creates an Output, A then binds a new panel to it outside the patch set, and A undoes
- **THEN** the call is rejected with a conflict error naming that panel, and nothing is restored

#### Scenario: Panels the patch set itself created do not block
- **WHEN** a patch set creates an Output and a panel bound to it, nothing else binds to the Output, and the applying user undoes
- **THEN** the undo succeeds and removes both the panel and the Output

#### Scenario: A blocking panel the undoing user cannot read is counted, not named
- **WHEN** an undo is refused because of a blocking panel on a dashboard the undoing user cannot read
- **THEN** the conflict message includes a count of such panels and does not include that panel's title or its dashboard's name

#### Scenario: Pipeline-step, pipeline and dashboard create undos are guarded the same way
- **WHEN** the undo of a `pipelineStep`, `pipeline` or `dashboard` create edit would delete a panel the patch set did not create
- **THEN** the whole undo is refused with a conflict error and nothing is restored

#### Scenario: A panel bound to an Output on a descendant step that the step delete removes refuses the undo
- **WHEN** a patch set creates a pipeline step, a second child step is later added under it (so deleting the step would remove that child), an Output is created on the child and a panel is bound to it, and the applying user undoes
- **THEN** the whole undo is refused with a conflict error, and the child step, its Output and the panel remain

#### Scenario: A bind that lands during the undo is not deleted silently
- **WHEN** a panel is bound to a created Output after undo's pre-check passed but before the Output is deleted
- **THEN** the Output is not deleted, the panel remains, and the undo reports that edit as failed rather than restored

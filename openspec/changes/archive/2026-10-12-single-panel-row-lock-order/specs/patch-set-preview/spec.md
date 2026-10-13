## ADDED Requirements

### Requirement: Preview is cumulative across the edits of one patch set
Patch-set preview SHALL project each edit against the state produced by the earlier edits of the same patch set, as
apply would execute them in order: an edit's `after` SHALL equal what apply returns as that edit's resulting state
(ignoring server-assigned ids and timestamps), the dashboard-delete impact count SHALL reflect panels created or
removed by earlier edits, and an edit that apply would fail because an earlier edit deleted (directly or by cascade)
its target or a resource it references, or moved the dashboard's layout version past an `expectedLayoutVersion` it
carries, SHALL fail the whole preview with the same error class. Each edit's `before` and target fingerprint SHALL
remain the pre-apply state, matching apply's `priorState` and stale check.

#### Scenario: Panel delete then dashboard rename
- **WHEN** a patch set deletes a panel of dashboard D and then renames D
- **THEN** the rename's preview `after.layout` has no items for the deleted panel, equal to apply's resulting state

#### Scenario: Panel create then dashboard appearance update
- **WHEN** a patch set creates a panel on D and then updates D's appearance
- **THEN** the update's preview `after.layout` includes the new panel's placement in every breakpoint at the
  position apply assigns

#### Scenario: Two updates of the same target
- **WHEN** a patch set updates a panel's title and then the same panel's appearance
- **THEN** the second edit's preview `after.title` is the new title

#### Scenario: Update of a target an earlier edit deleted
- **WHEN** a patch set deletes a panel and then updates the same panel
- **THEN** preview fails with a not-found error instead of returning an `after`

#### Scenario: Stale expected layout version after an earlier layout change
- **WHEN** a patch set creates a panel on D and then updates D's layout with `expectedLayoutVersion` equal to D's
  version before the patch set
- **THEN** preview fails with a layout conflict

#### Scenario: Fingerprints unaffected by earlier edits
- **WHEN** a patch set edits the same target twice and is applied with the fingerprints preview returned
- **THEN** apply does not report the patch set stale

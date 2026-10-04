## MODIFIED Requirements

### Requirement: Derived and repaired layouts persist only on an edit at that breakpoint
Viewing a dashboard, resizing the window across breakpoints, or editing at a different breakpoint MUST NOT write a
derived or repaired layout, mark the dashboard as having unsaved layout changes, or add an undo/redo history entry,
with one exception: when the dashboard's owner opens it, each stored-bad breakpoint (overlapping or out of bounds as
stored) SHALL be written once as displayed, without marking unsaved changes or adding history (see
`stored-layout-repair`). A breakpoint that is only missing panels SHALL still never be written on view, and a
non-owner's view SHALL never write. When the user drags or resizes at a breakpoint, the layout persisted SHALL carry
that breakpoint's edited layout and leave every other breakpoint's saved layout as it was.

#### Scenario: View only
- **WHEN** a dashboard with missing md/sm/xs layouts is opened and the window is resized across breakpoints
- **THEN** no layout PATCH is sent and the dirty indicator never appears

#### Scenario: Edit at md
- **WHEN** the user drags a panel at the md breakpoint
- **THEN** the persisted layout contains the md edit and the previously saved lg layout unchanged

#### Scenario: Owner open of a stored-bad breakpoint
- **WHEN** the owner opens a dashboard whose stored `md` holds out-of-bounds coordinates
- **THEN** `md` is written once as displayed, the dirty indicator never appears and no undo entry is added

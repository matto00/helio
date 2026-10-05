## MODIFIED Requirements

### Requirement: Derived and repaired layouts persist only on an edit at that breakpoint
Viewing a dashboard, resizing the window across breakpoints, or editing at a different breakpoint MUST NOT write a
derived or repaired layout, mark the dashboard as having unsaved layout changes, or add an undo/redo history entry.
There is one exception. When the dashboard's owner opens it, each repairable breakpoint SHALL be written once as
displayed, without marking unsaved changes or adding history (see `stored-layout-repair`). A repairable breakpoint is
one that is stored-bad (overlapping or out of bounds as stored) or incomplete (valid but missing a live panel). For an
incomplete breakpoint, that write keeps every stored item of a live panel unchanged and adds only the missing panels.
This reverses the earlier rule that a breakpoint only missing panels is never written on view, by owner ruling
`extend-owner-repair` (HEL-1260). A non-owner's view SHALL never write. When the user drags or resizes at a breakpoint,
the layout persisted SHALL carry that breakpoint's edited layout and leave every other breakpoint's saved layout as it
was.

#### Scenario: View only
- **WHEN** a dashboard with missing md/sm/xs layouts is opened by a user who does not own it, and the window is resized
  across breakpoints
- **THEN** no layout write is sent and the dirty indicator never appears

#### Scenario: Edit at md
- **WHEN** the user drags a panel at the md breakpoint
- **THEN** the persisted layout contains the md edit and the previously saved lg layout unchanged

#### Scenario: Owner open of a stored-bad breakpoint
- **WHEN** the owner opens a dashboard whose stored `md` holds out-of-bounds coordinates
- **THEN** `md` is written once as displayed, the dirty indicator never appears and no undo entry is added

#### Scenario: Owner open of an incomplete breakpoint
- **WHEN** the owner opens a dashboard whose stored `lg` is valid and complete but whose `md`, `sm` and `xs` are empty
- **THEN** `md`, `sm` and `xs` are each written once as displayed, `lg` is not written, no layout PATCH is sent, the
  dirty indicator never appears and no undo entry is added

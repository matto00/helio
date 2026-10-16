## MODIFIED Requirements

### Requirement: Users can undo and redo layout changes via toolbar buttons
The dashboard meta row MUST expose undo and redo buttons while layout edit mode is on, reflecting the availability of history. The buttons MUST NOT render while edit mode is off, and the command bar MUST NOT render undo or redo buttons.

#### Scenario: Undo button triggers undo
- **WHEN** edit mode is on and the user clicks the undo button
- **THEN** the active dashboard layout reverts to the previous committed state

#### Scenario: Redo button triggers redo
- **WHEN** edit mode is on and the user clicks the redo button
- **THEN** the active dashboard layout advances to the next redo state

#### Scenario: Undo button is disabled when no history is available
- **WHEN** edit mode is on and the undo stack for the active dashboard is empty
- **THEN** the undo button is rendered in a disabled state and cannot be activated

#### Scenario: Redo button is disabled when no redo history is available
- **WHEN** edit mode is on and the redo stack for the active dashboard is empty
- **THEN** the redo button is rendered in a disabled state and cannot be activated

#### Scenario: Buttons are hidden outside edit mode
- **WHEN** edit mode is off
- **THEN** no undo or redo button renders on the dashboard page or in the command bar
- **AND** `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` still undo and redo layout changes

### Requirement: Undo and redo visibly move the rendered grid
Undo and redo MUST change the rendered position and size of the affected panels, through the keyboard shortcuts and
through the edit-mode undo and redo buttons alike, whether or not the layout has been auto-saved yet.

#### Scenario: Undo immediately after a drag
- **WHEN** the user drags a panel and then undoes before any auto-save has occurred
- **THEN** the panel's rendered position returns to its position before the drag

#### Scenario: Redo reapplies the undone interaction
- **WHEN** the user undoes a drag and then redoes it
- **THEN** the panel's rendered position returns to where the user dropped it

#### Scenario: Undo after a resize
- **WHEN** the user resizes a panel and then undoes
- **THEN** the panel's rendered size returns to its size before the resize

## ADDED Requirements

### Requirement: The frontend maintains a per-dashboard layout history stack
The frontend MUST maintain a bounded, in-memory layout history stack per dashboard for the duration of the session.

#### Scenario: A layout change is committed to history
- **WHEN** the user completes a panel drag or resize interaction
- **THEN** the previous layout is pushed onto the undo stack for the active dashboard
- **AND** the redo stack for that dashboard is cleared

#### Scenario: History stack is bounded to 50 entries
- **WHEN** the undo stack for a dashboard exceeds 50 entries
- **THEN** the oldest entry is discarded to keep the stack at 50

#### Scenario: History is per-dashboard
- **WHEN** a different dashboard is selected
- **THEN** undo and redo operate on that dashboard's own history stack
- **AND** the previously active dashboard's stack is preserved for the session

#### Scenario: History does not persist across page reloads
- **WHEN** the user reloads the page
- **THEN** all layout history stacks are empty

### Requirement: Users can undo and redo layout changes via keyboard
The frontend MUST respond to `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` to undo and redo layout changes respectively.

#### Scenario: User undoes a layout change with keyboard
- **WHEN** the user presses `Cmd+Z` (macOS) or `Ctrl+Z` (other platforms) while on the dashboard view
- **THEN** the active dashboard layout reverts to the previous committed state
- **AND** the reverted state is moved onto the redo stack

#### Scenario: User redoes a layout change with keyboard
- **WHEN** the user presses `Cmd+Shift+Z` (macOS) or `Ctrl+Shift+Z` (other platforms) while on the dashboard view
- **THEN** the active dashboard layout advances to the next state in the redo stack
- **AND** the restored state is moved off the redo stack

#### Scenario: Keyboard shortcuts are suppressed inside editable elements
- **WHEN** focus is inside an input, textarea, or contenteditable element
- **THEN** `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z` do not trigger layout undo/redo
- **AND** default browser undo behavior is preserved for text editing

#### Scenario: Undo is unavailable when history is empty
- **WHEN** the undo stack for the active dashboard is empty
- **THEN** pressing `Cmd/Ctrl+Z` has no effect on the layout

#### Scenario: Redo is unavailable when redo stack is empty
- **WHEN** the redo stack for the active dashboard is empty
- **THEN** pressing `Cmd/Ctrl+Shift+Z` has no effect on the layout

### Requirement: Users can undo and redo layout changes via toolbar buttons
The dashboard toolbar MUST expose undo and redo buttons that reflect the availability of history.

#### Scenario: Undo button triggers undo
- **WHEN** the user clicks the undo button
- **THEN** the active dashboard layout reverts to the previous committed state

#### Scenario: Redo button triggers redo
- **WHEN** the user clicks the redo button
- **THEN** the active dashboard layout advances to the next redo state

#### Scenario: Undo button is disabled when no history is available
- **WHEN** the undo stack for the active dashboard is empty
- **THEN** the undo button is rendered in a disabled state and cannot be activated

#### Scenario: Redo button is disabled when no redo history is available
- **WHEN** the redo stack for the active dashboard is empty
- **THEN** the redo button is rendered in a disabled state and cannot be activated

### Requirement: Undo and redo do not affect panel appearance changes
Layout history MUST only track drag and resize interactions; appearance edits MUST NOT be captured in the history stack.

#### Scenario: Appearance change does not pollute layout history
- **WHEN** the user changes a panel's appearance (color, title, etc.)
- **THEN** the layout undo stack is not modified
- **AND** pressing `Cmd/Ctrl+Z` does not revert the appearance change

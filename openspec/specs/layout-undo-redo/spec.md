## Purpose
Defines the frontend's per-dashboard layout undo/redo system: the bounded in-memory history stack, keyboard shortcuts, toolbar controls, and the exclusion of appearance edits from layout history.

## Requirements

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

### Requirement: Undo and redo visibly move the rendered grid
Undo and redo MUST change the rendered position and size of the affected panels, through the keyboard shortcuts and
through the CommandBar buttons alike, whether or not the layout has been auto-saved yet.

#### Scenario: Undo immediately after a drag
- **WHEN** the user drags a panel and then undoes before any auto-save has occurred
- **THEN** the panel's rendered position returns to its position before the drag

#### Scenario: Redo reapplies the undone interaction
- **WHEN** the user undoes a drag and then redoes it
- **THEN** the panel's rendered position returns to where the user dropped it

#### Scenario: Undo after a resize
- **WHEN** the user resizes a panel and then undoes
- **THEN** the panel's rendered size returns to its size before the resize

### Requirement: A completed interaction remains auto-saved
Committing the live layout into the store at interaction stop MUST NOT prevent the drag or resize from being persisted
by the existing auto-save, Save-now, or unmount flush.

#### Scenario: Drag then Save now
- **WHEN** the user drags a panel and flushes the layout
- **THEN** exactly one layout PATCH containing the dragged layout is sent

### Requirement: Undo and redo never lose or stale-persist a layout
A layout that differs from the last server-acknowledged layout MUST be flushed by auto-save, and one equal to it MUST NOT.

#### Scenario: Drag, undo, redo, flush
- **WHEN** the user drags, undoes, redoes and then flushes the layout
- **THEN** exactly one layout PATCH containing the dragged layout is sent

#### Scenario: Drag, undo, flush
- **WHEN** the user drags, undoes and then flushes before any auto-save
- **THEN** no layout PATCH is sent and the save indicator is not pending

### Requirement: Non-interaction layout changes are not persisted as user edits
A layout change that is neither a drag/resize commit nor an undo/redo (panel create, panel delete, refetch, default
placement) MUST NOT send a layout PATCH or mark the layout pending.

#### Scenario: Panel created
- **WHEN** a panel is created and the store layout gains its default placement
- **THEN** no layout PATCH is sent and the layout is not pending

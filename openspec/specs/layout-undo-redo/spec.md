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
A layout that differs from the last server-acknowledged layout MUST be flushed by auto-save, and one equal to it MUST
NOT. A layout PATCH response MUST NOT replace a local layout that changed after that PATCH was sent; the newer local
layout MUST remain displayed and pending, and the next flush MUST persist it.

#### Scenario: Drag, undo, redo, flush
- **WHEN** the user drags, undoes, redoes and then flushes the layout
- **THEN** exactly one layout PATCH containing the dragged layout is sent

#### Scenario: Drag, undo, flush
- **WHEN** the user drags, undoes and then flushes before any auto-save
- **THEN** no layout PATCH is sent and the save indicator is not pending

#### Scenario: A newer edit made while a PATCH is in flight survives its response
- **WHEN** a layout PATCH is in flight and the user drags (or undoes) to a different layout before its response
  arrives
- **THEN** after the response the grid still shows the newer layout and the layout is still pending
- **AND** the next flush sends a layout PATCH containing the newer layout

#### Scenario: A response that already matches the newer local layout clears pending
- **WHEN** a layout PATCH is in flight, a newer local change lands, and the response's layout equals that newer
  local layout
- **THEN** the layout is not pending, the save indicator is clean, and the next flush sends no layout PATCH
- **AND** a later real edit marks the layout pending again

#### Scenario: A response with no newer local edit is adopted
- **WHEN** a layout PATCH response arrives and the local layout has not changed since it was sent
- **THEN** the store adopts the server's layout and the layout is not pending

### Requirement: Non-interaction layout changes are not persisted as user edits
A layout change that is neither a drag/resize commit nor an undo/redo (panel create, panel delete, refetch, default
placement) MUST NOT send a layout PATCH or mark the layout pending by itself. A panel create that only adds the new
panel's placements MUST NOT discard a pending local edit: the pending drag, resize, undo or redo MUST stay pending and
be persisted by the next flush together with the new placements.

#### Scenario: Panel created
- **WHEN** a panel is created with no pending layout edit and the store layout gains its default placement
- **THEN** no layout PATCH is sent and the layout is not pending

#### Scenario: Drag then panel create before the flush
- **WHEN** the user drags a panel and then creates a panel before any flush
- **THEN** the dragged position stays visible and the layout stays pending
- **AND** the next flush sends exactly one layout PATCH containing the dragged position and the new panel's placement

### Requirement: Toolbar and keyboard undo/redo share one behaviour
The undo and redo toolbar buttons and the `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` shortcuts MUST perform the same
operation through one shared entry point, so the two paths cannot diverge in what they restore, record in history,
or mark as pending.

#### Scenario: Button and shortcut produce the same result
- **WHEN** the user drags a panel and undoes via the toolbar button, and separately repeats the same drag and undoes
  via `Cmd/Ctrl+Z`
- **THEN** both paths restore the same layout, leave the same undo/redo stacks, and leave the same pending state

#### Scenario: Undo with no history is a no-op on both paths
- **WHEN** the undo stack is empty and the user activates undo by either path
- **THEN** the layout, the history stacks, and the pending state are unchanged

### Requirement: An undo or redo is persisted by the deferred layout flush
An effective undo or redo MUST be treated as a local layout edit and persisted by the same deferred flush as a
completed drag or resize: the auto-save interval, Save now, or the desktop grid's unmount flush. An undo or redo MUST
NOT send a layout PATCH by itself. The undo/redo store write MUST be recognised as a traversal from the history
operation that produced it, so a traversal that changed nothing cannot cause a later, unrelated layout change to be
mistaken for one.

#### Scenario: Undo marks the layout pending without an immediate PATCH
- **WHEN** the user drags a panel, Save now persists it, and the user then undoes
- **THEN** the layout is pending and no further layout PATCH has been sent since the undo
- **AND** the next flush sends exactly one layout PATCH containing the undone layout

#### Scenario: A traversal that changed nothing does not misclassify the next change
- **WHEN** an undo's target is the very same layout as the current one (a zero-move drag's history entry), so the
  store layout does not change, and a server layout then arrives in the store
- **THEN** the server layout becomes the saved baseline and no layout PATCH is sent

## ADDED Requirements

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

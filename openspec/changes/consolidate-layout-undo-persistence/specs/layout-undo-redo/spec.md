## ADDED Requirements

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

## MODIFIED Requirements

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

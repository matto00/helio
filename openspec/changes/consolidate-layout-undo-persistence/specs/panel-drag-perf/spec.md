## MODIFIED Requirements

### Requirement: Layout persistence is unchanged during drag
The deferred layout-persistence write to the backend SHALL continue to fire after drag ends: the completed drag is
staged when it stops and persisted by the next auto-save tick (every 30 seconds), Save now, or the desktop grid's
unmount flush. The drag-freeze optimization SHALL NOT suppress the `onLayoutChange` callback or that flush.

#### Scenario: Layout saved after drag
- **WHEN** a user drags a panel to a new position, releases, and the layout is then flushed
- **THEN** exactly one layout PATCH carrying the new position is sent to the backend

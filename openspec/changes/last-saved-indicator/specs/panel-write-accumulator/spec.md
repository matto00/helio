## MODIFIED Requirements

### Requirement: Accumulated panel changes are flushed via batch endpoint on a 30-second interval
The frontend MUST flush the `pendingPanelUpdates` map to `POST /api/panels/updateBatch`
on a 30-second `setInterval` whenever the map is non-empty, using the existing `updatePanelsBatch` thunk.
The timer MUST reset to 30 seconds after any manual "Save now" flush.

#### Scenario: Pending updates are sent after 30-second interval
- **GIVEN** one or more panel field changes have been accumulated
- **WHEN** 30 seconds elapses since the last flush (auto or manual)
- **THEN** the frontend dispatches `updatePanelsBatch` with all pending changes
- **AND** `pendingPanelUpdates` is cleared after a successful response

#### Scenario: Accumulating changes does not reset the auto-save timer
- **GIVEN** the 30-second interval is running
- **WHEN** another panel change is accumulated
- **THEN** the interval continues on its current schedule (changes do not extend the timer)

#### Scenario: Failed flush retains pending updates for retry
- **GIVEN** `updatePanelsBatch` rejects (network error or server error)
- **WHEN** the rejection is handled
- **THEN** `pendingPanelUpdates` is NOT cleared
- **AND** the next interval tick retries the flush with the same pending data

#### Scenario: Pending updates are discarded on dashboard navigation
- **GIVEN** there are pending panel updates in Redux
- **WHEN** the PanelGrid component unmounts (user navigates away)
- **THEN** the interval timer is cancelled
- **AND** any un-flushed updates are discarded (no flush on unmount)

### Requirement: lastSavedAt timestamp is tracked in panelsSlice
The frontend MUST store a `lastSavedAt: number | null` field in `panelsSlice` state
that is set to `Date.now()` whenever `updatePanelsBatch` fulfills successfully.

#### Scenario: lastSavedAt is updated on successful flush
- **WHEN** `updatePanelsBatch` fulfills
- **THEN** `state.lastSavedAt` is set to the current Unix timestamp in milliseconds

#### Scenario: lastSavedAt starts as null
- **WHEN** the application initializes
- **THEN** `state.lastSavedAt` is `null`

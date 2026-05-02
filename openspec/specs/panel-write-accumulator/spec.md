# panel-write-accumulator Specification

## Purpose
TBD - created by archiving change batch-panel-flush. Update Purpose after archive.
## Requirements
### Requirement: Panel field changes accumulate in Redux before flushing
The frontend MUST accumulate panel title and appearance changes in a
`pendingPanelUpdates` map in Redux state rather than dispatching individual
`PATCH /api/panels/:id` calls immediately on each interaction.

#### Scenario: Title change is accumulated
- **WHEN** the user commits a panel title edit (Enter or blur)
- **THEN** the new title is merged into `pendingPanelUpdates[panelId]` in Redux
- **AND** the panel's displayed title updates immediately (optimistic)
- **AND** no `PATCH /api/panels/:id` call is issued at that moment

#### Scenario: Appearance change is accumulated
- **WHEN** the user saves panel appearance settings in PanelDetailModal
- **THEN** the updated appearance is merged into `pendingPanelUpdates[panelId]`
- **AND** the panel's displayed appearance updates immediately (optimistic)
- **AND** no `PATCH /api/panels/:id` call is issued at that moment

#### Scenario: Multiple field changes for the same panel are merged
- **WHEN** the user changes a panel's title and then its appearance before the debounce fires
- **THEN** both changes are present in `pendingPanelUpdates[panelId]` as a merged object
- **AND** the flush sends a single batch entry for that panel containing both field updates

### Requirement: Accumulated panel changes are flushed via batch endpoint on a debounce
The frontend MUST flush the `pendingPanelUpdates` map to `POST /api/panels/updateBatch`
on a 250 ms debounce whenever the map is non-empty, using the existing `updatePanelsBatch` thunk.

#### Scenario: Pending updates are sent after debounce interval
- **GIVEN** one or more panel field changes have been accumulated
- **WHEN** 250 ms elapses with no further accumulation
- **THEN** the frontend dispatches `updatePanelsBatch` with all pending changes
- **AND** `pendingPanelUpdates` is cleared after a successful response

#### Scenario: Each accumulation resets the debounce timer
- **GIVEN** a panel change was accumulated less than 250 ms ago
- **WHEN** another panel change is accumulated
- **THEN** the 250 ms timer is reset and no flush has occurred yet

#### Scenario: Failed flush retains pending updates for retry
- **GIVEN** `updatePanelsBatch` rejects (network error or server error)
- **WHEN** the rejection is handled
- **THEN** `pendingPanelUpdates` is NOT cleared
- **AND** the next debounce tick retries the flush with the same pending data

#### Scenario: Pending updates are discarded on dashboard navigation
- **GIVEN** there are pending panel updates in Redux
- **WHEN** the PanelGrid component unmounts (user navigates away)
- **THEN** the debounce timer is cancelled
- **AND** any un-flushed updates are discarded (no flush on unmount)

### Requirement: The batch flush payload covers all accumulated field types
The `updatePanelsBatch` request MUST include all field types present across all pending panels
in a single call, using the `fields` envelope from the `UpdatePanelsBatchRequest` type.

#### Scenario: Fields list is derived from accumulated changes
- **GIVEN** pending updates include title changes for some panels and appearance changes for others
- **WHEN** the flush fires
- **THEN** the request `fields` array contains `["title", "appearance"]`
- **AND** each panel entry in the `panels` array carries only the fields that were changed for it


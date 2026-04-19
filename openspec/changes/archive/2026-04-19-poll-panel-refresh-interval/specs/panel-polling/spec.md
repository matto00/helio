## ADDED Requirements

### Requirement: Panel data is re-fetched on the configured refresh interval
When a panel has a numeric `refreshInterval` and a bound `typeId`, the frontend SHALL automatically re-fetch the panel's source data at that interval (in seconds) after the initial data load completes.

#### Scenario: Panel with refreshInterval re-fetches at the configured cadence
- **WHEN** a panel with `refreshInterval=30` and a bound `typeId` is mounted
- **THEN** after the initial data load, the data is re-fetched approximately every 30 seconds

#### Scenario: No polling when refreshInterval is null
- **WHEN** a panel has `refreshInterval` set to null
- **THEN** no interval is set up and data is only loaded once on mount

#### Scenario: No polling when typeId is unset
- **WHEN** a panel has no `typeId` binding
- **THEN** no interval is set up regardless of the `refreshInterval` value

### Requirement: Polling stops cleanly when the panel unmounts
The interval SHALL be cleared when the panel component unmounts, preventing memory leaks and stale state updates.

#### Scenario: Interval is cleared on unmount
- **WHEN** a panel with active polling is removed from the grid
- **THEN** no further data fetches are triggered for that panel

### Requirement: Polling stops when the panel binding is removed
If a panel's `typeId` is set to null (binding removed), any active polling interval SHALL be cleared.

#### Scenario: Removing typeId stops polling
- **WHEN** a panel's `typeId` is patched to null while polling is active
- **THEN** polling stops immediately and no further fetches occur

### Requirement: Polling pauses when the browser tab is hidden
The frontend SHALL pause the polling interval while `document.visibilityState === "hidden"` and resume when the tab becomes visible again, preventing stacked intervals on background tabs.

#### Scenario: Polling pauses on tab-hidden
- **WHEN** the browser tab containing the dashboard is hidden
- **THEN** the polling interval is cleared and no new fetches are triggered while hidden

#### Scenario: Polling resumes on tab-visible without stacking intervals
- **WHEN** the user returns to the dashboard tab after it was hidden
- **THEN** polling resumes with a single interval (no duplicate intervals are created)

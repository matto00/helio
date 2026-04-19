## MODIFIED Requirements

### Requirement: Refresh interval is configurable
The Data tab SHALL include a refresh interval selector with options: Manual, 30s, 1m, 5m, 15m, 1h. The selected value SHALL be stored in seconds (null for Manual). When set, the frontend SHALL use the stored value to drive automatic polling of the panel's source data.

#### Scenario: Default refresh interval is Manual
- **WHEN** the Data tab is opened for a panel with no binding
- **THEN** the refresh interval selector shows "Manual"

#### Scenario: Selecting an interval updates the stored value
- **WHEN** the user selects "5m" from the interval selector
- **THEN** saving persists refreshInterval = 300 to the panel

#### Scenario: A saved refresh interval drives automatic polling
- **WHEN** a panel with refreshInterval = 30 is displayed in the grid
- **THEN** the panel's source data is automatically re-fetched every 30 seconds

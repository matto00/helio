## MODIFIED Requirements

### Requirement: Most-recent dashboard default selection
The system SHALL auto-select the first dashboard in the response (which the backend guarantees is the most recently updated) when dashboard data loads and no prior selection exists.

#### Scenario: Newest dashboard is selected by default
- **WHEN** dashboard data is loaded into frontend state
- **THEN** the selected dashboard is the first item in the response (most recently updated per backend sort contract)

#### Scenario: Existing selection is preserved when still valid
- **WHEN** dashboard data refreshes and the current selected dashboard still exists
- **THEN** the frontend preserves the current selection instead of overriding it

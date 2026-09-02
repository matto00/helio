# frontend-panel-creation Specification

## Purpose
Defines the frontend contract for creating panels via the backend API, including payload structure,
panel list refresh behavior, and inline feedback within the creation modal.

## Requirements

### Requirement: Panel list refreshes after a successful placement or content-panel create
Placing an Output via the picker, or creating a content panel, SHALL refresh the dashboard's panel list so the new panel appears without a manual refresh — the same outcome `frontend-panel-creation` always guaranteed, now triggered by the picker's placement call instead of the retired wizard's create call.

#### Scenario: Panel create succeeds
- **WHEN** the user places an Output via the picker, or creates a content panel
- **THEN** the request succeeds
- **AND** the dashboard's panel list includes the new panel without requiring a manual refresh

### Requirement: Placement and content-panel creation expose simple explicit feedback
Placing an Output or creating a content panel SHALL surface simple, explicit success/error feedback — the same feedback contract `frontend-panel-creation` always guaranteed, now covering the picker's placement call and content-panel creation instead of the retired wizard's multi-step create flow.

#### Scenario: Panel create fails
- **WHEN** `POST /api/panels` fails while placing an Output or creating a content panel
- **THEN** the picker (or dashboard) shows an explicit, human-readable error rather than failing silently

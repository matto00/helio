## MODIFIED Requirements

### Requirement: Duplicate action in dashboard actions menu
The system SHALL enable the "Duplicate" action in the dashboard actions menu. Activating it SHALL call the duplicate endpoint, add the new dashboard to the sidebar, and immediately select it. The action SHALL be guarded against re-entry: while a duplicate request for a given dashboard is in flight, further activations of that dashboard's "Duplicate" action SHALL be ignored, and the guard SHALL clear when the request settles (success or failure), re-enabling the action.

#### Scenario: Duplicate menu item is enabled
- **WHEN** a dashboard exists in the sidebar
- **THEN** its actions menu SHALL show "Duplicate" as an enabled item

#### Scenario: Duplication navigates to the new dashboard
- **WHEN** the user activates "Duplicate" on a dashboard
- **THEN** the system calls `POST /api/dashboards/:id/duplicate`
- **AND** the new dashboard appears in the sidebar
- **AND** the new dashboard is immediately selected and its panels are displayed

#### Scenario: Original dashboard is unaffected after duplication
- **WHEN** the user duplicates a dashboard
- **THEN** the original dashboard remains in the sidebar with its original name and panels intact

#### Scenario: Double-activation while a duplicate request is in flight produces exactly one clone
- **WHEN** the user activates "Duplicate" on a dashboard twice in rapid succession (including two synchronous activations in the same event-loop tick) before the first request settles
- **THEN** the system calls `POST /api/dashboards/:id/duplicate` exactly once
- **AND** exactly one new dashboard is created

#### Scenario: Duplicate action re-enables after the request settles
- **WHEN** a duplicate request for a dashboard completes, whether successfully or with an error
- **THEN** the "Duplicate" action for that dashboard is enabled again and a subsequent activation issues a new request

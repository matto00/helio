## ADDED Requirements

### Requirement: Dashboard can be deleted via DELETE endpoint
The backend SHALL expose `DELETE /api/dashboards/:id` which removes the dashboard and all its associated panels.

#### Scenario: Successful dashboard delete
- **WHEN** `DELETE /api/dashboards/:id` is called with a valid dashboard ID
- **THEN** the response is 204 No Content and the dashboard no longer exists in the database

#### Scenario: Dashboard delete cascades to panels
- **WHEN** a dashboard with panels is deleted
- **THEN** all panels belonging to that dashboard are also removed from the database

#### Scenario: Delete non-existent dashboard returns 404
- **WHEN** `DELETE /api/dashboards/:id` is called with an ID that does not exist
- **THEN** the response is 404 Not Found

### Requirement: Frontend provides a delete control per dashboard
The dashboard list SHALL include a delete action for each dashboard item, protected by an inline confirmation step.

#### Scenario: Delete requires confirmation
- **WHEN** the user clicks the delete button on a dashboard
- **THEN** a confirmation step is shown before the delete is dispatched

#### Scenario: Dashboard removed from UI on success
- **WHEN** a dashboard is successfully deleted
- **THEN** it is removed from the Redux state and disappears from the sidebar immediately

#### Scenario: Selected dashboard deleted clears selection
- **WHEN** the currently selected dashboard is deleted
- **THEN** the selected dashboard ID is cleared and the panel grid shows an empty state

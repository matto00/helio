## ADDED Requirements

### Requirement: Panel can be deleted via DELETE endpoint
The backend SHALL expose `DELETE /api/panels/:id` which removes the panel from the database.

#### Scenario: Successful panel delete
- **WHEN** `DELETE /api/panels/:id` is called with a valid panel ID
- **THEN** the response is 204 No Content and the panel no longer exists in the database

#### Scenario: Delete non-existent panel returns 404
- **WHEN** `DELETE /api/panels/:id` is called with an ID that does not exist
- **THEN** the response is 404 Not Found

### Requirement: Frontend provides a delete control per panel
Each panel card in the grid SHALL include a delete action protected by an inline confirmation step.

#### Scenario: Panel delete requires confirmation
- **WHEN** the user clicks the delete button on a panel
- **THEN** a confirmation step is shown before the delete is dispatched

#### Scenario: Panel removed from UI on success
- **WHEN** a panel is successfully deleted
- **THEN** it is removed from the Redux state and disappears from the grid immediately

### Requirement: Dashboard layout is updated when a panel is deleted
The owning dashboard's layout SHALL have the deleted panel's entries removed across all breakpoints.

#### Scenario: Layout pruned after panel delete
- **WHEN** a panel is deleted
- **THEN** its ID is removed from the dashboard layout for all breakpoints (lg, md, sm, xs)

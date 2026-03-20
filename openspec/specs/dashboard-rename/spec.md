## ADDED Requirements

### Requirement: Dashboard name can be updated via PATCH endpoint
The backend SHALL accept an optional `name` field on `PATCH /api/dashboards/:id` and persist the new name.

#### Scenario: Successful rename
- **WHEN** `PATCH /api/dashboards/:id` is called with a non-empty `name` field
- **THEN** the response is 200 with the updated dashboard and the name is persisted in the database

#### Scenario: Empty name is rejected
- **WHEN** `PATCH /api/dashboards/:id` is called with a `name` that is empty or whitespace-only
- **THEN** the response is 400 Bad Request

#### Scenario: Rename of non-existent dashboard returns 404
- **WHEN** `PATCH /api/dashboards/:id` is called with a valid name but the dashboard does not exist
- **THEN** the response is 404 Not Found

### Requirement: Frontend provides inline rename for dashboard list items
The dashboard list SHALL allow the user to rename a dashboard inline by clicking its name.

#### Scenario: Click activates edit mode
- **WHEN** the user clicks on a dashboard name in the sidebar
- **THEN** the name becomes an editable input field pre-filled with the current name

#### Scenario: Enter confirms rename
- **WHEN** the user presses Enter while editing a dashboard name
- **THEN** the rename is submitted and the sidebar reflects the new name on success

#### Scenario: Blur confirms rename
- **WHEN** the user clicks away from the input while editing a dashboard name
- **THEN** the rename is submitted (equivalent to pressing Enter)

#### Scenario: Escape cancels rename
- **WHEN** the user presses Escape while editing a dashboard name
- **THEN** the input is dismissed without saving and the original name is restored

#### Scenario: Empty name is not submitted
- **WHEN** the user clears the name input and confirms
- **THEN** an inline error is shown and no API call is made

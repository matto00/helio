## ADDED Requirements

### Requirement: Panel title can be updated via PATCH endpoint
The backend SHALL accept an optional `title` field on `PATCH /api/panels/:id` and persist the new title.

#### Scenario: Successful title update
- **WHEN** `PATCH /api/panels/:id` is called with a non-empty `title` field
- **THEN** the response is 200 with the updated panel and the title is persisted in the database

#### Scenario: Empty title is rejected
- **WHEN** `PATCH /api/panels/:id` is called with a `title` that is empty or whitespace-only
- **THEN** the response is 400 Bad Request

#### Scenario: Title update for non-existent panel returns 404
- **WHEN** `PATCH /api/panels/:id` is called with a valid title but the panel does not exist
- **THEN** the response is 404 Not Found

### Requirement: Frontend provides inline title editing on panel cards
Each panel card SHALL allow the user to edit the panel title inline via the panel's action controls.

#### Scenario: Edit activates title input
- **WHEN** the user initiates a title edit on a panel card
- **THEN** the panel title becomes an editable input field pre-filled with the current title

#### Scenario: Enter confirms title edit
- **WHEN** the user presses Enter while editing a panel title
- **THEN** the updated title is submitted and the panel card reflects the new title on success

#### Scenario: Blur confirms title edit
- **WHEN** the user clicks away from the title input
- **THEN** the updated title is submitted (equivalent to pressing Enter)

#### Scenario: Escape cancels title edit
- **WHEN** the user presses Escape while editing a panel title
- **THEN** the input is dismissed without saving and the original title is restored

#### Scenario: Empty title is not submitted
- **WHEN** the user clears the title input and confirms
- **THEN** an inline error is shown and no API call is made

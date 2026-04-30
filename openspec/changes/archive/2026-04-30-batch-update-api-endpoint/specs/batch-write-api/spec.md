## ADDED Requirements

### Requirement: A batch write endpoint exists on the dashboard resource
The backend MUST expose `POST /api/dashboards/:id/batch` that accepts an array of typed, versioned
operation objects and applies all of them within a single database transaction.

#### Scenario: Batch endpoint accepts a valid multi-operation payload
- **WHEN** a client sends `POST /api/dashboards/:id/batch` with a JSON body `{ "ops": [...] }`
- **THEN** the server responds with `200 OK` and a body containing `{ "dashboard": ..., "panels": [...] }`

#### Scenario: Batch endpoint rejects an empty operations array
- **WHEN** a client sends `POST /api/dashboards/:id/batch` with `{ "ops": [] }`
- **THEN** the server responds with `400 Bad Request`

#### Scenario: Batch endpoint requires authentication
- **WHEN** an unauthenticated client sends `POST /api/dashboards/:id/batch`
- **THEN** the server responds with `401 Unauthorized`

#### Scenario: Batch endpoint enforces ownership
- **WHEN** an authenticated client sends `POST /api/dashboards/:id/batch` for a dashboard they do not own
- **THEN** the server responds with `403 Forbidden`

### Requirement: Batch operations are applied transactionally
All operations in a batch request MUST be applied within a single database transaction.
If any operation fails, the entire batch MUST be rolled back and no changes persisted.

#### Scenario: All operations succeed — changes are committed
- **GIVEN** a batch request with multiple valid operations
- **WHEN** the server processes the batch
- **THEN** all operations are applied atomically and `200 OK` is returned

#### Scenario: One operation fails — no changes are committed
- **GIVEN** a batch request where one operation references a panel that does not belong to the dashboard
- **WHEN** the server processes the batch
- **THEN** no changes from any operation in the batch are persisted
- **AND** the server responds with `400 Bad Request` or `422 Unprocessable Entity`

### Requirement: Batch operation schema is versioned
Each operation object MUST carry an `"op"` discriminator string and a `"v"` integer version field
to support future schema evolution without breaking existing clients.

#### Scenario: Operation object carries op and version fields
- **WHEN** a client sends a batch request
- **THEN** each operation object in the `ops` array includes `"op"` and `"v"` fields

#### Scenario: Unknown op value is rejected
- **WHEN** a client sends a batch request containing an operation with an unrecognized `"op"` value
- **THEN** the server responds with `400 Bad Request` describing the unknown operation type

### Requirement: Batch endpoint supports panel layout update operations
The batch endpoint MUST accept `panelLayout` operations that update the full 4-breakpoint layout for
a dashboard.

#### Scenario: Panel layout operation updates the dashboard layout
- **GIVEN** a batch request containing a `panelLayout` operation with a valid 4-breakpoint layout
- **WHEN** the server processes the batch
- **THEN** the dashboard's stored layout is updated to the supplied layout
- **AND** the response `dashboard.layout` reflects the new layout

### Requirement: Batch endpoint supports panel appearance update operations
The batch endpoint MUST accept `panelAppearance` operations that update the appearance of a single panel.

#### Scenario: Panel appearance operation updates the target panel
- **GIVEN** a batch request containing a `panelAppearance` operation with a valid panel id and appearance
- **WHEN** the server processes the batch
- **THEN** the target panel's stored appearance is updated
- **AND** the response `panels` array reflects the updated appearance

### Requirement: Batch endpoint supports dashboard appearance update operations
The batch endpoint MUST accept `dashboardAppearance` operations that update the dashboard appearance.

#### Scenario: Dashboard appearance operation updates the dashboard
- **GIVEN** a batch request containing a `dashboardAppearance` operation with a valid appearance payload
- **WHEN** the server processes the batch
- **THEN** the dashboard's stored appearance is updated
- **AND** the response `dashboard.appearance` reflects the new appearance

### Requirement: Batch endpoint supports user preference operations
The batch endpoint MUST accept `userPreference` operations in its schema for forward compatibility.
The backend MAY acknowledge the operation without persisting it until a backing store is available.

#### Scenario: User preference operation is accepted without error
- **GIVEN** a batch request containing a `userPreference` operation with a valid zoom level
- **WHEN** the server processes the batch
- **THEN** the server responds with `200 OK` (the operation is acknowledged but may not be persisted yet)

### Requirement: Batch response includes the current panel list
The batch endpoint response MUST include the full list of panels for the target dashboard so clients
can update local state without a follow-up GET request.

#### Scenario: Response panels match current dashboard panels
- **WHEN** a successful batch request is processed for dashboard D
- **THEN** the response body contains a `panels` array listing all panels belonging to D
- **AND** any panels whose appearance was modified by the batch reflect the updated appearance

## ADDED Requirements

### Requirement: POST /api/panels/:id/execute submits the panel query to Spark and returns rows
The backend SHALL expose `POST /api/panels/:id/execute` that derives the panel's `PanelQuery`,
loads the bound DataSource into Spark via `PanelQueryExecutor`, applies field selection, and returns
a JSON response with a `rows` array. The endpoint SHALL require authentication.

#### Scenario: Bound panel with static data source returns rows
- **WHEN** `POST /api/panels/:id/execute` is called for a panel with a non-null `typeId` bound to a
  static DataSource
- **THEN** the response is `200 OK` with body `{ "rows": [ {...}, ... ] }` where each object contains
  the selected fields

#### Scenario: Bound panel with CSV data source returns rows
- **WHEN** `POST /api/panels/:id/execute` is called for a panel with a non-null `typeId` bound to a
  CSV DataSource
- **THEN** the response is `200 OK` with body `{ "rows": [ {...}, ... ] }`

#### Scenario: Unbound panel returns 404
- **WHEN** `POST /api/panels/:id/execute` is called for a panel with `typeId: null`
- **THEN** the response is `404 Not Found`

#### Scenario: Non-existent panel returns 404
- **WHEN** `POST /api/panels/:id/execute` is called with a panel ID that does not exist
- **THEN** the response is `404 Not Found`

#### Scenario: Unsupported source type returns 422
- **WHEN** `POST /api/panels/:id/execute` is called for a panel bound to a DataSource with
  `sourceType` of `rest_api` or `sql`
- **THEN** the response is `422 Unprocessable Entity` with a descriptive error message

### Requirement: PanelQueryExecutor applies selectedFields as column projection
`PanelQueryExecutor` SHALL select only the columns listed in `PanelQuery.selectedFields` from the
loaded DataFrame. If `selectedFields` is empty, all columns SHALL be returned.

#### Scenario: selectedFields non-empty projects columns
- **WHEN** `PanelQuery.selectedFields = ["price", "name"]` and the DataFrame has columns
  `["price", "name", "qty"]`
- **THEN** the returned rows contain only `price` and `name` keys

#### Scenario: selectedFields empty returns all columns
- **WHEN** `PanelQuery.selectedFields` is empty
- **THEN** the returned rows contain all columns from the DataFrame

### Requirement: Panel execute response is serializable to JSON
The response body SHALL be a JSON object with a single field `rows` containing an array of row
objects. Each row object is a flat key-value map where keys are column names and values are JSON
scalars (string, number, boolean, null).

#### Scenario: Response wraps rows in object
- **WHEN** the executor returns two rows `[{"price": 10}, {"price": 20}]`
- **THEN** the HTTP response body is `{ "rows": [{"price": 10}, {"price": 20}] }`

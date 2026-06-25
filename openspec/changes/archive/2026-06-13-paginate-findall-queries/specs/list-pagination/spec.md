## ADDED Requirements

### Requirement: Page value type exists in the domain package
The backend SHALL define `final case class Page(offset: Int, limit: Int)` in the
`com.helio.domain` package. `offset` SHALL be non-negative and `limit` SHALL be a
positive integer bounded at 500 (server-enforced maximum).

#### Scenario: Page with default values is constructed
- **WHEN** `Page(offset = 0, limit = 200)` is constructed
- **THEN** `page.offset == 0` and `page.limit == 200`

#### Scenario: Limit exceeding server maximum is clamped
- **WHEN** a route handler receives `limit=9999` as a query parameter
- **THEN** the effective `Page.limit` used for the query is clamped to 500

### Requirement: PagedResult envelope type exists in the domain package
The backend SHALL define `final case class PagedResult[A](items: Vector[A], total: Int, offset: Int, limit: Int)`
in the `com.helio.domain` package.

#### Scenario: PagedResult wraps a list with metadata
- **WHEN** a list query returns 5 items out of 20 total with offset=0, limit=5
- **THEN** the `PagedResult` has `items.size == 5`, `total == 20`, `offset == 0`, `limit == 5`

### Requirement: List endpoints accept optional offset and limit query parameters
All four list route handlers SHALL accept optional offset and limit query parameters
(e.g. `?offset=0&limit=200`). When absent, offset SHALL default to 0 and limit SHALL
default to 200.

#### Scenario: Request with no pagination params uses defaults
- **WHEN** `GET /api/dashboards` is called with no query parameters
- **THEN** the response contains up to 200 items starting from offset 0

#### Scenario: Request with explicit offset and limit is honoured
- **WHEN** `GET /api/types?offset=10&limit=5` is called
- **THEN** the response items start at the 11th data type and contain at most 5 items

#### Scenario: Negative offset is rejected with 400
- **WHEN** `GET /api/dashboards?offset=-1` is called
- **THEN** the response is 400 Bad Request

### Requirement: List endpoint responses include pagination metadata
All four list endpoints SHALL return a JSON object with keys `items` (array), `total` (integer),
`offset` (integer), and `limit` (integer).

#### Scenario: Response envelope contains all required fields
- **WHEN** `GET /api/dashboards` returns successfully
- **THEN** the JSON body has `items`, `total`, `offset`, and `limit` fields at the top level

#### Scenario: Total reflects full unfiltered count, not page size
- **WHEN** a user has 50 dashboards and requests `GET /api/dashboards?limit=10`
- **THEN** `total == 50` and `items.length == 10`

### Requirement: JsonProtocols provides formatters for PagedResult types
`JsonProtocols` SHALL define implicit `RootJsonFormat` instances for
`PagedResult[Dashboard]`, `PagedResult[DataType]`, `PagedResult[DataSource]`, and
`PagedResult[Panel]`.

#### Scenario: PagedResult[Dashboard] serializes to expected JSON shape
- **WHEN** a `PagedResult[Dashboard]` is serialized to JSON
- **THEN** the result contains `"items"`, `"total"`, `"offset"`, and `"limit"` keys

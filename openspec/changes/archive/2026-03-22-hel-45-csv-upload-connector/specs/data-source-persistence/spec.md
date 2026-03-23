## ADDED Requirements

### Requirement: GET /api/data-sources lists all data sources
The API SHALL expose `GET /api/data-sources` returning all registered data sources as `{"items": [...]}`.

#### Scenario: Empty list is returned when no sources exist
- **WHEN** `GET /api/data-sources` is called with no sources registered
- **THEN** the response is 200 with `{"items": []}`

#### Scenario: All sources are returned
- **WHEN** one or more data sources have been created
- **THEN** `GET /api/data-sources` returns all of them in the `items` array

## ADDED Requirements

### Requirement: Dashboard list is sorted by lastUpdated descending
The `GET /api/dashboards` endpoint SHALL return dashboards sorted by `meta.lastUpdated` in descending order (most recently updated first).

#### Scenario: Multiple dashboards returned in lastUpdated desc order
- **WHEN** the registry contains multiple dashboards with different `lastUpdated` values
- **THEN** the response items are ordered from most recently updated to least recently updated

#### Scenario: Newly created dashboard appears first
- **WHEN** a dashboard is created after existing dashboards
- **THEN** it appears first in the `GET /api/dashboards` response

#### Scenario: Updated dashboard moves to front of list
- **WHEN** a dashboard is updated (appearance or layout) and the list is re-fetched
- **THEN** the updated dashboard appears first in the response

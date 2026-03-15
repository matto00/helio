## MODIFIED Requirements

### Requirement: Dashboard list is sorted by lastUpdated descending
The `GET /api/dashboards` endpoint SHALL return dashboards sorted by `meta.lastUpdated` in descending order (most recently updated first). Sort is enforced by a SQL `ORDER BY last_updated DESC` clause in `DashboardRepository`, replacing the previous actor-level sort.

#### Scenario: Multiple dashboards returned in lastUpdated desc order
- **WHEN** the database contains multiple dashboards with different `last_updated` values
- **THEN** the response items are ordered from most recently updated to least recently updated

#### Scenario: Newly created dashboard appears first
- **WHEN** a dashboard is created after existing dashboards
- **THEN** it appears first in the `GET /api/dashboards` response

#### Scenario: Updated dashboard moves to front of list
- **WHEN** a dashboard is updated (appearance or layout) and the list is re-fetched
- **THEN** the updated dashboard appears first in the response

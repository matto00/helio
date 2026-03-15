## MODIFIED Requirements

### Requirement: Panel list is sorted by lastUpdated descending
The `GET /api/dashboards/:id/panels` endpoint SHALL return panels sorted by `meta.lastUpdated` in descending order (most recently updated first). Sort is enforced by a SQL `ORDER BY last_updated DESC` clause in `PanelRepository`, replacing the previous actor-level sort.

#### Scenario: Multiple panels returned in lastUpdated desc order
- **WHEN** a dashboard contains multiple panels with different `last_updated` values
- **THEN** the response items are ordered from most recently updated to least recently updated

#### Scenario: Newly created panel appears first
- **WHEN** a panel is created after existing panels on the same dashboard
- **THEN** it appears first in the `GET /api/dashboards/:id/panels` response

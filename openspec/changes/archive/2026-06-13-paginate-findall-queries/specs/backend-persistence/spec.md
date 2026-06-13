## MODIFIED Requirements

### Requirement: Repository layer isolates all database access
The backend SHALL route all dashboard and panel reads and writes through repository classes,
with no direct database access in route handlers or other layers. Repository `findAll` and
`findAllByDashboardId` methods SHALL accept a `Page` parameter and SHALL return
`Future[PagedResult[A]]` by composing both the count query and the slice query
(`.drop(offset).take(limit)`) into a single DBIO action executed in one `withUserContext` call.

#### Scenario: Dashboard created via repository
- **WHEN** a POST /api/dashboards request is handled
- **THEN** the new dashboard is written to PostgreSQL via DashboardRepository and the persisted record is returned

#### Scenario: Panel created via repository
- **WHEN** a POST /api/panels request is handled
- **THEN** the new panel is written to PostgreSQL via PanelRepository and the persisted record is returned

#### Scenario: DashboardRepository.findAll applies pagination
- **WHEN** `DashboardRepository.findAll(ownerId, Page(offset=5, limit=3))` is called and 10 dashboards exist for that owner
- **THEN** exactly 3 dashboards are returned, starting from the 6th most-recently-updated

#### Scenario: DashboardRepository.findAll PagedResult total reflects full count
- **WHEN** `DashboardRepository.findAll(ownerId, Page(offset=0, limit=3))` is called and 10 dashboards exist for that owner
- **THEN** the returned `PagedResult.total` is 10 and `PagedResult.items.size` is 3

#### Scenario: PanelRepository.findAllByDashboardId applies pagination
- **WHEN** `PanelRepository.findAllByDashboardId(dashId, callerOpt, Page(offset=0, limit=2))` is called and 5 panels exist
- **THEN** exactly 2 panels are returned

#### Scenario: PanelRepository.findAllByDashboardId PagedResult total reflects full count
- **WHEN** `PanelRepository.findAllByDashboardId(dashId, callerOpt, Page(offset=0, limit=2))` is called and 5 panels exist
- **THEN** the returned `PagedResult.total` is 5 and `PagedResult.items.size` is 2

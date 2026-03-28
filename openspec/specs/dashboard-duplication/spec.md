### Requirement: Duplicate dashboard endpoint
The system SHALL expose `POST /api/dashboards/:id/duplicate` that creates a new dashboard copying the source dashboard's `appearance` and `layout`, names the copy `"{original name} (copy)"`, and duplicates all panels belonging to the source dashboard with new UUIDs and `dashboardId` set to the new dashboard. All panel ID references in the copied layout SHALL be remapped to the new panel IDs. The endpoint SHALL return `201 Created` with a body containing both the new dashboard and its panels.

#### Scenario: Successful duplication
- **WHEN** a `POST /api/dashboards/:id/duplicate` request is made for an existing dashboard
- **THEN** the system creates a new dashboard named `"{original name} (copy)"` with the same `appearance` and `layout` (panel IDs remapped)
- **AND** creates new copies of all source panels with new UUIDs and the new `dashboardId`
- **AND** returns `201 Created` with `{ dashboard: DashboardResponse, panels: [PanelResponse] }`

#### Scenario: Source dashboard not found
- **WHEN** a `POST /api/dashboards/:id/duplicate` request is made for a non-existent dashboard ID
- **THEN** the system returns `404 Not Found`

#### Scenario: Original dashboard and panels are unchanged after duplication
- **WHEN** duplication succeeds
- **THEN** the source dashboard's name, appearance, layout, and all its panels are unchanged

#### Scenario: Duplicate of a dashboard with no panels
- **WHEN** a `POST /api/dashboards/:id/duplicate` request is made for a dashboard that has no panels
- **THEN** the system creates a new dashboard with the same appearance and an empty layout
- **AND** returns `201 Created` with `{ dashboard: DashboardResponse, panels: [] }`

### Requirement: Duplicate action in dashboard actions menu
The system SHALL enable the "Duplicate" action in the dashboard actions menu. Activating it SHALL call the duplicate endpoint, add the new dashboard to the sidebar, and immediately select it.

#### Scenario: Duplicate menu item is enabled
- **WHEN** a dashboard exists in the sidebar
- **THEN** its actions menu SHALL show "Duplicate" as an enabled item

#### Scenario: Duplication navigates to the new dashboard
- **WHEN** the user activates "Duplicate" on a dashboard
- **THEN** the system calls `POST /api/dashboards/:id/duplicate`
- **AND** the new dashboard appears in the sidebar
- **AND** the new dashboard is immediately selected and its panels are displayed

#### Scenario: Original dashboard is unaffected after duplication
- **WHEN** the user duplicates a dashboard
- **THEN** the original dashboard remains in the sidebar with its original name and panels intact

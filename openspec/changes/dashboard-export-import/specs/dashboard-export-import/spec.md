## ADDED Requirements

### Requirement: Export dashboard endpoint
The system SHALL expose `GET /api/dashboards/:id/export` that returns a self-contained JSON snapshot of the dashboard. The snapshot SHALL include the dashboard `name`, `appearance`, `layout` (with panel references keyed by `snapshotId`), a `panels` array with each panel's `snapshotId`, `title`, `type`, `appearance`, `typeId`, and `fieldMapping`, and a top-level `version` field. The snapshot SHALL NOT include server-assigned IDs, `createdBy`, `createdAt`, or `lastUpdated` fields.

#### Scenario: Successful export
- **WHEN** a `GET /api/dashboards/:id/export` request is made for an existing dashboard
- **THEN** the system returns `200 OK` with a JSON body containing `version`, `dashboard`, and `panels`
- **AND** the `layout` panel references match the `snapshotId` values in the `panels` array

#### Scenario: Export of dashboard with no panels
- **WHEN** a `GET /api/dashboards/:id/export` request is made for a dashboard with no panels
- **THEN** the system returns `200 OK` with an empty `panels` array and an empty layout

#### Scenario: Export of non-existent dashboard
- **WHEN** a `GET /api/dashboards/:id/export` request is made for a non-existent dashboard ID
- **THEN** the system returns `404 Not Found`

### Requirement: Import dashboard endpoint
The system SHALL expose `POST /api/dashboards/import` that accepts a dashboard snapshot payload and recreates the dashboard with fresh server-assigned IDs. The imported dashboard SHALL receive a new `DashboardId`. Each panel SHALL receive a new `PanelId`. Layout panel ID references SHALL be remapped from `snapshotId` values to the newly assigned `PanelId` values. The response SHALL contain the new dashboard and its panels, matching the shape of `DuplicateDashboardResponse`.

#### Scenario: Successful import
- **WHEN** a `POST /api/dashboards/import` request is made with a valid snapshot payload
- **THEN** the system creates a new dashboard with fresh IDs named as specified in the snapshot
- **AND** creates all panels from the snapshot with fresh IDs and `dashboardId` set to the new dashboard
- **AND** remaps all layout panel references to the new panel IDs
- **AND** returns `201 Created` with `{ dashboard: DashboardResponse, panels: [PanelResponse] }`

#### Scenario: Import assigns new IDs
- **WHEN** a snapshot is imported
- **THEN** the resulting dashboard ID and panel IDs SHALL differ from any IDs in the original snapshot or any previously imported version of the same snapshot

#### Scenario: Import with malformed payload — missing version
- **WHEN** a `POST /api/dashboards/import` request is made with a payload missing the `version` field
- **THEN** the system returns `400 Bad Request` with a descriptive error message

#### Scenario: Import with malformed payload — missing dashboard name
- **WHEN** a `POST /api/dashboards/import` request is made with an empty or missing `dashboard.name`
- **THEN** the system returns `400 Bad Request` with a descriptive error message

#### Scenario: Import with malformed payload — invalid panel type
- **WHEN** a `POST /api/dashboards/import` request is made with a panel entry containing an unknown `type` value
- **THEN** the system returns `400 Bad Request` with a descriptive error message

#### Scenario: Import with malformed payload — layout references unknown snapshotId
- **WHEN** a `POST /api/dashboards/import` request is made with a layout item whose `panelId` does not match any `snapshotId` in the panels array
- **THEN** the system returns `400 Bad Request` with a descriptive error message

### Requirement: Export action in dashboard actions menu
The system SHALL provide an "Export" action in each dashboard's actions menu. Activating it SHALL download the dashboard's export snapshot as a JSON file named `<dashboard-name>.json`.

#### Scenario: Export action triggers file download
- **WHEN** the user activates "Export" in a dashboard's actions menu
- **THEN** the system calls `GET /api/dashboards/:id/export`
- **AND** the browser downloads a file named `<dashboard-name>.json` containing the snapshot JSON

### Requirement: Import option in the dashboard create panel
The system SHALL provide a way to import a dashboard from the create panel in the dashboard sidebar. The user SHALL be able to select a `.json` file, which is sent to the import endpoint. On success, the new dashboard SHALL be added to the sidebar and immediately selected. On failure, a descriptive error SHALL be displayed inline.

#### Scenario: Import from file succeeds
- **WHEN** the user selects a valid snapshot JSON file in the import input
- **THEN** the system calls `POST /api/dashboards/import` with the file contents
- **AND** the new dashboard appears in the sidebar and is immediately selected

#### Scenario: Import from file fails with server error
- **WHEN** the user selects a file that is rejected by the server (malformed payload)
- **THEN** an inline error message is displayed describing the failure
- **AND** the sidebar state is unchanged

## MODIFIED Requirements

### Requirement: Export dashboard endpoint
The system SHALL expose `GET /api/dashboards/:id/export` that returns a self-contained JSON snapshot
of the dashboard. The snapshot SHALL include the dashboard `name`, `appearance`, `layout` (with
panel references keyed by `snapshotId`), a `panels` array with each panel's `snapshotId`, `title`,
`type`, `appearance`, and typed `config` payload, and a top-level `version` field. The `config`
payload SHALL be shaped according to the panel's `type` (mirroring `PanelResponse`). The snapshot
SHALL NOT include server-assigned IDs, `createdBy`, `createdAt`, or `lastUpdated` fields. The
snapshot SHALL NOT include per-subtype flat fields (`typeId`, `fieldMapping`, `content`, `imageUrl`,
`imageFit`, `dividerOrientation`, `dividerWeight`, `dividerColor`) at the panel-entry root.

The `version` field SHALL identify the new wire-shape version; the prior version is no longer
emitted.

#### Scenario: Successful export
- **WHEN** a `GET /api/dashboards/:id/export` request is made for an existing dashboard
- **THEN** the system returns `200 OK` with a JSON body containing `version`, `dashboard`, and `panels`
- **AND** every panel entry carries `type` and a typed `config` matching its type
- **AND** the `layout` panel references match the `snapshotId` values in the `panels` array

#### Scenario: Export of dashboard with no panels
- **WHEN** a `GET /api/dashboards/:id/export` request is made for a dashboard with no panels
- **THEN** the system returns `200 OK` with an empty `panels` array and an empty layout

#### Scenario: Export of non-existent dashboard
- **WHEN** a `GET /api/dashboards/:id/export` request is made for a non-existent dashboard ID
- **THEN** the system returns `404 Not Found`

#### Scenario: Export preserves image panel config fields
- **WHEN** a dashboard containing an image panel with `imageUrl` and `imageFit` is exported
- **THEN** the exported panel entry includes `config.imageUrl` and `config.imageFit` (closing the prior data-loss bug)

#### Scenario: Export preserves divider panel config fields
- **WHEN** a dashboard containing a divider panel with `orientation`, `weight`, and `color` is exported
- **THEN** the exported panel entry includes `config.orientation`, `config.weight`, and `config.color` (closing the prior data-loss bug)

### Requirement: Import dashboard endpoint
The system SHALL expose `POST /api/dashboards/import` that accepts a dashboard snapshot payload
whose `version` matches the current snapshot wire version. The importer SHALL recreate the
dashboard with fresh server-assigned IDs. The imported dashboard SHALL receive a new `DashboardId`.
Each panel SHALL receive a new `PanelId`. Layout panel ID references SHALL be remapped from
`snapshotId` values to the newly assigned `PanelId` values. Each imported panel SHALL reconstruct
its typed `config` per the panel's `type` discriminator. The response SHALL contain the new
dashboard and its panels, matching the shape of `DuplicateDashboardResponse`.

Snapshots whose `version` does not match the current wire version SHALL be rejected with
`400 Bad Request` and a descriptive error.

#### Scenario: Successful import
- **WHEN** a `POST /api/dashboards/import` request is made with a valid current-version snapshot payload
- **THEN** the system creates a new dashboard with fresh IDs named as specified in the snapshot
- **AND** creates all panels from the snapshot with fresh IDs, `dashboardId` set to the new dashboard, and typed `config` reconstructed per type
- **AND** remaps all layout panel references to the new panel IDs
- **AND** returns `201 Created` with `{ dashboard: DashboardResponse, panels: [PanelResponse] }`

#### Scenario: Import assigns new IDs
- **WHEN** a snapshot is imported
- **THEN** the resulting dashboard ID and panel IDs SHALL differ from any IDs in the original snapshot or any previously imported version of the same snapshot

#### Scenario: Import of prior-version snapshot is rejected
- **WHEN** a `POST /api/dashboards/import` request is made with a snapshot whose `version` is the prior wire version
- **THEN** the system returns `400 Bad Request` with a descriptive error indicating the snapshot must be re-exported

#### Scenario: Import with malformed payload — missing version
- **WHEN** a `POST /api/dashboards/import` request is made with a payload missing the `version` field
- **THEN** the system returns `400 Bad Request` with a descriptive error message

#### Scenario: Import with malformed payload — missing dashboard name
- **WHEN** a `POST /api/dashboards/import` request is made with an empty or missing `dashboard.name`
- **THEN** the system returns `400 Bad Request` with a descriptive error message

#### Scenario: Import with malformed payload — invalid panel type
- **WHEN** a `POST /api/dashboards/import` request is made with a panel entry containing an unknown `type` value
- **THEN** the system returns `400 Bad Request` with a descriptive error message

#### Scenario: Import with malformed payload — config shape mismatched to type
- **WHEN** a `POST /api/dashboards/import` request is made with a panel entry whose `config` shape does not match its `type`
- **THEN** the system returns `400 Bad Request` with a descriptive error message

#### Scenario: Import with malformed payload — layout references unknown snapshotId
- **WHEN** a `POST /api/dashboards/import` request is made with a layout item whose `panelId` does not match any `snapshotId` in the panels array
- **THEN** the system returns `400 Bad Request` with a descriptive error message

#### Scenario: Round-trip preserves image and divider config
- **WHEN** a dashboard containing image and divider panels is exported and then imported
- **THEN** the imported image panel has the same `config.imageUrl` and `config.imageFit` as the original
- **AND** the imported divider panel has the same `config.orientation`, `config.weight`, and `config.color` as the original

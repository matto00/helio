## MODIFIED Requirements

### Requirement: Import dashboard endpoint
The system SHALL expose `POST /api/dashboards/import` that accepts a dashboard snapshot payload and recreates the dashboard with fresh server-assigned IDs. The imported dashboard SHALL receive a new `DashboardId`. Each panel SHALL receive a new `PanelId`. Layout panel ID references SHALL be remapped from `snapshotId` values to the newly assigned `PanelId` values. For an output-kind panel entry (`config.outputId` present), the referenced Output SHALL be validated to exist and be accessible to the importing owner (the same repository call, `outputRepo.findByIdOwned`, that `PanelService.rejectMissingOutput` uses internally for direct panel creation -- invoked directly here since that method is private), and import SHALL fail with a named error (`400 Bad Request`) naming the unresolvable `outputId` if it does not resolve. The response SHALL contain the new dashboard and its panels, matching the shape of `DuplicateDashboardResponse`. Each panel's appearance and any kind-specific cross-field constraints SHALL be validated on import exactly as they are validated on direct panel creation — an import SHALL NOT bypass validation a direct `POST /api/panels` call would enforce. The panel entry's `id` field, if present in the payload, SHALL be ignored by the importer (`snapshotId` is authoritative for remapping); the field's absence SHALL NOT cause import to fail.

#### Scenario: Successful import
- **WHEN** a `POST /api/dashboards/import` request is made with a valid snapshot payload
- **THEN** the system creates a new dashboard with fresh IDs named as specified in the snapshot
- **AND** creates all panels from the snapshot with fresh IDs and `dashboardId` set to the new dashboard
- **AND** remaps all layout panel references to the new panel IDs
- **AND** returns `201 Created` with `{ dashboard: DashboardResponse, panels: [PanelResponse] }`

#### Scenario: Successful import of an output-kind panel
- **WHEN** a `POST /api/dashboards/import` request is made with a valid snapshot whose output-kind panel entries' `config.outputId` values resolve to Outputs accessible to the importing owner
- **THEN** the system creates a new dashboard with fresh IDs, panels bound to those `outputId`s, and remapped layout references
- **AND** returns `201 Created`

#### Scenario: Import of a pre-existing snapshot lacking the `id` field
- **WHEN** a `POST /api/dashboards/import` request is made with a snapshot payload whose panel entries have `snapshotId` but no `id` field (an export captured before this field existed)
- **THEN** the system imports the dashboard successfully, identically to a snapshot that does carry `id`

#### Scenario: Import fails with a named error when the referenced Output is missing
- **WHEN** a `POST /api/dashboards/import` request is made with an output-kind panel entry whose `config.outputId` does not resolve to any Output the importing owner can access
- **THEN** the system returns `400 Bad Request` with an error naming the unresolvable `outputId`, and creates nothing

#### Scenario: Import rejects a panel that fails appearance or cross-field validation
- **WHEN** a `POST /api/dashboards/import` request contains a panel entry whose appearance or kind-specific fields would be rejected by direct panel creation
- **THEN** the system returns `400 Bad Request` and creates nothing

#### Scenario: Import assigns new IDs
- **WHEN** a snapshot is imported
- **THEN** the resulting dashboard ID and panel IDs SHALL differ from any IDs in the original snapshot or any previously imported version of the same snapshot

#### Scenario: Import with malformed payload — missing version
- **WHEN** a `POST /api/dashboards/import` request is made with a payload missing the `version` field
- **THEN** the system returns `400 Bad Request` with a descriptive error message

#### Scenario: Import with malformed payload — missing dashboard name
- **WHEN** a `POST /api/dashboards/import` request is made with an empty or missing `dashboard.name`
- **THEN** the system returns `400 Bad Request` with a descriptive error message

#### Scenario: Import with malformed payload — layout references unknown snapshotId
- **WHEN** a `POST /api/dashboards/import` request is made with a layout item whose `panelId` does not match any `snapshotId` in the panels array
- **THEN** the system returns `400 Bad Request` with a descriptive error message

#### Scenario: Import with malformed payload — invalid panel type
- **WHEN** a `POST /api/dashboards/import` request is made with a panel entry containing an unknown `type` value
- **THEN** the system returns `400 Bad Request` with a descriptive error message

## MODIFIED Requirements

### Requirement: Export dashboard endpoint
The system SHALL expose `GET /api/dashboards/:id/export` that returns a self-contained JSON snapshot of the dashboard. The snapshot SHALL include the dashboard `name`, `appearance`, `layout` (with panel references keyed by `snapshotId`), a `panels` array with each panel's `snapshotId`, `id`, `title`, `type`, `appearance`, and a kind-specific `config` object whose shape is determined by `type` (references it carries to other resources, such as an `output` panel's `outputId` or a `form` panel's `dataSourceId`, are kept; import rejects an `output` panel whose `config.outputId` does not resolve to an Output the importer owns), and a top-level `version` field. The snapshot SHALL NOT include the dashboard's own id or any `createdBy`, `createdAt`, or `lastUpdated` field, and SHALL NOT carry a panel's own server-assigned id **except** in each panel entry's `id` field (and its `snapshotId`, derived from the same id; see the Successful export scenario), which is an intentional, additive exception carrying the panel's real (non-remapped) server-assigned id for programmatic/agent identification. `snapshotId` remains the sole handle used for import layout remapping; `id` is informational only and MUST NOT be used by the importer.

#### Scenario: Successful export
- **WHEN** a `GET /api/dashboards/:id/export` request is made for an existing dashboard
- **THEN** the system returns `200 OK` with a JSON body containing `version`, `dashboard`, and `panels`
- **AND** the `layout` panel references match the `snapshotId` values in the `panels` array
- **AND** each panel entry's `id` equals its `snapshotId` (both derived from the same real panel id)

#### Scenario: Export of dashboard with no panels
- **WHEN** a `GET /api/dashboards/:id/export` request is made for a dashboard with no panels
- **THEN** the system returns `200 OK` with an empty `panels` array and an empty layout

#### Scenario: Export of non-existent dashboard
- **WHEN** a `GET /api/dashboards/:id/export` request is made for a non-existent dashboard ID
- **THEN** the system returns `404 Not Found`


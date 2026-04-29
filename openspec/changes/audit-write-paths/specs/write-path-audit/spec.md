## ADDED Requirements

### Requirement: Write path audit document exists
The codebase SHALL contain a `write-path-audit` spec that enumerates every PATCH/POST call
issued during a normal dashboard editing session, including the endpoint, triggering user action,
request payload shape, and estimated call frequency per session.

#### Scenario: Audit covers all dashboard-level write paths
- **WHEN** a developer reviews the write-path-audit spec
- **THEN** it SHALL list PATCH /api/dashboards/:id for layout updates, appearance updates, and renames

#### Scenario: Audit covers all panel-level write paths
- **WHEN** a developer reviews the write-path-audit spec
- **THEN** it SHALL list PATCH /api/panels/:id for title updates, appearance updates, and data binding updates

#### Scenario: Audit covers creation and duplication paths
- **WHEN** a developer reviews the write-path-audit spec
- **THEN** it SHALL list POST /api/panels (create), POST /api/panels/:id/duplicate, and POST /api/dashboards/:id/duplicate

#### Scenario: Audit documents payload shapes
- **WHEN** a developer reads the audit for any write path
- **THEN** the spec SHALL describe the JSON request body fields sent in that call

#### Scenario: Audit documents call frequency
- **WHEN** a developer reads the audit
- **THEN** the spec SHALL include a per-interaction frequency estimate (e.g., 1 call per drag-stop, 1 call per rename commit) suitable for estimating batch API savings

### Requirement: Write path audit is accurate to the current implementation
The audit SHALL be derived from a direct reading of the service layer (`dashboardService.ts`,
`panelService.ts`), the Redux slice thunks, and the triggering components as they exist at the
time the ticket is worked.

#### Scenario: No undocumented write paths remain
- **WHEN** a developer cross-checks every `httpClient.patch` and `httpClient.post` call in the frontend services
- **THEN** every such call SHALL appear in the audit document

### Requirement: Write path audit documents the layout debounce
The audit SHALL note that layout changes (drag/resize) are debounced at 250 ms in `PanelGrid.tsx`,
resulting in a single PATCH call per drag-stop or resize-stop interaction, not one call per
`onLayoutChange` event.

#### Scenario: Debounce behaviour is recorded
- **WHEN** a developer reads the layout-change row in the audit
- **THEN** it SHALL state that the call fires once per drag/resize stop, not once per pixel moved

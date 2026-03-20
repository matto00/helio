## ADDED Requirements

### Requirement: Duplicate panel endpoint
The system SHALL expose `POST /api/panels/:id/duplicate` that creates a new panel copying the source panel's `dashboardId`, `title`, and `appearance`. The new panel SHALL receive a new UUID and a fresh `createdAt`/`lastUpdated` timestamp. The endpoint SHALL return `201 Created` with the new panel body.

#### Scenario: Successful duplication
- **WHEN** a `POST /api/panels/:id/duplicate` request is made for an existing panel
- **THEN** the system creates a new panel with the same `dashboardId`, `title`, and `appearance` as the source
- **AND** returns `201 Created` with the new panel's full representation including its new `id`

#### Scenario: Source panel not found
- **WHEN** a `POST /api/panels/:id/duplicate` request is made for a non-existent panel ID
- **THEN** the system returns `404 Not Found`

### Requirement: Duplicate action on panel card
The system SHALL provide a duplicate button on each panel card in the grid. Activating it SHALL trigger the duplicate endpoint and append the result to the panel list immediately upon success.

#### Scenario: Duplicate button triggers server-side copy
- **WHEN** the user clicks the duplicate button on a panel card
- **THEN** the system calls `POST /api/panels/:id/duplicate`
- **AND** the duplicated panel appears in the dashboard grid without a full page reload

#### Scenario: Original panel is unchanged after duplication
- **WHEN** duplication succeeds
- **THEN** the source panel's title, appearance, and position in the grid are unchanged

### Requirement: Duplicated panel layout placement
The system SHALL place the duplicated panel in the next available grid position using the existing default layout resolution logic. No layout entry needs to be explicitly created at duplication time.

#### Scenario: Duplicate placed at next available position
- **WHEN** a panel is duplicated
- **THEN** the new panel appears in the grid at a position determined by `resolveDashboardLayout`, not overlapping existing panels

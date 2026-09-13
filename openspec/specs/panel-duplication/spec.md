## Purpose
Defines panel duplication: the backend duplicate endpoint, the frontend duplicate action on panel cards, and placement of the duplicated panel using the default layout resolution logic.

## Requirements

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
The system SHALL provide a duplicate button on each panel card in the grid. Activating it SHALL trigger the duplicate endpoint and append the result to the panel list immediately upon success. The button SHALL be guarded against re-entry: while a duplicate request for a given panel is in flight, further activations of that panel's duplicate button SHALL be ignored, and the guard SHALL clear when the request settles (success or failure), re-enabling the button.

#### Scenario: Duplicate button triggers server-side copy
- **WHEN** the user clicks the duplicate button on a panel card
- **THEN** the system calls `POST /api/panels/:id/duplicate`
- **AND** the duplicated panel appears in the dashboard grid without a full page reload

#### Scenario: Original panel is unchanged after duplication
- **WHEN** duplication succeeds
- **THEN** the source panel's title, appearance, and position in the grid are unchanged

#### Scenario: Double-activation while a duplicate request is in flight produces exactly one clone
- **WHEN** the user clicks a panel card's duplicate button twice in rapid succession (including two synchronous activations in the same event-loop tick) before the first request settles
- **THEN** the system calls `POST /api/panels/:id/duplicate` exactly once
- **AND** exactly one new panel is created

#### Scenario: Duplicate button re-enables after the request settles
- **WHEN** a duplicate request for a panel completes, whether successfully or with an error
- **THEN** the duplicate button for that panel is enabled again and a subsequent click issues a new request

### Requirement: Duplicated panel layout placement
The system SHALL place the duplicated panel in the next available grid position using the existing default layout resolution logic. No layout entry needs to be explicitly created at duplication time.

#### Scenario: Duplicate placed at next available position
- **WHEN** a panel is duplicated
- **THEN** the new panel appears in the grid at a position determined by `resolveDashboardLayout`, not overlapping existing panels

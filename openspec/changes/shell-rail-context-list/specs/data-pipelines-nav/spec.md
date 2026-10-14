## MODIFIED Requirements

### Requirement: Sidebar includes a Pipelines nav link
The desktop/tablet icon rail SHALL include a `NavLink` to `/pipelines` with the accessible name and tooltip "Data
Pipelines" within the `aria-label="Main navigation"` container.

#### Scenario: Pipelines link is visible in the sidebar
- **WHEN** the application is loaded at a viewport wider than 768px
- **THEN** a "Data Pipelines" link is present in the main navigation rail

#### Scenario: Pipelines link navigates to /pipelines
- **WHEN** the user clicks the "Data Pipelines" rail link
- **THEN** the browser navigates to `/pipelines` and `PipelinesPage` is rendered

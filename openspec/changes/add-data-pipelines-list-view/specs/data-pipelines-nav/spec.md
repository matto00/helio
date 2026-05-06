## ADDED Requirements

### Requirement: /pipelines route is registered
The frontend SHALL register a `/pipelines` route via React Router that renders `PipelinesPage`.

#### Scenario: Navigating to /pipelines renders PipelinesPage
- **WHEN** the user navigates to `/pipelines`
- **THEN** `PipelinesPage` is rendered

### Requirement: Sidebar includes a Pipelines nav link
The app sidebar SHALL include a `NavLink` to `/pipelines` with visible label "Data Pipelines" within the `aria-label="Main navigation"` container.

#### Scenario: Pipelines link is visible in the sidebar
- **WHEN** the application is loaded
- **THEN** a "Data Pipelines" link is visible in the main navigation sidebar

#### Scenario: Pipelines link navigates to /pipelines
- **WHEN** the user clicks the "Data Pipelines" nav link
- **THEN** the browser navigates to `/pipelines` and `PipelinesPage` is rendered

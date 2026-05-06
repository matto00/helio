## MODIFIED Requirements

### Requirement: /sources route renders SourcesPage
The frontend SHALL register a `/sources` route via React Router that renders `SourcesPage`. The existing `/` route continues to render the dashboard panel view. Navigation between routes is provided by `NavLink` components in the app sidebar with `aria-label="Main navigation"`. The sidebar SHALL include nav links for Dashboards (`/`), Data Sources (`/sources`), and Data Pipelines (`/pipelines`).

#### Scenario: Navigating to /sources shows SourcesPage
- **WHEN** the user navigates to `/sources`
- **THEN** `SourcesPage` is rendered with "Data Sources" and "Type Registry" section headings visible

#### Scenario: Navigating to / shows dashboard view
- **WHEN** the user is on `/sources` and clicks the Dashboards nav link
- **THEN** the panel list and dashboard controls are visible

#### Scenario: Navigating to /pipelines shows PipelinesPage
- **WHEN** the user clicks the "Data Pipelines" nav link in the sidebar
- **THEN** `PipelinesPage` is rendered

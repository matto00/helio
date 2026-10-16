## MODIFIED Requirements

### Requirement: Command bar breadcrumb reflects Data Pipelines route
The command bar breadcrumb SHALL display "Data Pipelines" when the current route is `/pipelines`.

#### Scenario: Breadcrumb shows Data Pipelines on /pipelines
- **WHEN** the current route is `/pipelines`
- **THEN** the breadcrumb label reads "Data Pipelines"

#### Scenario: Breadcrumb shows Dashboards on /
- **WHEN** the current route is `/dashboards`
- **THEN** the breadcrumb label reads "Dashboards"

#### Scenario: Breadcrumb shows Data Sources on /sources
- **WHEN** the current route is `/sources`
- **THEN** the breadcrumb label reads "Data Sources"


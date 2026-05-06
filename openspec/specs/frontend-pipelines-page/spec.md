# frontend-pipelines-page Specification

## Purpose
TBD - created by archiving change add-data-pipelines-nav. Update Purpose after archive.
## Requirements
### Requirement: Data Pipelines page exists at /pipelines
The frontend SHALL render a `PipelinesPage` component at the `/pipelines` route. The page SHALL
display a placeholder empty state (e.g. a "coming soon" message or icon) when no pipeline data
is available. No API calls or Redux state are required for the placeholder.

#### Scenario: User navigates to /pipelines
- **WHEN** an authenticated user navigates to `/pipelines`
- **THEN** the `PipelinesPage` component is rendered inside the app shell

#### Scenario: PipelinesPage shows placeholder content
- **WHEN** `PipelinesPage` is rendered
- **THEN** a non-empty placeholder element (text or icon) is visible to the user

### Requirement: Data Pipelines appears in sidebar navigation
The sidebar nav SHALL include a "Data Pipelines" `NavLink` pointing to `/pipelines`. It SHALL be
positioned after "Data Sources" in the nav order. The link SHALL receive the active style when the
current route is `/pipelines`.

#### Scenario: Data Pipelines nav item is visible
- **WHEN** the authenticated app shell is rendered
- **THEN** a nav link labeled "Data Pipelines" pointing to `/pipelines` is present in the sidebar

#### Scenario: Data Pipelines nav item shows active state on /pipelines
- **WHEN** the current route is `/pipelines`
- **THEN** the "Data Pipelines" nav link has the active class applied

#### Scenario: Data Pipelines nav item is ordered after Data Sources
- **WHEN** the sidebar nav is rendered
- **THEN** "Data Pipelines" appears after "Data Sources" in DOM order

### Requirement: Command bar breadcrumb reflects Data Pipelines route
The command bar breadcrumb SHALL display "Data Pipelines" when the current route is `/pipelines`.

#### Scenario: Breadcrumb shows Data Pipelines on /pipelines
- **WHEN** the current route is `/pipelines`
- **THEN** the breadcrumb label reads "Data Pipelines"

#### Scenario: Breadcrumb shows Dashboards on /
- **WHEN** the current route is `/`
- **THEN** the breadcrumb label reads "Dashboards"

#### Scenario: Breadcrumb shows Data Sources on /sources
- **WHEN** the current route is `/sources`
- **THEN** the breadcrumb label reads "Data Sources"


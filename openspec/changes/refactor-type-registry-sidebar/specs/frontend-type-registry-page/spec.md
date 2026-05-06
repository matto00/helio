## ADDED Requirements

### Requirement: /registry route renders TypeRegistryPage
The frontend SHALL register a `/registry` route via React Router inside `AppShell` that renders
`TypeRegistryPage`. The sidebar SHALL include a "Type Registry" `NavLink` as a peer to "Dashboards"
and "Data Sources".

#### Scenario: Navigating to /registry shows TypeRegistryPage
- **WHEN** the user clicks the "Type Registry" sidebar link
- **THEN** the URL changes to `/registry` and `TypeRegistryPage` is rendered with the Type Registry list visible

#### Scenario: Sidebar nav link is active on /registry
- **WHEN** the current route is `/registry`
- **THEN** the "Type Registry" sidebar nav link has the active class applied

### Requirement: TypeRegistryPage dispatches fetchDataTypes on mount and renders TypeRegistryBrowser
`TypeRegistryPage` SHALL dispatch `fetchDataTypes` on mount. Once the dataTypes status is
`succeeded` or `idle`, it SHALL render `TypeRegistryBrowser`. A loading indicator SHALL be shown
while status is `loading`.

#### Scenario: Loading state is displayed
- **WHEN** the user navigates to `/registry` and `fetchDataTypes` is in progress
- **THEN** a loading message is displayed

#### Scenario: TypeRegistryBrowser is rendered after load
- **WHEN** `fetchDataTypes` succeeds
- **THEN** `TypeRegistryBrowser` renders the list of data types

### Requirement: Breadcrumb reflects the active top-level section
`AppShell` SHALL display a breadcrumb label matching the current route: "/" → "Dashboards",
"/sources" → "Data Sources", "/registry" → "Type Registry".

#### Scenario: Breadcrumb shows Type Registry on /registry
- **WHEN** the user is on the `/registry` route
- **THEN** the breadcrumb displays "Type Registry"

#### Scenario: Breadcrumb shows Data Sources on /sources
- **WHEN** the user is on the `/sources` route
- **THEN** the breadcrumb displays "Data Sources"

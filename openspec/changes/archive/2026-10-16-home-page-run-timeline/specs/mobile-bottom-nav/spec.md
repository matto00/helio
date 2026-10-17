## MODIFIED Requirements

### Requirement: Bottom tab bar provides section navigation on phone
The frontend SHALL render a bottom tab bar (`shared/chrome/BottomNav`) in the phone layout with Home (`/home`, the Home
page) first, followed by the five registry destinations of the desktop rail (`/dashboards`, `/sources`, `/pipelines`,
`/connectors`, `/chat`) and, for owners only, Usage, sourced from a single shared destination definition so desktop and
phone navigation cannot drift. Each destination SHALL show a Lucide icon and no visible text label; each SHALL
therefore carry an accessible name equal to its full destination label, exposed in the computed accessibility tree,
since with no visible label that name is the only thing identifying the destination to assistive technology.

#### Scenario: Tab bar visible on phone
- **WHEN** the app shell renders in the phone layout on any protected route for a non-owner
- **THEN** the bottom tab bar is visible with six icon-only tabs for Home, Dashboards, Data Sources, Data Pipelines,
  Connectors, and Assistant

#### Scenario: Every tab exposes its full accessible name
- **WHEN** the computed accessibility tree is inspected for the tab bar at phone width
- **THEN** each link exposes its full destination label as its accessible name, verified from the computed tree
  rather than from markup

#### Scenario: Tab navigates and reflects active section
- **WHEN** the user taps a tab
- **THEN** the router navigates to that section and only that tab renders in the active state

#### Scenario: Hidden at desktop widths
- **WHEN** the viewport is above the phone layout
- **THEN** the bottom tab bar is not visible and the desktop rail behaves exactly as before

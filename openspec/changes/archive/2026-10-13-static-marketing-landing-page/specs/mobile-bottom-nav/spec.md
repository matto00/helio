## MODIFIED Requirements

### Requirement: Bottom tab bar provides section navigation on phone
The frontend SHALL render a bottom tab bar (`shared/chrome/BottomNav`) below the 768px breakpoint
with exactly the six section destinations of the desktop sidebar (`/home`, `/sources`, `/pipelines`,
`/registry`, `/metrics`, `/chat`), sourced from a single shared destination definition so desktop
and phone navigation cannot drift. Each destination SHALL show a Lucide icon and no visible text
label; each SHALL therefore carry an accessible name equal to its full destination label, exposed in
the computed accessibility tree, since with no visible label that name is the only thing identifying
the destination to assistive technology.

#### Scenario: Tab bar visible on phone
- **WHEN** the app shell renders at a viewport narrower than 768px on any protected route
- **THEN** the bottom tab bar is visible with six icon-only tabs for Dashboards, Data Sources, Data
  Pipelines, Data Types, Metrics, and Assistant

#### Scenario: Every tab exposes its full accessible name
- **WHEN** the computed accessibility tree is inspected for the tab bar at phone width
- **THEN** each of the six links exposes its full destination label as its accessible name, verified
  from the computed tree rather than from markup

#### Scenario: Tab navigates and reflects active section
- **WHEN** the user taps a tab
- **THEN** the router navigates to that section and only that tab renders in the active state

#### Scenario: Hidden at desktop widths
- **WHEN** the viewport is 768px or wider
- **THEN** the bottom tab bar is not visible and the desktop sidebar behaves exactly as before

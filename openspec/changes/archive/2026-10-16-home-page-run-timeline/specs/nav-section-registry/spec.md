## ADDED Requirements

### Requirement: Home leads the rail and the phone bottom nav and opens the Home page
The desktop rail and the phone bottom nav SHALL each show a Home item, labelled "Home", as their first item, navigating
to `/home`, the Home page (HEL-1578; `/` is the marketing page since HEL-1562). The dashboards view lives at
`/dashboards` and `/dashboards/:id`, and the registry's Dashboards entry SHALL point at `/dashboards`. Home SHALL NOT be
added to the registry's nav-visible entries, which stay exactly five; the registry SHALL resolve `/home` to the label
"Home" for the breadcrumb and document title, with no context list. On `/home` the Home item SHALL carry
`aria-current="page"` and the active styling and the Dashboards item SHALL NOT; on a dashboard route the Dashboards
item SHALL be the active one and Home SHALL NOT, so exactly one item is active on each surface. Owner ruling
2026-10-13: "home item should live in the phone bottom nav as well, since phone doesn't have a rail (and shouldn't)".

#### Scenario: Home leads the phone bottom nav
- **WHEN** the bottom nav renders at 375px for a non-owner
- **THEN** it shows six tabs, Home first followed by the five registry destinations in their existing order

#### Scenario: Home opens the Home page
- **WHEN** the user taps or clicks Home from `/pipelines`
- **THEN** the browser navigates to `/home` and the Home page renders

#### Scenario: One active item on Home
- **WHEN** the user is on `/home` at 375px or at 1280px
- **THEN** only the Home item is marked active

#### Scenario: One active item on a dashboard
- **WHEN** the user is on `/dashboards` or `/dashboards/:id` at 375px or at 1280px
- **THEN** only the Dashboards item is marked active, and Home is not

#### Scenario: Tap targets still tile at 375px
- **WHEN** an owner's bottom nav renders seven tabs at 375px
- **THEN** every tab is at least 44px wide and no two tabs' hit areas overlap

## REMOVED Requirements

### Requirement: A Home alias leads the rail and the phone bottom nav
**Reason**: HEL-1578 ships the Home page, so Home no longer aliases the dashboards view and is marked current on `/home`.
**Migration**: Replaced by "Home leads the rail and the phone bottom nav and opens the Home page"; the dashboards view
moved to `/dashboards`.

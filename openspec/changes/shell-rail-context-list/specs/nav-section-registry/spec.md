## ADDED Requirements

### Requirement: A Home alias leads the rail and the phone bottom nav
The desktop rail and the phone bottom nav SHALL each show a Home item, labelled "Home", as their first item, navigating
to `/home` (the app's dashboards view; `/` is the marketing page since HEL-1562) until the Home page exists (HEL-1578 repoints it). Home SHALL NOT be added to the registry's
nav-visible entries, which stay exactly five; the mobile nav sheet and other registry-derived surfaces are unchanged.
While Home aliases `/home`, it SHALL never be marked as the current page: on a dashboard route the Dashboards item carries
`aria-current="page"` and the active styling, so exactly one item is active on each surface. Owner ruling 2026-10-13:
"home item should live in the phone bottom nav as well, since phone doesn't have a rail (and shouldn't)".

#### Scenario: Home leads the phone bottom nav
- **WHEN** the bottom nav renders at 375px for a non-owner
- **THEN** it shows six tabs, Home first followed by the five registry destinations in their existing order

#### Scenario: Home opens the dashboards view
- **WHEN** the user taps or clicks Home from `/pipelines`
- **THEN** the browser navigates to `/home`

#### Scenario: One active item on a dashboard
- **WHEN** the user is on `/home` at 375px or at 1280px
- **THEN** only the Dashboards item is marked active, and Home is not

#### Scenario: Tap targets still tile at 375px
- **WHEN** an owner's bottom nav renders seven tabs at 375px
- **THEN** every tab is at least 44px wide and no two tabs' hit areas overlap

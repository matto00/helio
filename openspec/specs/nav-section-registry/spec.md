# nav-section-registry Specification

## Purpose
This registry is the single source of truth mapping every authenticated-shell route to its {label, icon, nav visibility, picker-selection id}, so the sidebar, breadcrumb, document title, and mobile chrome cannot drift into independent, inconsistent copies.

## Requirements

### Requirement: Non-picker chrome routes get their own distinct label
Non-picker chrome routes SHALL each resolve their own distinct registry `label` — `/settings`,
`/proposals/review`, and `/patch-sets/review` never share a default/fallback label with each other
or with any picker route.

#### Scenario: Settings and review routes never show another route's label
- **WHEN** the app shell renders on `/settings`, `/proposals/review`, or `/patch-sets/review`
- **THEN** the breadcrumb and `document.title` show that route's own label ("Settings", "Review
  Proposal", "Review Changes" respectively) and never "Dashboards" or another section's label

### Requirement: Registry icons are visually distinct at collapsed-rail size
Adjacent primary-nav registry entries SHALL use icons that are visually distinguishable from one
another when rendered at the collapsed icon-rail size (16px). The Assistant entry's icon SHALL NOT
be a near-identical glyph to the Data Types entry's icon, and the Metrics entry's icon SHALL read
clearly as a metrics/chart glyph rather than a clock/history glyph.

#### Scenario: Assistant and Data Types icons are distinguishable in the collapsed rail
- **WHEN** the sidebar nav rail renders in its collapsed (icon-only) state
- **THEN** the Assistant entry's icon and the Data Types entry's icon are visually distinct glyphs,
  not near-identical rounded-rectangle variants

#### Scenario: Metrics icon reads as a metrics/chart glyph
- **WHEN** the sidebar nav rail or `BottomNav` renders the Metrics entry
- **THEN** its icon is a chart/column-style glyph rather than a gauge/clock-style glyph

### Requirement: The primary nav destination list is exactly five entries, derived from the registry
The registry's nav-visible entries SHALL be exactly: Dashboards, Data Sources, Data Pipelines, Connectors, Assistant, and this list SHALL be the single source every nav-deriving surface (sidebar rail, bottom tab bar, mobile nav sheet, onboarding glyphs) reads from — no surface hardcodes an independent list.

#### Scenario: Nav-visible entries match the registry
- **WHEN** the registry's nav-visible entries are read
- **THEN** they are exactly Dashboards, Data Sources, Data Pipelines, Connectors, Assistant, in that order

#### Scenario: Five nav destinations are shown everywhere
- **WHEN** any nav-deriving surface (sidebar, bottom nav, mobile sheet) renders
- **THEN** exactly five destinations appear, matching the registry
- **AND** no Data Types or Metrics entry appears anywhere

### Requirement: One registry resolves every chrome route to label/icon/picker, with no registry/metrics picker id
Every route SHALL resolve a label from the registry, and adding a new route SHALL require only a registry edit (no second hardcoded mapping elsewhere). The `PickerId` union SHALL NOT include `"registry"` or `"metrics"`; `/registry`, `/registry/:id`, `/metrics`, `/metrics/:id` are not registered routes and resolve to no chrome section (decision 11 — no stubs or redirects).

#### Scenario: Every route resolves a label from the registry
- **WHEN** any registered chrome route is rendered
- **THEN** its label and icon (if nav-visible) come from the registry, not a separate hardcoded mapping

#### Scenario: Adding a route requires only a registry edit
- **WHEN** a new route is added to the registry array
- **THEN** every nav-deriving surface picks it up with no additional code change

#### Scenario: Retired routes have no chrome mapping
- **WHEN** the registry is queried for `/registry` or `/metrics`
- **THEN** no matching section entry is found — these paths are not registered routes at all

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

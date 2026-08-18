# nav-section-registry Specification

## Purpose
This registry is the single source of truth mapping every authenticated-shell route to its {label, icon, nav visibility, picker-selection id}, so the sidebar, breadcrumb, document title, and mobile chrome cannot drift into independent, inconsistent copies.
## Requirements
### Requirement: One registry resolves every chrome route to label/icon/picker
The frontend SHALL provide exactly one registry (`frontend/src/shared/chrome/sections.ts`) mapping
every route the authenticated shell renders (`/`, `/sources`, `/pipelines`, `/registry`,
`/metrics`, `/chat`, `/settings`, `/proposals/review`, `/patch-sets/review`) to a `{path, label,
shortLabel?, icon?, showInNav, pickerId}` entry. The desktop breadcrumb, `document.title`, the
phone title/sheet, the sidebar nav rail, and `BottomNav` SHALL all derive their route→label/icon
mapping from this one registry — no component SHALL hardcode an independent route→label or
route→icon mapping.

#### Scenario: Every route resolves a label from the registry
- **WHEN** the app shell renders on any of the nine registered routes
- **THEN** the breadcrumb, `document.title`, and (on phone) the section title all show that route's
  registry `label`, with no route falling through to another route's label

#### Scenario: Adding a route requires only a registry edit
- **WHEN** a new chrome route is added to the registry with a `label`/`icon`/`pickerId`
- **THEN** the sidebar nav rail (if `showInNav` is true), `BottomNav` (if `showInNav` is true), the
  breadcrumb, and `document.title` all reflect it without any other file being edited

### Requirement: Non-picker chrome routes get their own distinct label
Non-picker chrome routes SHALL each resolve their own distinct registry `label` — `/settings`,
`/proposals/review`, and `/patch-sets/review` never share a default/fallback label with each other
or with any picker route.

#### Scenario: Settings and review routes never show another route's label
- **WHEN** the app shell renders on `/settings`, `/proposals/review`, or `/patch-sets/review`
- **THEN** the breadcrumb and `document.title` show that route's own label ("Settings", "Review
  Proposal", "Review Changes" respectively) and never "Dashboards" or another section's label

### Requirement: The primary nav destination list is derived from the registry
`navDestinations` (consumed by the sidebar nav rail and `BottomNav`) SHALL be derived from the
registry's entries where `showInNav` is true, rather than maintained as an independent list.

#### Scenario: Nav-visible entries match the registry
- **WHEN** the sidebar nav rail or `BottomNav` renders
- **THEN** it shows exactly the registry entries with `showInNav: true`, in registry order, with no
  entry present in one nav surface but not the other

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


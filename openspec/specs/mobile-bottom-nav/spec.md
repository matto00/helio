# mobile-bottom-nav Specification

## Purpose
Provides a breakpoint-gated, promotable bottom tab bar for section navigation on phone-width
viewports (<768px), replacing the broken collapsed-sidebar stub and keeping phone and desktop
navigation from drifting via a single shared destination list.
## Requirements
### Requirement: Bottom tab bar provides section navigation on phone
The frontend SHALL render a bottom tab bar (`shared/chrome/BottomNav`) below the 768px breakpoint
with exactly the four section destinations of the desktop sidebar (`/`, `/sources`, `/pipelines`,
`/registry`), sourced from a single shared destination definition so desktop and phone navigation
cannot drift. Each destination SHALL show a Lucide icon and a label in the UI face (Schibsted
Grotesk), not mono.

#### Scenario: Tab bar visible on phone
- **WHEN** the app shell renders at a viewport narrower than 768px on any protected route
- **THEN** the bottom tab bar is visible with four tabs: Dashboards, Data Sources, Data Pipelines,
  Type Registry

#### Scenario: Tab navigates and reflects active section
- **WHEN** the user taps a tab
- **THEN** the router navigates to that section and only that tab renders in the active state

#### Scenario: Hidden at desktop widths
- **WHEN** the viewport is 768px or wider
- **THEN** the bottom tab bar is not visible and the desktop sidebar behaves exactly as before

### Requirement: Tab bar visual and ergonomic constraints
The tab bar SHALL have an opaque `--app-surface` background with a `--app-border-subtle` top
hairline (no translucency or blur), use `--app-accent` for the active tab and `--app-text-muted`
for inactive tabs (accent nowhere else in the bar), derive its height from control tokens plus
`env(safe-area-inset-bottom)`, and give every tab a tap target of at least 44x44 CSS px.

#### Scenario: Opaque over user dashboard backgrounds
- **WHEN** a dashboard with a user-set background color is open on phone
- **THEN** the tab bar's background remains fully opaque `--app-surface` with no tinting

#### Scenario: Safe-area inset applied
- **WHEN** the app runs standalone on a device with a bottom home-indicator inset
- **THEN** tab content sits above `env(safe-area-inset-bottom)` and remains tappable

#### Scenario: Tap target size
- **WHEN** the tab bar renders at 390px viewport width
- **THEN** each tab's hit area measures at least 44x44 CSS px

### Requirement: Every route is escapable via the tab bar
Below 768px, every protected route SHALL render the tab bar so the user can always reach another
section without browser chrome (no swipe-back exists in standalone mode). Content SHALL NOT be
occluded by the bar (the content area reserves the bar's height plus safe-area).

#### Scenario: No trapped route
- **WHEN** the user is on any of `/`, `/sources`, `/pipelines`, `/registry` at phone width
- **THEN** the tab bar is present and navigating to every other section succeeds

#### Scenario: Content not occluded
- **WHEN** a page is scrolled to its end at phone width
- **THEN** the final content is fully visible above the tab bar

### Requirement: BottomNav is promotable to desktop without a rewrite
`BottomNav` SHALL be a self-contained shared component whose phone-only visibility is enforced by
a breakpoint rule in its own stylesheet, such that showing it at desktop widths is a
media-query/flag change with no component rewrite.

#### Scenario: Breakpoint-only gating
- **WHEN** the breakpoint rule in `BottomNav.css` is relaxed
- **THEN** the component renders and functions at desktop widths without code changes


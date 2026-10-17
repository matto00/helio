## MODIFIED Requirements

### Requirement: Bottom tab bar provides section navigation on phone
The frontend SHALL render a bottom tab bar (`shared/chrome/BottomNav`) in the phone layout with exactly five tabs, in order: Home (`/home`), Dashboards (`/dashboards`), Data (`/sources`),
Pipelines (`/pipelines`) and Me (a menu, not a route). The phone tab list SHALL be derived in
`shared/chrome/navDestinations.ts` from the same shared destination definitions the desktop rail
uses, so route paths and active-state logic cannot drift; the desktop rail's own destinations are
unchanged. Each tab SHALL carry an accessible name equal to its label in the computed
accessibility tree. The active tab SHALL show its label visibly beside its icon, in full-strength
`--app-text` ink, sized to its content rather than filling the bar; inactive tabs SHALL show the icon
only and are evenly spaced across the remaining width. Me SHALL be a menu button whose active state is exposed as
`aria-current="true"`. Exactly one tab SHALL be current on any route that belongs to a tab:
Home on `/home`; Dashboards on the dashboard view; Data on `/sources` and `/connectors` and their
sub-routes; Pipelines on `/pipelines` and its sub-routes; Me on `/settings` and `/admin/usage`. No
tab is current on routes that belong to none of them (for example `/chat`).

#### Scenario: Tab bar visible on phone
- **WHEN** the app shell renders in the phone layout on any protected route
- **THEN** the bottom tab bar is visible with exactly five tabs: Home, Dashboards, Data, Pipelines, Me

#### Scenario: Every tab exposes its full accessible name
- **WHEN** the computed accessibility tree is inspected for the tab bar at phone width
- **THEN** each tab exposes its label as its accessible name, verified from the computed tree, and a
  collapsed (inactive) label adds nothing to that name

#### Scenario: Tab navigates and reflects active section
- **WHEN** the user taps a route tab
- **THEN** the router navigates to that section and only that tab renders in the active state, with
  its label visible

#### Scenario: Data is current on Connectors
- **WHEN** the user is on `/connectors` at phone width
- **THEN** the Data tab is the only current tab

#### Scenario: Hidden at desktop widths
- **WHEN** the viewport is above the phone layout
- **THEN** the bottom tab bar is not visible and the desktop rail behaves exactly as before

### Requirement: Every one of the five current routes is escapable via the tab bar
The phone shell SHALL leave no route trapped. Connectors SHALL be reachable through the Data tab,
whose `/sources` and `/connectors` pages show a "Sources | Connectors" link row on the phone shell.
Usage (owners only), Settings, Getting started and Sign out SHALL be reachable through the Me tab's
menu, which replaces the phone header's avatar menu. The Assistant SHALL be reachable through the
header's "Open assistant" button; for non-free tiers the overlay's "Browse all conversations" link
reaches `/chat`, and for the free tier the overlay itself shows the same request-access state
`/chat` would. Content continues to scroll clear of the
floating bar and clearance stays in sync with bar geometry.

#### Scenario: Five tabs, no retired destinations
- **WHEN** the bottom tab bar renders on phone
- **THEN** exactly five tabs are shown, and none is Connectors, Assistant or Usage

#### Scenario: Connectors reachable via Data
- **WHEN** the user taps Data and then the "Connectors" link on the phone shell
- **THEN** the Connectors page opens and the Data tab stays current

#### Scenario: Usage reachable via Me for an owner only
- **WHEN** an owner opens the Me menu
- **THEN** it lists Settings, Usage, Getting started and Sign out; for a non-owner it lists the same
  without Usage

#### Scenario: No trapped route
- **WHEN** the user is on any authenticated route at phone width
- **THEN** every other top-level destination whose content the user's tier can use is reachable within two taps

#### Scenario: Assistant reachable on every tier
- **WHEN** a free-tier user taps "Open assistant"
- **THEN** the assistant overlay opens with its request-access state; and when a beta user does the same, the
  overlay's "Browse all conversations" link opens `/chat`

#### Scenario: Content scrolls clear of the floating bar
- **WHEN** a page's content is taller than the viewport
- **THEN** scrolling content never renders underneath the floating tab bar

## ADDED Requirements

### Requirement: Five-tab glass bar visual and ergonomic constraints
The tab bar SHALL render as a floating capsule inset from the left, right, and bottom edges of the
viewport, with fully rounded (semicircular) ends, a translucent `backdrop-filter` material, and a
tint layer composited between the blur and the glyphs. Inactive icons SHALL use full-contrast
`--app-text` (not `--app-text-muted`, which cannot clear the contrast floor over a translucent
surface at any usable tint alpha, under either a 3:1 or a 4.5:1 floor), and `--app-accent` SHALL
apply to the active tab's icon alone and to nothing else in the bar. The
active tab SHALL be indicated by a material lozenge behind its icon and visible label whose boundary reaches at least
3:1 against the adjacent capsule material, so that accent colour is never the sole indicator of
which tab is active. The bar's geometry SHALL derive from the shared `--bottom-nav-height` token
family plus `env(safe-area-inset-bottom)`, and every tab SHALL keep a tap target of at least
44x44 CSS px.

This requirement replaces the previous opaque-surface constraint for this element only. It is the
sole carve-out from `DESIGN.md`'s opacity invariant; all other chrome remains opaque.

#### Scenario: Legible over hostile user dashboard backgrounds
- **WHEN** a dashboard whose background is a photo, pure white, pure black, or the accent colour is
  open on phone, in either theme
- **THEN** every icon rendered against the translucent material measures at least 3:1 (WCAG 1.4.11)
  against the composited backdrop behind it, sampled from rendered pixels rather than computed from
  source

#### Scenario: The active tab is identifiable without relying on the accent colour
- **WHEN** any of the shipped accent presets is selected, in either theme
- **THEN** the active tab remains identifiable from its lozenge's boundary alone, independently of
  the accent hue applied to its icon

#### Scenario: The active lozenge is visible against the capsule material
- **WHEN** the tab bar renders over any of: a theme-matched backdrop (the default `--app-bg` or a
  same-theme dashboard preset), where the lozenge's fill converges with the capsule; a
  theme-mismatched extreme (dark theme over white, light theme over black), where its boundary is
  weakest; or an accent-coloured backdrop
- **THEN** the lozenge's boundary measures at least 3:1 against the adjacent capsule material,
  sampled from rendered pixels on a straight edge rather than at the curve apex

#### Scenario: Translucent, not frosted
- **WHEN** the tab bar is rendered over a dashboard carrying a background image
- **THEN** the image remains recognisable through the bar's material, with the tint layer — not the
  blur alone — carrying glyph legibility

#### Scenario: Legibility survives without backdrop-filter support
- **WHEN** the browser does not support `backdrop-filter`
- **THEN** the bar renders its unconditional tint layer alone at the same alpha, and every glyph
  governed by the contrast floor still clears it

#### Scenario: Floating capsule clear of every screen edge
- **WHEN** the tab bar renders at 375px and 430px viewport widths
- **THEN** its computed bounding box is inset from the left, right, and bottom edges of the
  viewport, and its ends render as semicircles — verified from rendered pixels, since the pill
  radius token's computed value does not report the used radius

#### Scenario: The active icon remains visible inside its lozenge
- **WHEN** a tab is the active section
- **THEN** its icon still renders at its full glyph size inside the lozenge — the lozenge's padding and
  border are carried by a wrapper element, not applied to the icon itself, so the icon's own box is
  never collapsed

#### Scenario: Keyboard focus stays within the capsule
- **WHEN** the first or last tab receives visible keyboard focus
- **THEN** its focus ring follows the capsule's rounded end and remains within the capsule's bounds,
  rather than overhanging it as a rectangle

#### Scenario: Active tab renders as an inner lozenge
- **WHEN** a tab is the active section
- **THEN** it renders an inner rounded material surface nested within the capsule, not a
  full-bleed accent block and not an underline

#### Scenario: Safe-area inset applied
- **WHEN** the app runs standalone on a device with a non-zero bottom home-indicator inset
- **THEN** the capsule's bottom edge sits above `env(safe-area-inset-bottom)` by at least the bar's
  edge inset, and every tab still measures at least 44px tall

#### Scenario: Tap target size
- **WHEN** the tab bar renders at 375px, 390px, and 430px viewport widths
- **THEN** each tab's hit area measures at least 44x44 CSS px as reported by `getComputedStyle` on
  the rendered element, not as declared in the stylesheet

#### Scenario: Five tabs with the expanded label fit at the narrowest supported width
- **WHEN** the tab bar renders at 320px and 375px viewport widths, with any tab active (including Dashboards and
  Pipelines, the longest labels)
- **THEN** all five tabs render within the capsule, each retaining a hit area of at least 44x44 CSS
  px with no two hit areas overlapping, and the active label either fits or truncates with an
  ellipsis, never wrapping or overflowing the capsule

#### Scenario: The active pill is content-sized
- **WHEN** the tab bar renders at 430px and 768px viewport widths
- **THEN** the active tab's width is its icon, gap and label (up to the label cap), not the bar's leftover width,
  and the inactive tabs are evenly spaced across the remaining width

#### Scenario: The active pill is opaque inside a translucent capsule
- **WHEN** a tab is active, over any backdrop, in either theme
- **THEN** its lozenge is an opaque `--app-surface-strong` fill with a 1px `--app-text` ring, inactive lozenges
  have neither, and the capsule keeps its translucent tint and `backdrop-filter` unchanged

#### Scenario: The active pill's edge is visible against the capsule
- **WHEN** the active pill renders over a theme-matched backdrop, a theme-mismatched extreme, or an accent-coloured
  backdrop, in either theme
- **THEN** its ring measures at least 3:1 against the adjacent capsule material, sampled from rendered pixels on a
  straight segment

#### Scenario: The visible active label is legible
- **WHEN** the active tab's label renders over any backdrop named in "Legible over hostile user
  dashboard backgrounds", in either theme
- **THEN** the label text measures at least 4.5:1 against the composited pixels behind it, sampled
  from rendered pixels


## REMOVED Requirements

### Requirement: Tab bar visual and ergonomic constraints
**Reason**: Replaced by "Five-tab glass bar visual and ergonomic constraints". The phone nav now has five tabs, one
with a visible label, so the six-icon-only fit scenario no longer describes the bar.
**Migration**: Every other scenario carries over unchanged into the new requirement, plus a 4.5:1 floor for the
visible label and a 320px fit scenario for five tabs.

## MODIFIED Requirements

### Requirement: Bottom tab bar provides section navigation on phone
The frontend SHALL render a bottom tab bar (`shared/chrome/BottomNav`) below the 768px breakpoint
with exactly the six section destinations of the desktop sidebar (`/`, `/sources`, `/pipelines`,
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

### Requirement: Tab bar visual and ergonomic constraints
The tab bar SHALL render as a floating capsule inset from the left, right, and bottom edges of the
viewport, with fully rounded (semicircular) ends, a translucent `backdrop-filter` material, and a
tint layer composited between the blur and the glyphs. Inactive icons SHALL use full-contrast
`--app-text` (not `--app-text-muted`, which cannot clear the contrast floor over a translucent
surface at any usable tint alpha, under either a 3:1 or a 4.5:1 floor), and `--app-accent` SHALL
apply to the active tab's icon alone and to nothing else in the bar. The
active tab SHALL be indicated by a material lozenge behind its icon whose boundary reaches at least
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

#### Scenario: Six destinations fit at the narrowest supported width
- **WHEN** the tab bar renders at 375px viewport width
- **THEN** all six icon-only destinations render within the capsule, each retaining a tap target of
  at least 44x44 CSS px

### Requirement: Every route is escapable via the tab bar
Below 768px, every protected route SHALL render the tab bar so the user can always reach another
section without browser chrome (no swipe-back exists in standalone mode). Because the bar now
floats over content rather than sitting on a reserved ledge, page content SHALL still be able to
scroll fully clear of it: the content region SHALL reserve clearance equal to the capsule height
plus its bottom inset plus `env(safe-area-inset-bottom)`. That geometry SHALL have exactly one
definition — the shared `--bottom-nav-height` token family — consumed by the bar itself, the
content clearance, and the toast viewport, so the three cannot drift apart. Fixed-position overlay
chrome that would otherwise rest on the bar SHALL clear it from the same token.

#### Scenario: No trapped route
- **WHEN** the user is on any of `/`, `/sources`, `/pipelines`, `/registry` at phone width
- **THEN** the tab bar is present and navigating to every other section succeeds

#### Scenario: Content scrolls clear of the floating bar
- **WHEN** a page is scrolled to its end at phone width
- **THEN** the final content comes to rest fully above the floating capsule, with no content
  permanently trapped beneath it

#### Scenario: Clearance stays in sync with bar geometry
- **WHEN** the bar's capsule height or edge inset changes
- **THEN** the content region's reserved clearance and the toast viewport's offset both change with
  it, because all three read the same token rather than restating its value

#### Scenario: Floating panel-list chrome clears the bar
- **WHEN** a dashboard's panel list is open at a viewport width where both the zoom widget and the
  tab bar render
- **THEN** the zoom widget rests clear of the capsule rather than on top of it

## ADDED Requirements

### Requirement: Added bottom-nav motion respects reduced-motion preference
Any motion introduced by the floating tab bar SHALL be disabled outright when the user prefers
reduced motion, not merely shortened, and SHALL be disabled by a declaration that clears the
transition property rather than only its duration. This requirement constrains added motion; it does
not mandate that motion exist — a per-tab lozenge does not travel between tabs, so it may be
satisfied vacuously. The active tab SHALL still be correctly indicated either way.

#### Scenario: Reduced motion disables any added transition
- **WHEN** `prefers-reduced-motion: reduce` is set and the user switches tabs
- **THEN** no added transition runs on the active tab's lozenge — either because none was declared,
  or because the declared one is removed rather than shortened — and the correct tab is indicated

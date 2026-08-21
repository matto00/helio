# mobile-app-shell-anchoring Specification

## Purpose
Keeps the app shell bounded by the visible viewport so the document never scrolls as a whole, holds the mobile command bar immovable at the physical top of the screen, and exposes the top safe-area inset as a single reusable token seam that all top-anchored chrome consumes.
## Requirements
### Requirement: The app shell and its ancestors match the visible viewport
The app shell (`.app-shell`) and every ancestor in its sizing chain (`html`, `body`, `#root`) SHALL be bounded by the
dynamic viewport, not by the largest viewport and not by a percentage of the initial containing block, so the document
never exceeds the visible area and never scrolls as a whole. Vertical scrolling SHALL belong to the content region
(`.app-content`). A `100vh` declaration MAY precede the dynamic-viewport declaration as a fallback for browsers without
`dvh` support, but the dynamic-viewport declaration SHALL be the effective one wherever it is supported.

#### Scenario: The document does not scroll at a phone viewport
- **WHEN** the app is rendered at a phone viewport (e.g. 430x932 or 375x812) with content taller than the viewport
- **THEN** the scrolling root's `scrollHeight` SHALL NOT exceed its `clientHeight`
- **AND** scrolling gestures SHALL move `.app-content` only

#### Scenario: No ancestor in the shell chain is sized by the largest viewport or by a percentage
- **WHEN** the effective sizing of `.app-shell`, `html`, `body`, and `#root` is resolved
- **THEN** each SHALL resolve to the dynamic viewport height
- **AND** none SHALL resolve to `100vh` or to a percentage of the initial containing block

#### Scenario: A shell taller than the dynamic viewport is detectable
- **WHEN** the shell is forced taller than the dynamic viewport (modelling iOS's largest-viewport excess)
- **THEN** the document SHALL scroll and the command bar's viewport-relative top SHALL become negative
- **AND** the same probe SHALL report no such movement once the shell is bounded by the dynamic viewport

### Requirement: The mobile command bar never moves while scrolling
On mobile viewports (`<=768px`), the command bar (`.app-command-bar`) SHALL remain at a fixed position on screen at every
scroll position, and SHALL never be occluded by, or overprint, the OS status bar. This SHALL hold structurally — the bar is
a non-shrinking child of a shell that does not scroll — rather than by a `position: sticky` declaration inside a
non-scrolling container.

#### Scenario: The bar does not move across a scroll trace
- **WHEN** the content region is scrolled from top to bottom in steps at a phone viewport
- **THEN** the command bar's viewport-relative top coordinate SHALL be identical at every step

#### Scenario: No control renders above the inset's lower edge
- **WHEN** the app is rendered with a simulated top safe-area inset of 47px, and again at 59px
- **THEN** every interactive control inside the command bar SHALL have a bounding-rect top at or below the inset's lower
  edge, and a bounding-rect bottom at or above the bar's own bottom edge, at every scroll position

### Requirement: The top safe-area inset is claimed through one reusable seam
The top safe-area inset SHALL be exposed as a single token (`--app-safe-top`, defaulting to `0px` where no inset exists),
and the app's usable top edge SHALL be exposed as a single derived token (`--app-top-chrome-height`) equal to the command
bar's height plus that inset. Both SHALL be declared on the document root, and any viewport-conditional override of the
bar's height SHALL also target the document root, so the derived token recomputes with it. The command bar SHALL claim the
inset as its own `padding-top` while taking `--app-top-chrome-height` as its height, so its painted surface reaches the
physical top of the display with no inert band above it and without its content box being consumed by the inset. Other
top-anchored chrome SHALL consume the derived token rather than re-deriving `env(safe-area-inset-top)` independently.

#### Scenario: The bar's surface reaches the physical top without collapsing its content box
- **WHEN** the app is rendered with a non-zero top safe-area inset
- **THEN** the command bar's painted surface SHALL begin at viewport coordinate 0
- **AND** its `padding-top` SHALL equal the inset
- **AND** its border-box height SHALL equal the bar height plus the inset
- **AND** its content box SHALL remain at least 44px plus visible clearance on both sides

#### Scenario: The seam tokens resolve without an inset
- **WHEN** the app is rendered in a browser reporting no top safe-area inset
- **THEN** `--app-safe-top` SHALL resolve to `0px`
- **AND** `--app-top-chrome-height` SHALL resolve to the command bar's height alone

#### Scenario: The status-bar meta declares a translucent bar
- **WHEN** `index.html` is served
- **THEN** `apple-mobile-web-app-status-bar-style` SHALL be `black-translucent`
- **AND** the viewport meta SHALL retain `viewport-fit=cover`

### Requirement: Padding shorthands SHALL NOT reset the claimed inset
No rule targeting the command bar SHALL declare a `padding` shorthand, at any breakpoint; horizontal and bottom padding
SHALL be declared as longhands, so no later shorthand can silently reset `padding-top` to zero. This matters because
`apple-mobile-web-app-status-bar-style: black-translucent` makes the claimed inset load-bearing.

#### Scenario: A padding shorthand is reintroduced
- **WHEN** any `.app-command-bar` rule declares a `padding` shorthand
- **THEN** the corresponding CSS-lock test fails

### Requirement: Full-viewport mobile surfaces account for the top inset
Every full-viewport or top-anchored mobile surface SHALL consume `--app-safe-top` so its own top-anchored content clears
the status-bar glyphs, or SHALL be recorded as exempt with a stated reason. This is required because switching the
status-bar style to `black-translucent` extends all such surfaces under the OS status bar, not only the app shell.

#### Scenario: The phone panel-detail modal clears the status bar
- **WHEN** the panel detail modal is opened at a phone viewport with a non-zero top safe-area inset
- **THEN** its header's interactive controls and title SHALL render at or below the inset's lower edge

#### Scenario: A treated surface degrades to its pre-change spacing where no inset exists
- **WHEN** a full-viewport or top-anchored mobile surface consumes `--app-safe-top` to clear the status-bar glyphs
- **THEN** it SHALL add the inset to its own existing top spacing rather than replace that spacing outright
- **AND** on a browser that reports no top safe-area inset, its effective top padding/offset SHALL be unchanged from
  its value before this requirement was applied


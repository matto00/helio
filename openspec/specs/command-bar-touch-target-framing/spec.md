# command-bar-touch-target-framing Specification

## Purpose
Ensures the app command bar's own mobile height frames its 44px icon tap-targets with real clearance, instead of relying on the icon buttons' own tap-target floor alone.
## Requirements
### Requirement: Mobile command bar frames its own tap targets
On mobile viewports (`<=768px`), the app command bar (`.app-command-bar`) SHALL be tall enough to give its 44px mobile
tap-target-floor icon buttons (`IconButton.css`'s `HEL-308/314/319` floor) visible clearance above and below, rather than
the icon buttons nearly filling the bar's full height edge to edge. Its height SHALL derive from a single document-root
token whose mobile value is `calc(var(--control-lg) + var(--space-4))` (56px), computed from control and spacing tokens
directly and NOT from any bottom-navigation token or rule. Its border-box height SHALL equal that value plus the top
safe-area inset, and its content box SHALL equal that value minus the 1px bottom border. Desktop command-bar height SHALL
be unaffected. Reducing the bar's height SHALL NOT reduce any interactive control below the 44px tap-target floor.

#### Scenario: Mobile command bar height clears the 44px icon floor with margin
- **WHEN** the app is viewed at a mobile viewport (`<=768px` wide, e.g. 390×844)
- **THEN** `.app-command-bar`'s content box SHALL be 55px tall
- **AND** that content box SHALL exceed 44px on both the top and bottom of its icon-only buttons (not edge-to-edge)

#### Scenario: Every command-bar control clears the 44px tap floor
- **WHEN** the app is viewed at 430px, 375px and 768px, in light and dark themes
- **AND** the set of controls is enumerated from the rendered DOM rather than from a fixed list
- **THEN** every interactive control within `.app-command-bar` SHALL be reachable across at least 44px in its tap
  dimension as measured in the browser, not as declared in source
- **AND** a control whose tap area is provided by an expanded hit region rather than its own box SHALL have that
  region's own computed width and height measured as at least 44px, rather than being probed only at corners derived
  from the same constant under test

#### Scenario: Reaching the floor never enlarges a painted control
- **WHEN** a command-bar control that paints its own background or border is measured at a mobile viewport
- **THEN** its painted box SHALL remain at the `--control-sm` size, and only its hit region SHALL reach 44px
- **AND** no control's hit region SHALL overlap a neighbouring control's painted box

#### Scenario: Desktop command bar height is unchanged
- **WHEN** the app is viewed at a desktop viewport (`>768px` wide)
- **THEN** `.app-command-bar`'s content box SHALL remain 47px (48px less the 1px bottom border), as before this change

### Requirement: CSS-lock test guards the mobile command-bar height rule
Static CSS-lock tests SHALL guard the rules that produce the mobile bar height, following the `IconButton.css.test.ts`
precedent — jsdom implements no real layout or media-query evaluation, so no DOM-rendering Jest test can observe the
rendered bar height at a phone viewport. The locks SHALL assert the presence and resolved value of the height seam — the
document-root token, its `max-width: 768px` override, and the bar's derivation from it — rather than a literal height
expression inside `App.css`, which the seam legitimately replaces. The mobile media block SHALL remain after the base
`.app-command-bar` rule in source order, since equal-specificity rules resolve by source order and an earlier media block
would silently render the mobile height inert.

#### Scenario: Mobile command-bar height rule removed
- **WHEN** the `max-width: 768px` override of the command-bar height token is removed, or its breakpoint is changed away
  from `max-width: 768px`
- **THEN** the corresponding CSS-lock test fails

#### Scenario: The bar stops deriving its height from the seam
- **WHEN** `.app-command-bar` no longer takes its height from the derived top-chrome token
- **THEN** the corresponding CSS-lock test fails

#### Scenario: Mobile media block moved above the base rule
- **WHEN** the `max-width: 768px` media block is moved above the base `.app-command-bar` rule
- **THEN** the corresponding CSS-lock test fails


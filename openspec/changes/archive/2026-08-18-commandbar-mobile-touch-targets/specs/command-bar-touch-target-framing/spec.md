## ADDED Requirements

### Requirement: Mobile command bar frames its own tap targets
On mobile viewports (`<=768px`), the app command bar (`.app-command-bar`) SHALL be tall enough to
give its 44px mobile tap-target-floor icon buttons (`IconButton.css`'s `HEL-308/314/319` floor)
visible clearance above and below, rather than the icon buttons nearly filling the bar's full
height edge to edge. Desktop command-bar height SHALL be unaffected.

#### Scenario: Mobile command bar height clears the 44px icon floor with margin
- **WHEN** the app is viewed at a mobile viewport (`<=768px` wide, e.g. 390×844)
- **THEN** `.app-command-bar`'s rendered height SHALL exceed 44px by a visible margin on both the
  top and bottom of its icon-only buttons (not edge-to-edge)

#### Scenario: Desktop command bar height is unchanged
- **WHEN** the app is viewed at a desktop viewport (`>768px` wide)
- **THEN** `.app-command-bar`'s height SHALL remain 48px, as before this change

### Requirement: CSS-lock test guards the mobile command-bar height rule
A static CSS-lock test SHALL assert that the `max-width: 768px` media block in `App.css` keeps the
`height: var(--space-10)` rule for `.app-command-bar`, following the `IconButton.css.test.ts`
precedent — jsdom implements no real layout or media-query evaluation, so no DOM-rendering Jest test
can observe the rendered bar height at a phone viewport; this is the only test type able to guard
this rule.

#### Scenario: Mobile command-bar height rule removed
- **WHEN** the mobile `height: var(--space-10)` rule for `.app-command-bar` is removed, or its media
  block's breakpoint is changed away from `max-width: 768px`
- **THEN** the corresponding CSS-lock test fails

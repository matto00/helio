## ADDED Requirements

### Requirement: ui-select popover option rows meet the 44px mobile tap-target minimum
The shared `ui-select` popover option rows (`.ui-select__option` in `frontend/src/shared/ui/inputs.css`) SHALL render with a minimum height of 44px at the mobile-shell breakpoint (`max-width: 768px`), with the option label vertically centered. Desktop (>768px) option-row density SHALL be unchanged from its pre-change value.

#### Scenario: Option rows at a phone viewport
- **WHEN** any `ui-select` popover is open at a 390px-wide viewport (either theme)
- **THEN** every option row's `getBoundingClientRect().height` is ≥ 44px

#### Scenario: Desktop density preserved
- **WHEN** the same popover is open at a desktop viewport (>768px)
- **THEN** option rows render at their pre-change height (no new rules apply outside the mobile
  media block)

#### Scenario: Long option lists still scroll
- **WHEN** a `ui-select` popover contains more options than fit in its `max-height` at a phone
  viewport
- **THEN** the panel scrolls vertically and no option row overflows the viewport horizontally

### Requirement: actions-menu items meet the 44px mobile tap-target minimum
The shared actions-menu items (`.actions-menu__item` in `frontend/src/shared/chrome/ActionsMenu.css`) SHALL render with a minimum height of 44px at the mobile-shell breakpoint (`max-width: 768px`), with the item label vertically centered. Desktop density SHALL be unchanged.

#### Scenario: Menu items at a phone viewport
- **WHEN** an actions menu (e.g. a panel card's kebab menu) is open at a 390px-wide viewport
- **THEN** every menu item's `getBoundingClientRect().height` is ≥ 44px

#### Scenario: Desktop density preserved
- **WHEN** the same menu is open at a desktop viewport (>768px)
- **THEN** menu items render at their pre-change height

### Requirement: CSS-lock tests guard the mobile rules
Static CSS-lock tests SHALL assert that the `max-width: 768px` media blocks in `inputs.css` and
`ActionsMenu.css` keep the `min-height: 44px` rules for `.ui-select__option` and
`.actions-menu__item`, following the `PanelDetailModal.css.test.ts` precedent.

#### Scenario: Mobile rule removed
- **WHEN** the mobile `min-height: 44px` rule for either selector is removed or the media block's
  breakpoint is changed away from `max-width: 768px`
- **THEN** the corresponding CSS-lock test fails

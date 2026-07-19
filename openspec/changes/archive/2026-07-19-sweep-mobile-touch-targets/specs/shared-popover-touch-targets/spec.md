## ADDED Requirements

### Requirement: actions-menu trigger carries a 44px mobile tap-target floor (defensive)

The shared actions-menu trigger (`.actions-menu__trigger` in `frontend/src/shared/chrome/ActionsMenu.css`) SHALL carry a `min-width: 44px; min-height: 44px` rule inside the mobile-shell breakpoint (`max-width: 768px`) media block, keeping the dots glyph centered (via the co-applied `.popover__trigger`). This rule is **defensive**: the kebab is not currently mounted on the phone shell (the desktop sidebar dashboard-list is hidden at `max-width: 768px`, and `PanelGrid` mounts `MobilePanelStack` → `PanelCardBody`, which omits the kebab), so no kebab is rendered at ≤768px and the floor applies only if that chrome is ever shown at the mobile breakpoint. Desktop (>768px) trigger size SHALL be unchanged (its call-site host overrides render it at 24px in panel-card / dashboard-list rows).

#### Scenario: Kebab trigger carries the mobile tap-target floor

- **WHEN** the `.actions-menu__trigger` rule inside the `max-width: 768px` media block is inspected
- **THEN** its computed `min-width` and `min-height` are each 44px (guarded by the `ActionsMenu.css` CSS-lock test), so any kebab shown at ≤768px would meet the ≥44px floor

#### Scenario: Kebab is not a rendered phone surface

- **WHEN** the phone shell is rendered at a 390px-wide viewport (either theme)
- **THEN** no `.actions-menu__trigger` is mounted (its host chrome is hidden/replaced below 768px), so there is no rendered kebab element at ≤44px on the phone shell

#### Scenario: Desktop size preserved

- **WHEN** the kebab is rendered at a desktop viewport (>768px), where it is visible
- **THEN** it renders at its pre-change 24px call-site size (no mobile-block rule applies outside `max-width: 768px`)

### Requirement: bare ui-select trigger meets the 44px mobile tap-target minimum

The shared bare `ui-select` trigger (`.ui-select__trigger` in `frontend/src/shared/ui/inputs.css`) SHALL render with a minimum height of 44px at the mobile-shell breakpoint (`max-width: 768px`), with its label vertically centered. Desktop (>768px) trigger height SHALL be unchanged from its pre-change `--control-md` (32px) value. `.panel-detail-modal`-scoped trigger overrides SHALL be left untouched.

#### Scenario: Select trigger at a phone viewport

- **WHEN** a bare `ui-select` trigger (outside `.panel-detail-modal`) is rendered at a 390px-wide
  viewport (either theme)
- **THEN** its `getBoundingClientRect().height` is ≥ 44px

#### Scenario: Desktop height preserved

- **WHEN** the same trigger is rendered at a desktop viewport (>768px)
- **THEN** it renders at its pre-change 32px height

### Requirement: CSS-lock tests guard the mobile trigger rules

Static CSS-lock tests SHALL assert that the `max-width: 768px` media blocks in `ActionsMenu.css` and
`inputs.css` keep the `min-height: 44px` (and, for the kebab, `min-width: 44px`) rules for
`.actions-menu__trigger` and `.ui-select__trigger`, following the `PanelDetailModal.css.test.ts`
precedent.

#### Scenario: Mobile trigger rule removed

- **WHEN** the mobile ≥44px rule for either trigger selector is removed or its media block's breakpoint
  is changed away from `max-width: 768px`
- **THEN** the corresponding CSS-lock test fails

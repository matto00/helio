## ADDED Requirements

### Requirement: modal close button meets the 44px mobile tap-target minimum

The shared modal close button (`.ui-modal__close` in `frontend/src/shared/ui/Modal.css`) SHALL carry a
`min-width: 44px; min-height: 44px` rule inside the mobile-shell breakpoint (`max-width: 768px`) media
block, keeping its glyph centered. Desktop (>768px) size SHALL be unchanged from its pre-change
`--control-sm` (28px) value.

#### Scenario: Close button at a phone viewport

- **WHEN** a shared modal is open at a 390px-wide viewport (either theme) on a bottom-nav
  create/empty-state route
- **THEN** the `.ui-modal__close` button's `getBoundingClientRect()` width and height are each ≥ 44px

#### Scenario: Desktop size preserved

- **WHEN** the same modal is open at a desktop viewport (>768px)
- **THEN** the close button renders at its pre-change 28px size (no mobile-block rule applies outside
  `max-width: 768px`)

### Requirement: modal footer button meets the 44px mobile tap-target minimum

The shared modal footer button (`.ui-modal-btn` in `frontend/src/shared/ui/Modal.css`) SHALL render
with a minimum height of 44px at the mobile-shell breakpoint (`max-width: 768px`), with its label
vertically centered. Desktop (>768px) height SHALL be unchanged from its pre-change `--control-md`
(32px) value.

#### Scenario: Footer button at a phone viewport

- **WHEN** a shared modal with footer buttons is open at a 390px-wide viewport (either theme)
- **THEN** each `.ui-modal-btn`'s `getBoundingClientRect().height` is ≥ 44px

#### Scenario: Desktop height preserved

- **WHEN** the same modal is open at a desktop viewport (>768px)
- **THEN** footer buttons render at their pre-change 32px height

### Requirement: empty-state CTA meets the 44px mobile tap-target minimum

The shared empty-state CTA (`.ui-empty-state__cta` in `frontend/src/shared/ui/EmptyState.css`) SHALL
render with a minimum height of 44px at the mobile-shell breakpoint (`max-width: 768px`), with its
label vertically centered. Desktop (>768px) height SHALL be unchanged from its pre-change `--control-md`
(32px) value. The rule applies to the base selector, defensively flooring the sidebar variant (which is
not mounted at ≤768px).

#### Scenario: CTA at a phone viewport

- **WHEN** a bottom-nav create/empty-state route renders an `EmptyState` with a CTA at a 390px-wide
  viewport (either theme)
- **THEN** the `.ui-empty-state__cta`'s `getBoundingClientRect().height` is ≥ 44px

#### Scenario: Desktop height preserved

- **WHEN** the same empty-state is rendered at a desktop viewport (>768px)
- **THEN** the main-variant CTA renders at its pre-change 32px height

### Requirement: CSS-lock tests guard the mobile modal and empty-state rules

Static CSS-lock tests SHALL assert that the `max-width: 768px` media blocks in `Modal.css` and
`EmptyState.css` keep the `min-height: 44px` (and, for `.ui-modal__close`, `min-width: 44px`) rules for
`.ui-modal__close`, `.ui-modal-btn`, and `.ui-empty-state__cta`, following the `inputs.css.test.ts`
precedent.

#### Scenario: Mobile rule removed

- **WHEN** the mobile ≥44px rule for any of the three selectors is removed or its media block's
  breakpoint is changed away from `max-width: 768px`
- **THEN** the corresponding CSS-lock test fails

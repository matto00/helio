## ADDED Requirements

### Requirement: Panel-detail modal stylesheet SHALL respect the file-size budget

The panel-detail modal styles SHALL be split across sibling stylesheets such that no single
CSS file exceeds the ~400-line soft budget. All files introduced by the split SHALL also
respect this budget.

#### Scenario: No modal stylesheet exceeds the soft budget

- **WHEN** the split is applied
- **THEN** each `PanelDetailModal*.css` file SHALL be at or under ~400 lines

#### Scenario: New split files stay within budget

- **WHEN** new sibling stylesheets are created by the split
- **THEN** each new file SHALL be at or under ~400 lines

### Requirement: Modal spacing SHALL use design tokens where an exact token exists

The panel-detail modal stylesheets SHALL express each spacing declaration (margin, padding,
gap, or inset) as a DESIGN.md space token whenever a token value is exactly equal to the
literal. Values with no exact token, small optical tweaks of 4px or less, control and tap
dimensions, and border widths MAY remain literal.

#### Scenario: Exact-equal spacing literals are tokenized

- **WHEN** a spacing declaration equals a `--space-*` token value (4/8/12/16/20/24/32/40/48/64px)
- **THEN** that declaration SHALL reference the `--space-*` token rather than the literal

#### Scenario: Non-exact spacing literals are preserved

- **WHEN** a spacing value has no exactly-equal `--space-*` token
- **THEN** that value MAY remain a literal and SHALL NOT be rounded to a nearby token

### Requirement: The split SHALL be behavior-preserving and keep the mobile tap-target locks

The refactor SHALL NOT change rendered appearance beyond exact token equivalents, and SHALL
preserve the mobile ≥44px tap-target overrides guarded by `PanelDetailModal.css.test.ts`.

#### Scenario: Mobile ≥44px CSS-lock tests still pass

- **WHEN** the CSS-lock test suite runs after the split
- **THEN** every locked selector SHALL still carry its mobile-scoped `min-height`/`min-width: 44px`
  override in a single `@media (max-width: 768px)` block, and the test `CSS_PATH` SHALL target
  the file that holds that block

#### Scenario: Rendering is pixel-identical

- **WHEN** the modal is screenshotted at desktop and 390×844 in both themes, before and after
- **THEN** the after image SHALL be visually identical to the before image

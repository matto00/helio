## ADDED Requirements

### Requirement: Panel-list controls meet the mobile touch-target floor

The panel-list "Add panel" button and its zoom-widget siblings SHALL render at least 44px tall and 44px wide at viewport widths of 768px and below, matching the floor convention established in `EmptyState.css:219-228`.

#### Scenario: Add-panel button meets the floor at 768px and 430px

- **WHEN** the panel list is rendered at a 768px or 430px viewport width
- **THEN** `.panel-list__add`'s rendered height (`getBoundingClientRect().height`) is >= 44px

#### Scenario: Zoom-widget controls meet the floor within their visible range

- **WHEN** the panel list is rendered at a viewport width between 431px and 768px (the range in
  which `.panel-list__zoom-widget` is visible)
- **THEN** `.panel-list__zoom-button` and `.panel-list__zoom-reset`'s rendered heights AND widths
  are both >= 44px

#### Scenario: Non-floored control stays unfloored (probe discriminates)

- **WHEN** a control not covered by this requirement (e.g. `.panel-list__count`, a non-interactive
  badge) is measured at the same viewport widths
- **THEN** its rendered height remains at its unfloored value, proving the measurement probe
  actually discriminates floored from unfloored controls rather than trivially passing

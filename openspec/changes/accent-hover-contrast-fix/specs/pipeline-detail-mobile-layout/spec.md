## MODIFIED Requirements

### Requirement: Phone touch floor and state contrast
Every interactive element on the phone page, in each tab and in the open step sheet, SHALL meet the 44px touch floor
at 375, 390 and 768px wide, verified with the shared touch-target probe and tap-expander utilities. Phone hover, focus
and pressed states of the new controls SHALL clear a 1.10 state-surface ratio against their backdrop, 4.5:1 for text
and 3:1 for non-text indicators, measured from rendered pixels in both themes, with no named exception: the Run
pipeline pill's hover text SHALL clear 4.5:1 in both themes like every other state. The Dry run pill's hover fill SHALL
also differ from its own rest fill by at least 1.10:1 in both themes, so the hover is visibly distinct.

#### Scenario: Touch floor sweep
- **WHEN** the touch-target probe sweeps the Steps tab and the open sheet at 375px
- **THEN** every interactive element's hit area is at least 44×44px

#### Scenario: Run pipeline pill hover text has no exception
- **WHEN** the Run pipeline pill is hovered in the light and the dark theme
- **THEN** its text measures at least 4.5:1 against the rendered hover fill

#### Scenario: Dry run hover is distinct from rest
- **WHEN** the Dry run pill is hovered in the light and the dark theme
- **THEN** the rendered hover fill measures at least 1.10:1 against the rendered rest fill

## ADDED Requirements

### Requirement: The accent ink clears 4.5:1 on the accent hover fill

`--app-accent-ink` SHALL clear the WCAG AA text floor of 4.5:1 against `--app-accent-strong` (the primary-button hover
fill) for each shipped accent preset, in both themes, as rendered after the runtime accent tokens are applied. The
hover fill SHALL move away from the ink (lighter for a dark ink, darker for a light ink) so the hover never erodes the
ink's contrast below its rest-state contrast. There SHALL be no named exception for this pair.

#### Scenario: Every shipped preset in both themes
- **WHEN** the accent tokens are derived for each shipped accent preset in the light and the dark theme
- **THEN** the derived ink measures at least 4.5:1 against the derived hover fill

#### Scenario: Hover never lowers ink contrast
- **WHEN** the accent tokens are derived for any valid accent colour
- **THEN** the ink's contrast against the hover fill is at least its contrast against the rest accent fill

#### Scenario: Running app, primary button hover
- **WHEN** a primary button is hovered in the running app on desktop and on a phone viewport, in light and in dark
- **THEN** its text measures at least 4.5:1 against its rendered hover fill

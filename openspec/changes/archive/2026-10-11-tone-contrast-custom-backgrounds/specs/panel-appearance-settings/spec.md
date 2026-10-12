## ADDED Requirements

### Requirement: Custom panel backgrounds keep secondary and delta text readable
On a panel whose appearance has a custom (non-transparent) background, the metric unit and label SHALL measure at
least 4.5:1 against the panel's resolved surface in both themes, while still following the panel's text colour (a
higher share of the panel text colour, never a different hue). The metric delta colours (trend and comparison
`up`, `down`, `flat`) SHALL measure at least 4.5:1 against that surface, using the same readable-variant rule as
conditional-format tones (token unchanged when it passes, otherwise a darker or lighter step of it). No editor warning
SHALL be shown. A panel with no custom background SHALL render these exactly as before.

#### Scenario: Metric unit and label pass on a light-theme custom background
- **WHEN** a metric with a unit and label is shown on a light-theme panel whose background is `#3366ff`
- **THEN** the unit and label each measure at least 4.5:1 against the panel surface

#### Scenario: Delta colour auto-adjusts
- **WHEN** a metric's comparison is `down` on a light-theme panel whose background is `#000000`
- **THEN** the delta text measures at least 4.5:1 against the panel surface and stays in the error hue family

#### Scenario: Default panels keep the theme tokens
- **WHEN** a panel has background `transparent`
- **THEN** the unit/label mix equals `--panel-secondary-text-mix` and the delta colours equal their theme tokens

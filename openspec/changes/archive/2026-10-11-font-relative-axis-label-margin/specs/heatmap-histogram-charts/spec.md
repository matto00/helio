## ADDED Requirements

### Requirement: Heatmap and histogram axes show every label that fits

A heatmap's column (x) and row (y) axes and a histogram's bin (x) axis SHALL show every category label that does not
collide with a neighbouring shown label, rather than thinning labels at a fixed interval. A label that would collide
SHALL be hidden; shown labels SHALL never overlap. On the x axis, horizontally neighbouring shown labels SHALL keep a
minimum gap proportional to the label font size: at least 14 px at the default 12 px font and at least 12 px at the
10 px compact (mobile) font. This SHALL hold in light and dark themes. Time axes and other chart types are unchanged.

#### Scenario: Seven heatmap days at mobile width

- **WHEN** a heatmap with seven day columns (Mon..Sun) is shown at a 375 px or 1440 px viewport, with three or six rows
- **THEN** all seven day labels are shown and no two overlap

#### Scenario: Ten histogram bins at desktop width

- **WHEN** a 10-bin histogram on a full-width card is shown at a 1440 px viewport
- **THEN** all ten bin labels are shown

#### Scenario: Labels never run together

- **WHEN** a histogram's bin labels are too wide for every one to fit
- **THEN** some labels are hidden, and every pair of neighbouring shown labels is at least 14 px apart when the
  labels use the 12 px font and at least 12 px apart when they use the 10 px compact font

#### Scenario: Time axes keep their own label behaviour

- **WHEN** a line chart plots a time x axis
- **THEN** its labels behave as before this change (overlap hiding, no added margin)

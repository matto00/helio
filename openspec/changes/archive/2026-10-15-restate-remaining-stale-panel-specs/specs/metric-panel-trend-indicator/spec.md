## MODIFIED Requirements

### Requirement: Metric panel renders trend indicator when trend data is present
`MetricRenderer` SHALL support a legacy `trend` string in its `data` map. When the `data` map contains a `trend` key,
the renderer SHALL render a `.panel-content__metric-trend` element after the label. The element SHALL display the trend
string value and receive a directional modifier class based on the string's leading character:
- Starts with `+`: class `panel-content__metric-trend--up` (success tone)
- Starts with `-`: class `panel-content__metric-trend--down` (error tone)
- Otherwise: class `panel-content__metric-trend--flat` (muted color)

When `trend` is absent or falsy the trend element SHALL NOT be rendered. This path is renderer-level only: no
production caller supplies `data.trend` (the Output-bound metric builds `{ value, label, unit }`, and
`MetricOutputConfig` has no `trend` field), so an `output` panel never renders it; the history comparison marker
(`metric-history-delta-ui`) reuses the same element classes for its own delta text.

#### Scenario: Trend indicator renders for positive trend
- **WHEN** `MetricRenderer` receives `data.trend = "+3.2%"`
- **THEN** a `.panel-content__metric-trend.panel-content__metric-trend--up` element is rendered containing "+3.2%"

#### Scenario: Trend indicator renders for negative trend
- **WHEN** `MetricRenderer` receives `data.trend = "-1.1%"`
- **THEN** a `.panel-content__metric-trend.panel-content__metric-trend--down` element is rendered containing "-1.1%"

#### Scenario: Trend indicator renders for flat/neutral trend
- **WHEN** `MetricRenderer` receives `data.trend = "0%"`
- **THEN** a `.panel-content__metric-trend.panel-content__metric-trend--flat` element is rendered containing "0%"

#### Scenario: Trend indicator absent when no trend field
- **WHEN** `MetricRenderer`'s data does not contain a `trend` key
- **THEN** no `.panel-content__metric-trend` element is rendered for a `trend` string

### Requirement: Trend indicator font-size scales with container query breakpoints
The trend indicator font-size SHALL be `var(--text-micro)` (0.625rem) at default height. At compact height (container
`height < 180px`) it SHALL be `var(--text-micro)`. At spacious height (container `height >= 280px`) it SHALL be
`var(--text-xs)` (0.75rem).

#### Scenario: Trend indicator at default panel height
- **WHEN** the metric panel container height is between 180px and 279px
- **THEN** `.panel-content__metric-trend` font-size SHALL be `var(--text-micro)`

#### Scenario: Trend indicator at compact panel height
- **WHEN** the metric panel container height is less than 180px
- **THEN** `.panel-content__metric-trend` font-size SHALL be `var(--text-micro)`

#### Scenario: Trend indicator at spacious panel height
- **WHEN** the metric panel container height is at least 280px
- **THEN** `.panel-content__metric-trend` font-size SHALL be `var(--text-xs)`

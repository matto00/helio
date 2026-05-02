## ADDED Requirements

### Requirement: Metric panel renders trend indicator when trend data is present
When the bound `MappedPanelData` map contains a `trend` key, the metric panel SHALL render a
`.panel-content__metric-trend` element below the label. The element SHALL display the trend string
value and receive a directional modifier class based on the string's leading character:
- Starts with `+`: class `panel-content__metric-trend--up` (green accent color)
- Starts with `-`: class `panel-content__metric-trend--down` (danger/red color)
- Otherwise: class `panel-content__metric-trend--flat` (muted color)

When `trend` is absent or falsy the trend element SHALL NOT be rendered.

#### Scenario: Trend indicator renders for positive trend
- **WHEN** a bound metric panel has `data.trend = "+3.2%"`
- **THEN** a `.panel-content__metric-trend.panel-content__metric-trend--up` element is rendered containing "+3.2%"

#### Scenario: Trend indicator renders for negative trend
- **WHEN** a bound metric panel has `data.trend = "-1.1%"`
- **THEN** a `.panel-content__metric-trend.panel-content__metric-trend--down` element is rendered containing "-1.1%"

#### Scenario: Trend indicator renders for flat/neutral trend
- **WHEN** a bound metric panel has `data.trend = "0%"`
- **THEN** a `.panel-content__metric-trend.panel-content__metric-trend--flat` element is rendered containing "0%"

#### Scenario: Trend indicator absent when no trend field
- **WHEN** a bound metric panel's data does not contain a `trend` key
- **THEN** no `.panel-content__metric-trend` element is rendered

### Requirement: Trend indicator font-size scales with container query breakpoints
The trend indicator font-size SHALL be `0.7rem` at default height. At compact height (container
`height < 180px`) it SHALL be `0.6rem`. At spacious height (container `height >= 280px`) it SHALL
be `0.8rem`.

#### Scenario: Trend indicator at default panel height
- **WHEN** the metric panel container height is between 180px and 279px
- **THEN** `.panel-content__metric-trend` font-size SHALL be `0.7rem`

#### Scenario: Trend indicator at compact panel height
- **WHEN** the metric panel container height is less than 180px
- **THEN** `.panel-content__metric-trend` font-size SHALL be `0.6rem`

#### Scenario: Trend indicator at spacious panel height
- **WHEN** the metric panel container height is at least 280px
- **THEN** `.panel-content__metric-trend` font-size SHALL be `0.8rem`

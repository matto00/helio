# mobile-panel-sizing Specification

## Purpose
Give phone-width panels content-appropriate per-kind heights, density, and chrome so dashboards feel native rather than like a squashed desktop grid.
## Requirements
### Requirement: Stack panel heights are content-appropriate per panel kind
In the phone stack, panel heights SHALL be derived from the panel kind — never from the desktop formula
`h × rowHeight`. The stored `h` SHALL only modulate within a kind's clamped band. Per-kind policy (starting
values, expected to be tuned on device):

- `metric`: content-sized within ~104–132px; `h` is ignored entirely.
- `chart`: aspect-driven `clamp(200px, w × 0.62, 340px)` where `w` is panel content width; `h ≤ 4` selects
  the compact end of the band, `h ≥ 8` the tall end.
- `table`: capped at `min(60dvh, header + rows × rowHeight)`; scrolls internally beyond the cap.
- `text` and `markdown`: fully intrinsic — no fixed height, no cap, no internal scroll.
- `image`: natural aspect ratio, `max-width: 100%`, `height: auto`.
- `divider`: intrinsic hairline with no card chrome (no header, no footer).
- `collection`: fully intrinsic — no fixed height, no internal scroll; the item grid wraps to the
  stack's content width (an explicit policy entry, not a fall-through default).

The per-kind policy SHALL live in a single pure module so device-tuning is a one-file change.

#### Scenario: Metric panel is not mostly whitespace
- **WHEN** a metric panel with stored `h = 5` renders in the stack
- **THEN** its height is content-sized within the metric band (~104–132px), not `5 × 52px`

#### Scenario: Chart height respects the clamped aspect band
- **WHEN** a chart panel renders in the stack at content width `w`
- **THEN** its height is within `clamp(200px, w × 0.62, 340px)`
- **AND** a chart with `h ≤ 4` is shorter than a chart with `h ≥ 8` at the same width

#### Scenario: Markdown flows with the page
- **WHEN** a markdown panel with long content renders in the stack
- **THEN** the panel grows to its intrinsic content height with no internal scrollbar

#### Scenario: Collection sizes intrinsically in the stack
- **WHEN** a collection panel with several metric items renders in the stack at phone width
- **THEN** the panel grows to its intrinsic content height with no internal scrollbar
- **AND** the item grid wraps within the stack content width with no horizontal body scroll

### Requirement: Only tables may scroll internally
In the phone stack, the table panel SHALL be the only panel kind with a nested scroll container. Tables SHALL
scroll horizontally within the panel (`overflow-x: auto` on the panel-internal scroller); the page body MUST
never scroll horizontally. Long words, code blocks, and wide images in other panel kinds MUST NOT force
horizontal body scroll.

#### Scenario: Wide table scrolls inside its panel
- **WHEN** a table wider than the viewport renders in the stack
- **THEN** the table scrolls horizontally within its panel
- **AND** the document body does not scroll horizontally

#### Scenario: Non-table content never introduces a nested scroller
- **WHEN** markdown with long unbroken words or code blocks renders in the stack
- **THEN** content wraps or scrolls within its own content box without horizontal body scroll
- **AND** no nested vertical scroll container exists outside the table panel

### Requirement: Phone density and chrome below the ratified phone breakpoint
Below the 430px phone breakpoint (ratified in `DESIGN.md` §4), dashboard chrome SHALL tighten using design
tokens only: `--space-3` (12px) rhythm between cards and for container padding; the panel card footer's type
badge and drag affordances SHALL be hidden; panel title and data freshness SHALL remain. Metric value
typography SHALL come from the `DESIGN.md` type scale with tabular numerals and MUST NOT clip or wrap for
long values (e.g. `1,234,567.89`).

#### Scenario: Card gutters use token rhythm on phone
- **WHEN** the stack renders below the phone breakpoint
- **THEN** inter-card spacing and container padding use `--space-3`

#### Scenario: Card chrome trimmed on phone
- **WHEN** a panel card renders below the phone breakpoint
- **THEN** the footer type badge and drag handle are not visible
- **AND** the panel title and freshness indicator remain visible

#### Scenario: Long metric value does not clip
- **WHEN** a metric panel renders a value like `1,234,567.89` below the phone breakpoint
- **THEN** the value renders fully without clipping or wrapping

### Requirement: Chart rendering adapts at phone widths
ECharts panels SHALL resize when their container size changes (including device rotation). Legend and axis
overflow at phone widths SHALL be handled via ECharts configuration, not CSS overflow.

#### Scenario: Container size change triggers chart resize
- **WHEN** a chart panel's container changes size while mounted in the stack
- **THEN** the ECharts instance resizes to fit the new container dimensions


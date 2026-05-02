## MODIFIED Requirements

### Requirement: Text panel container query overrides
The text panel font-size SHALL respond to the panel container dimensions via container query
breakpoints using the `panel-card` named container:

Compact breakpoint (container `height < 180px`):
- `.panel-content__text-live` font-size SHALL be `0.78rem`

Default (no container query override, height 180px–279px):
- `.panel-content__text-live` font-size is `0.9rem` (base style)

Spacious breakpoint (container `height >= 280px`):
- `.panel-content__text-live` font-size SHALL be `1.1rem`

Additionally, `.panel-content--text` SHALL have `overflow-y: auto` so that text content
is scrollable rather than clipped when it exceeds the available panel height.

#### Scenario: Text panel in compact height
- **WHEN** the panel container height is less than `180px`
- **THEN** `.panel-content__text-live` SHALL have `font-size: 0.78rem`

#### Scenario: Text panel at default height
- **WHEN** the panel container height is between 180px and 279px (inclusive)
- **THEN** `.panel-content__text-live` SHALL have `font-size: 0.9rem` with no container query override active

#### Scenario: Text panel in spacious height
- **WHEN** the panel container height is at least `280px`
- **THEN** `.panel-content__text-live` SHALL have `font-size: 1.1rem`

#### Scenario: Text panel content overflow
- **WHEN** a text panel has content that exceeds the available height at any font-size
- **THEN** the `.panel-content--text` element SHALL scroll rather than clip or overflow the panel boundary

## MODIFIED Requirements

### Requirement: Text panel sizing
The text panel (`panel-content--text`) SHALL use `padding: 12px 16px` (inherited from `.panel-content`),
`gap: 8px` between lines, and `overflow-y: auto` to confine content within the panel boundary.
Live content SHALL use font-size that scales with the container height via container queries
(defined in the `panel-container-queries` spec):
- Compact (`height < 180px`): `0.78rem`
- Default (`height 180px–279px`): `0.9rem`
- Spacious (`height >= 280px`): `1.1rem`

Placeholder skeleton lines SHALL be `height: 10px` with `border-radius: 4px`: the long line at
85% width and the short line at 60% width.

#### Scenario: Text panel with bound data at default height
- **WHEN** a text panel has bound content at the default height (180px–279px)
- **THEN** the text SHALL render at `0.9rem` left-aligned with `white-space: pre-wrap`
- **AND** the content fills the panel width and wraps naturally at the container boundary

#### Scenario: Text panel with bound data at spacious height
- **WHEN** a text panel has bound content and the container height is >= 280px
- **THEN** the text SHALL render at `1.1rem`

#### Scenario: Text panel sparseness at default height
- **WHEN** a text panel is rendered at the default height with short text content
- **THEN** a single short string occupies < 20px of content area, classified as SPARSE

#### Scenario: Text panel content overflow at spacious height
- **WHEN** a text panel has long content and the container height is >= 280px
- **THEN** the `.panel-content--text` element scrolls rather than overflowing the panel boundary

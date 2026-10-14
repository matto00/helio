## REMOVED Requirements

### Requirement: Text panel sizing
**Reason**: Its two text-panel "bound data" scenarios describe a DataType data binding text panels no longer have (pipelines-and-outputs remodel, HEL-903/904); openspec refuses a MODIFIED block that drops a scenario.
**Migration**: Replaced by "Text panel sizing for literal content", which keeps the sizing rules and the still-true scenarios, restates the bound-data scenarios against literal `config.content`, and corrects the font-size, and skeleton-radius values to what `PanelContent.css` and `theme.css` actually define (`var(--text-xs|sm|lg)`, `var(--app-radius-sm)`, not the stale rem/px literals); the single-line height (about 18px) is unchanged from the old "< 20px" claim.

## ADDED Requirements

### Requirement: Text panel sizing for literal content
The text panel (`panel-content--text`) SHALL use `padding: 12px 16px` (inherited from `.panel-content`),
`gap: 8px` between lines, and `overflow-y: auto` to confine content within the panel boundary.
Live content SHALL use font-size that scales with the container height via container queries
(defined in the `panel-container-queries` spec):
- Compact (`height < 180px`): `var(--text-xs)` (`0.75rem`)
- Default (`height 180px–279px`): `var(--text-sm)` (`0.875rem`)
- Spacious (`height >= 280px`): `var(--text-lg)` (`1.125rem`)

Placeholder skeleton lines SHALL be `height: 10px` with `border-radius: var(--app-radius-sm)` (`6px`): the long line at
85% width and the short line at 60% width.

A text panel's live content is its own literal `config.content`; a text panel has no data binding, and no fetched row
data SHALL change what it renders.

#### Scenario: Text panel with literal content at default height
- **WHEN** a text panel has non-empty `config.content` at the default height (180px–279px)
- **THEN** the text SHALL render at `var(--text-sm)` (`0.875rem`) left-aligned with `white-space: pre-wrap`
- **AND** the content fills the panel width and wraps naturally at the container boundary

#### Scenario: Text panel with literal content at spacious height
- **WHEN** a text panel has non-empty `config.content` and the container height is >= 280px
- **THEN** the text SHALL render at `var(--text-lg)` (`1.125rem`)

#### Scenario: Text panel sparseness at default height
- **WHEN** a text panel is rendered at the default height with short text content
- **THEN** a single short string occupies one line of about 18px (`var(--text-sm)` at the computed `line-height: normal`), far below 60% of the content area, classified as SPARSE

#### Scenario: Text panel content overflow at spacious height
- **WHEN** a text panel has long content and the container height is >= 280px
- **THEN** the `.panel-content--text` element scrolls rather than overflowing the panel boundary

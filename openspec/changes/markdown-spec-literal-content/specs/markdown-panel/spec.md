## REMOVED Requirements

### Requirement: Markdown panel renders CommonMark HTML in the dashboard grid

**Reason**: It resolved content from "the bound DataType field's value" and carried the scenario "Grid renders bound
content when panel is bound". DataTypes and the markdown Source (field-bound) mode no longer exist (HEL-904,
HEL-909, HEL-1139); a MODIFIED delta cannot drop a scenario, so the requirement is replaced.
**Migration**: Superseded by "Markdown panel renders its literal content as CommonMark HTML in the dashboard grid"
below, which keeps every still-true scenario and replaces the bound-content one.

## ADDED Requirements

### Requirement: Markdown panel renders its literal content as CommonMark HTML in the dashboard grid

In the dashboard grid, a markdown panel SHALL render its literal content as CommonMark-compliant HTML. The literal
content is the panel's own `config.content` for a markdown panel, or the placed Output's `config.content` for a
panel that places a `markdown`-kind Output. Markdown content SHALL NOT be resolved from a data field or row: neither
a markdown panel nor a markdown Output has a data binding, and a `fieldMapping` stored on a markdown Output SHALL NOT
change what is rendered. The rendered output SHALL be read-only (not directly editable in the grid). Image references
using the `helio://uploads/image/<id>` scheme SHALL render as the uploaded asset (see the
`markdown-panel-content-source` capability for the scheme's rules).

#### Scenario: Grid renders markdown content as HTML
- **WHEN** a markdown panel with non-empty content is displayed in the grid
- **THEN** the panel body shows rendered HTML (headings, paragraphs, lists) derived from the content

#### Scenario: Placed markdown Output renders its literal content
- **WHEN** a panel placing a `markdown`-kind Output is displayed in the grid
- **THEN** the panel body renders that Output's `config.content` as Markdown, and a `fieldMapping` stored on that
  Output does not change what is rendered

#### Scenario: Grid renders empty markdown panel with placeholder
- **WHEN** a markdown panel has null or empty content
- **THEN** the panel body shows a faded placeholder ("No content yet. Open panel settings to add markdown.")

#### Scenario: Grid renders an uploaded-image reference
- **WHEN** a markdown panel's content contains `![alt](helio://uploads/image/<id>)` for an existing
  upload
- **THEN** the panel body shows the uploaded image, served from `/api/uploads/image/<id>`

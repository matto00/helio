## MODIFIED Requirements

### Requirement: Per-kind option sets
The sheet SHALL show kind-specific option groups: chart type/axes/legend for `chart`; collection
layout for `collection`; timeline sort for `timeline`; table columns/density for `table`; a
literal markdown Content editor for `markdown` (no row binding — see "Markdown Output Content is
literal-only"); a number `format` for `metric`.

#### Scenario: Switching kind swaps the option group
- **WHEN** a user changes an Output's kind from `chart` to `table`
- **THEN** the sheet replaces the chart option group with the table column/density option group

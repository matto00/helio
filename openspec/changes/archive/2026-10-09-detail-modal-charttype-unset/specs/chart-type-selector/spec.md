## ADDED Requirements

### Requirement: Panel detail modal never seeds an implicit chart type
The panel detail modal's chart-appearance edit state MUST carry a `chartType` only when the panel's stored
`appearance.chart.chartType` is set, and then MUST carry that stored value unchanged. When the panel stores no
`chartType`, the edit state MUST leave `chartType` unset (never defaulting it to `line` or any other value), so the
effective type keeps resolving panel, then the bound Output's `config.chartType`, then `line`. Saving the modal MUST NOT
send a `chartType` the panel did not already store.

#### Scenario: Panel without a stored chart type bound to a bar Output
- **GIVEN** an output panel with no stored `appearance.chart.chartType`, bound to an Output whose `config.chartType` is `bar`
- **WHEN** the panel detail modal is opened
- **THEN** the modal's initial chart-appearance edit state has no `chartType`
- **AND WHEN** the user edits the title and saves
- **THEN** the save payload contains no `appearance.chart` and no `chartType`

#### Scenario: Stored panel chart type is preserved
- **GIVEN** a panel whose stored `appearance.chart.chartType` is `pie`
- **WHEN** the panel detail modal is opened
- **THEN** the modal's initial chart-appearance edit state has `chartType` `pie`

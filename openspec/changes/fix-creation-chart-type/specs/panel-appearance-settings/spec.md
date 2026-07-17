# panel-appearance-settings — delta (HEL-305)

## ADDED Requirements

### Requirement: Appearance writes validate chart type

The system MUST reject an `appearance.chart.chartType` outside the allowed set (`bar`, `line`,
`pie`, `scatter`) with a 400 whose message names the valid values, on all three panel appearance
write paths: `POST /api/panels` (optional create-time `appearance`), `PATCH /api/panels/:id`, and
`POST /api/panels/updateBatch` (the path the live edit UI uses). Batch validation MUST run before
the transactional write so an invalid item rejects the whole batch with no partial write. An absent
`chartType` SHALL remain valid (renderers fall back to line).

#### Scenario: PATCH with invalid chartType is rejected

- **WHEN** a client PATCHes a panel with `appearance.chart.chartType: "donut"`
- **THEN** the request is rejected with a 400 naming the valid values
- **AND** the stored appearance is unchanged

#### Scenario: PATCH with valid chartType persists

- **WHEN** a client PATCHes a panel with `appearance.chart.chartType: "scatter"`
- **THEN** the stored appearance carries `chart.chartType: "scatter"`

#### Scenario: Create with invalid chartType is rejected

- **WHEN** a create request includes `appearance.chart.chartType: "donut"`
- **THEN** the request is rejected with a 400 naming the valid values

#### Scenario: Batch update with invalid chartType is rejected with no partial write

- **WHEN** a `POST /api/panels/updateBatch` request contains one item with
  `appearance.chart.chartType: "donut"` alongside otherwise-valid items
- **THEN** the request is rejected with a 400 naming the valid values
- **AND** no item in the batch is persisted

#### Scenario: Batch update with valid chartType persists

- **WHEN** a batch item carries `appearance.chart.chartType: "pie"`
- **THEN** the stored appearance for that panel carries `chart.chartType: "pie"`

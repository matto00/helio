## ADDED Requirements

### Requirement: Config-patch batch updates persist every typed-config column
When `POST /api/panels/updateBatch` is called with `fields: ["config"]`, the backend MUST persist
every typed-config column produced for the patched panel — including `aggregation` for metric and
chart panels — not a fixed subset. The set of columns written by the batch config-patch path MUST
be the same set written by the single-panel replace path (`PanelRepository.replace`), sourced from
one shared definition, so the two paths cannot silently diverge as new config columns are added.

#### Scenario: Batch config patch persists a metric panel's aggregation spec
- **GIVEN** a metric panel with no `aggregation` set
- **WHEN** a client sends `POST /api/panels/updateBatch` with
  `fields: ["config"], panels: [{ id: "p1", config: { aggregation: { value: "rating", agg: "avg" } } }]`
- **THEN** the panel's `aggregation` column is persisted and a subsequent read of the panel reflects
  `{ value: "rating", agg: "avg" }`

#### Scenario: Batch config patch persists a chart panel's aggregation spec
- **GIVEN** a chart panel with no `aggregation` set
- **WHEN** a client sends `POST /api/panels/updateBatch` with
  `fields: ["config"], panels: [{ id: "p1", config: { aggregation: { groupBy: "year", agg: "avg", yField: "rating" } } }]`
- **THEN** the panel's `aggregation` column is persisted and a subsequent read of the panel reflects
  `{ groupBy: "year", agg: "avg", yField: "rating" }`

#### Scenario: Batch config-patch column set stays in parity with the single-panel replace path
- **WHEN** a new typed-config column is added to `PanelRow` and the single-panel replace path is
  updated to write it
- **THEN** the batch config-patch path, sourced from the same shared column-list definition, writes
  that column too without requiring a separate manual edit

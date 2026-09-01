## MODIFIED Requirements

### Requirement: Config-patch batch updates persist every typed-config column
When `POST /api/panels/updateBatch` is called with `fields: ["config"]`, the backend MUST persist
every typed-config column produced for the patched panel — placement fields (`outputId`, `title`,
`appearance`) for an output panel, or the relevant content columns for a content panel — not a
fixed subset. The set of columns written by the batch config-patch path MUST be the same set
written by the single-panel replace path (`PanelRepository.replace`), sourced from one shared
definition, so the two paths cannot silently diverge as new config columns are added. Aggregation
is no longer a panel-level concept (HEL-292 is retired; see `panel-viz-aggregation`'s removal) —
these scenarios are retargeted to the surviving output-placement fields.

#### Scenario: Batch config patch persists a metric panel's aggregation spec
- **GIVEN** an output panel with no title override set
- **WHEN** a client sends `POST /api/panels/updateBatch` with
  `fields: ["config"], panels: [{ id: "p1", config: { title: "Q3 Revenue" } }]`
- **THEN** the panel's `title` column is persisted and a subsequent read of the panel reflects
  `"Q3 Revenue"`

#### Scenario: Batch config patch persists a chart panel's aggregation spec
- **GIVEN** an output panel with no appearance override set
- **WHEN** a client sends `POST /api/panels/updateBatch` with
  `fields: ["config"], panels: [{ id: "p1", config: { appearance: { accentColor: "#3366ff" } } }]`
- **THEN** the panel's `appearance` column is persisted and a subsequent read of the panel reflects
  `{ accentColor: "#3366ff" }`

#### Scenario: Batch config-patch column set stays in parity with the single-panel replace path
- **WHEN** a new typed-config column is added to `PanelRow` and the single-panel replace path is
  updated to write it
- **THEN** the batch config-patch path, sourced from the same shared column-list definition, writes
  that column too without requiring a separate manual edit

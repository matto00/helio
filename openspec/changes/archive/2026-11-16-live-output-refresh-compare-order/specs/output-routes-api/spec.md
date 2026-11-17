## ADDED Requirements

### Requirement: Rows responses are in the Output's schema order
`GET /api/outputs/:id/rows`, `GET /api/dashboards/:dashboardId/panels/:panelId/rows` and `GET /api/outputs/:id/history/:point/rows` SHALL write each row's keys in the Output's declared schema order, then any key the schema does not name in ascending code-point order, and SHALL carry a `columns` array in that same order: the schema names present in at least one row of the page (every schema name on an empty page), then the other keys seen on the page. `columns` reveals nothing the Output's rows do not already expose. Clients SHALL build column order from `columns`, not from the order of a parsed row's keys or a natural sort. This changes the default column order of existing panels with no column config or no x-axis mapping from alphabetical to schema order.

#### Scenario: Wire key order
- **WHEN** an Output's schema is `zeta, 10, alpha` and its rows are read
- **THEN** each row's keys appear in the response body in the order `zeta, 10, alpha` and `columns` is `["zeta", "10", "alpha"]`

#### Scenario: Key outside the schema
- **WHEN** a stored row holds a key the Output's schema does not name
- **THEN** that key follows the schema columns, in ascending code-point order, in both the row and `columns`

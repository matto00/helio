## ADDED Requirements

### Requirement: Inspect view columns follow the Output's columnOrder, then its declared schema order

The inspect view SHALL order its grid columns using the bound Output's own metadata, never alphabetically: first the
keys of the Output config's non-empty `columnOrder` that are present in the listed rows, in `columnOrder` order; then
the remaining fields of the Output's declared `schema` that are present in the rows, in schema order; then any other
keys present in the rows, in natural order. The inspect view SHALL NOT omit any column present in the listed rows —
`columnOrder` orders columns here but never hides them. The ordering inputs SHALL come from the Output metadata the
panel already resolves, with no additional network request.

#### Scenario: Schema order when no columnOrder is set
- **WHEN** a chart Output declares schema `date, category, merchant, amount_usd`, has no `columnOrder`, and the user
  opens the inspect view for a selection
- **THEN** the inspect grid's columns are `date, category, merchant, amount_usd` in that order

#### Scenario: columnOrder takes precedence over schema order
- **WHEN** the Output's config carries `columnOrder: ["merchant", "date"]` and its schema is
  `date, category, merchant, amount_usd`
- **THEN** the inspect grid's columns are `merchant, date, category, amount_usd`

#### Scenario: Stale and undeclared keys
- **WHEN** `columnOrder` or the schema names a field absent from the listed rows, and the rows carry a key the schema
  does not declare
- **THEN** the absent field renders no column, and the undeclared key still renders, after all ordered columns

#### Scenario: Aggregate-group inspect uses the same order
- **WHEN** the chart renders the Output's aggregation and the user inspects a clicked group
- **THEN** the listed records' columns follow the same order as the raw-row inspect path

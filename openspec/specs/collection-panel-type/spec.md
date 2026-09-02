# collection-panel-type Specification

## Purpose
Defines the `collection` panel kind: its config shape (base type, shared field mapping, layout, per-base-type item options), persistence contract, and the rule that adding future base types requires no schema changes.

## Requirements

### Requirement: Base-type extensibility requires no schema change
Adding a future base type SHALL require no database migration: `baseType` is an open string on the
wire (validated by the JSON Schema enum, `["metric"]` today), and per-base-type shared options live
under `itemOptions.<baseType>` keys inside the existing JSONB column. For the `metric` base type,
`itemOptions.metric` SHALL support literal `label` and `unit` overrides.

#### Scenario: Metric item options round-trip
- **WHEN** a collection panel is saved with `itemOptions: { metric: { unit: "$" } }`
- **THEN** a subsequent fetch returns the same `itemOptions.metric.unit` value

#### Scenario: Options under a non-active base type key are preserved
- **WHEN** a stored `itemOptions` object carries a key other than the active `baseType`
- **THEN** reads and unrelated patches preserve that key's contents unchanged

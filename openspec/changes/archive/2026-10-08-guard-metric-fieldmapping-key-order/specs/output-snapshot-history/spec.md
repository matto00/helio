## MODIFIED Requirements

### Requirement: Metric field selection never picks a label or unit mapping
The history summary's metric field SHALL resolve to the config's `fieldMapping.value` when it is a non-empty string,
otherwise to `aggregation.value` when it is a non-empty string, otherwise to no field. A `fieldMapping.label` or
`fieldMapping.unit` entry SHALL never be selected as the metric field, whether or not it is the only mapping. With no
field, the summary's `metric` SHALL be `null`. The client's mirror of this rule SHALL resolve identically. Selection
SHALL depend only on the mapping's key names, never on the order its keys appear in, since a stored config's key
order is not preserved across a database round-trip.

#### Scenario: Aggregated metric with a mapped label
- **WHEN** a metric Output's config is `fieldMapping: {label: "region"}` and `aggregation: {value: "amount", agg: "sum"}`
- **THEN** the stored summary metric is `{field: "amount", agg: "sum", value: <sum of amount>}`, never computed over `region`

#### Scenario: Lone label mapping with no metric field
- **WHEN** a metric Output's config is `fieldMapping: {label: "region"}` with no `fieldMapping.value` and no `aggregation.value`
- **THEN** the stored summary's `metric` is `null`, not `0`

#### Scenario: Lone unit mapping with no metric field
- **WHEN** a metric Output's config is `fieldMapping: {unit: "currency"}` and `aggregation: {agg: "sum"}` with no value
- **THEN** the stored summary's `metric` is `null`

#### Scenario: Client resolves identically
- **WHEN** the client resolves the metric field for any of the configs above
- **THEN** it returns the same field as the server, or no field where the server stores `null`

#### Scenario: Label or unit mapped before value
- **WHEN** a metric Output's `fieldMapping` lists `label` and/or `unit` before `value` (e.g. `{label: "region", value: "amount"}`,
  the order a database round-trip returns), on the server or the client
- **THEN** the metric field resolves to the `value` column, and the summary value, the full-filtered-set metric and the
  panel's displayed value are identical to those for the same mapping with `value` listed first

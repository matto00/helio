## ADDED Requirements

### Requirement: Text panel joins the bound-capable panel set

`TextPanelConfig` SHALL carry `dataTypeId` (string) and `fieldMapping` (object) fields, mirroring
`MetricPanelConfig`'s shape. A Text panel with `dataTypeId` set SHALL build a `PanelQuery` (via
`Panel.buildQuery`) selecting the field named in `fieldMapping.content`, identical in shape to how
Metric/Chart/Table build their queries from their own field mappings.

#### Scenario: Text panel config accepts dataTypeId and fieldMapping
- **WHEN** `POST /api/panels` is called with `type: "text"` and `config: { "dataTypeId": "<type-id>",
  "fieldMapping": { "content": "headline" } }`
- **THEN** the response's `config` includes `dataTypeId` and `fieldMapping` as sent

#### Scenario: Bound Text panel builds a query for its mapped field
- **WHEN** a Text panel has `dataTypeId` and `fieldMapping.content` set
- **THEN** `GET /api/panels/:id/query` returns rows selecting the mapped field, matching the existing
  Metric/Chart/Table query-building behavior

#### Scenario: Unbound Text panel has no query
- **WHEN** a Text panel has no `dataTypeId` set
- **THEN** `GET /api/panels/:id/query` returns 404 "Panel is not bound to a data type", matching existing
  unbound-panel behavior for every other panel kind

### Requirement: Text panel binding persists via existing generic columns

Text panel `dataTypeId`/`fieldMapping` SHALL persist through the `panels` table's existing generic
`type_id`/`field_mapping` columns (already used by Metric/Chart/Table) — no new database column or
migration is introduced.

#### Scenario: Text panel binding survives a round-trip
- **WHEN** a Text panel is bound to a DataType via `PATCH /api/panels/:id` and then retrieved via
  `GET /api/dashboards/:id/panels`
- **THEN** the response's `config.dataTypeId`/`config.fieldMapping` match what was persisted

### Requirement: Clearing a Text panel's binding preserves its literal content

Unbinding a Text panel SHALL clear only `dataTypeId`/`fieldMapping`, leaving `config.content` unchanged.
This applies to both an explicit `null` PATCH and a binding scrub via `withBindingCleared`, and diverges
from Metric's `withBindingCleared`, which resets its entire config (including literal label/unit
overrides).

#### Scenario: Explicit unbind via PATCH preserves literal content
- **WHEN** `PATCH /api/panels/:id` is called on a bound Text panel with `config: { "dataTypeId": null,
  "fieldMapping": null }`
- **THEN** the response's `config.content` is unchanged from before the request

#### Scenario: Cross-user binding scrub preserves literal content
- **WHEN** `PanelService.resolveBindingsForRead` scrubs a Text panel's binding (the bound DataType is no
  longer accessible to the caller)
- **THEN** the returned panel has `dataTypeId`/`fieldMapping` cleared but `config.content` unchanged

## ADDED Requirements

### Requirement: Markdown panel joins the bound-capable panel set

`MarkdownPanelConfig` SHALL carry `dataTypeId` (string) and `fieldMapping` (object) fields, mirroring
`TextPanelConfig`'s shape (HEL-244). A Markdown panel with `dataTypeId` set SHALL build a `PanelQuery`
(via `Panel.buildQuery`) selecting the field named in `fieldMapping.content`, identical in shape to the
Text panel's query building.

#### Scenario: Markdown panel config accepts dataTypeId and fieldMapping
- **WHEN** `POST /api/panels` is called with `type: "markdown"` and `config: { "dataTypeId":
  "<type-id>", "fieldMapping": { "content": "summary_md" } }`
- **THEN** the response's `config` includes `dataTypeId` and `fieldMapping` as sent

#### Scenario: Bound Markdown panel builds a query for its mapped field
- **WHEN** a Markdown panel has `dataTypeId` and `fieldMapping.content` set
- **THEN** `GET /api/panels/:id/query` returns rows selecting the mapped field, matching the existing
  Text-panel query-building behavior

#### Scenario: Unbound Markdown panel has no query
- **WHEN** a Markdown panel has no `dataTypeId` set
- **THEN** `GET /api/panels/:id/query` returns 404 "Panel is not bound to a data type", matching existing
  unbound-panel behavior for every other panel kind

### Requirement: Markdown panel binding persists via existing generic columns

Markdown panel `dataTypeId`/`fieldMapping` SHALL persist through the `panels` table's existing generic
`type_id`/`field_mapping` columns (already used by Metric/Chart/Table/Text) — no new database column or
migration is introduced.

#### Scenario: Markdown panel binding survives a round-trip
- **WHEN** a Markdown panel is bound to a DataType via `PATCH /api/panels/:id` and then retrieved via
  `GET /api/dashboards/:id/panels`
- **THEN** the retrieved panel's `config` includes the bound `dataTypeId` and `fieldMapping`

#### Scenario: Legacy content-only markdown config decodes as unbound
- **WHEN** a pre-existing Markdown panel whose stored config JSON contains only `content` is read
- **THEN** it decodes with empty `dataTypeId`/`fieldMapping` (unbound) and its content renders unchanged

### Requirement: Clearing a Markdown panel's binding preserves its literal content

Unbinding a Markdown panel SHALL clear only `dataTypeId`/`fieldMapping`, leaving `config.content`
unchanged — matching the Text panel's divergence from Metric's blanket config reset. Patch semantics
SHALL follow the absent-vs-null convention: a field absent from the PATCH `config` leaves the stored
value unchanged; an explicit `null` clears it.

#### Scenario: Explicit null clears the binding but not content
- **WHEN** `PATCH /api/panels/:id` is called on a bound Markdown panel with `config: { "dataTypeId":
  null, "fieldMapping": null }`
- **THEN** the response's `config` has empty `dataTypeId`/`fieldMapping` and the previously stored
  `content` intact

#### Scenario: Absent fields leave the binding unchanged
- **WHEN** `PATCH /api/panels/:id` is called on a bound Markdown panel with `config: { "content":
  "# updated" }` (no `dataTypeId`/`fieldMapping` keys present)
- **THEN** the stored binding is preserved and only `content` changes

#### Scenario: Binding scrub preserves markdown content
- **WHEN** `PanelService.resolveBindingsForRead` scrubs a Markdown panel's binding (the bound DataType
  no longer exists)
- **THEN** the returned panel is unbound but `config.content` is unchanged

# collection-panel-type Specification

## Purpose
Defines the `collection` panel kind: its config shape (base type, shared field mapping, layout, per-base-type item options), persistence contract, and the rule that adding future base types requires no schema changes.
## Requirements
### Requirement: Collection is a persisted panel kind
The system SHALL support `collection` as a panel `type` value end-to-end: `POST /api/panels` and
`PATCH /api/panels/:id` SHALL accept it, and panel responses SHALL carry `type: "collection"` with a
typed `config` object.

#### Scenario: Create a collection panel
- **WHEN** `POST /api/panels` is called with `type: "collection"` and a config carrying `dataTypeId`
- **THEN** the response has `type: "collection"` and a `config` object echoing the binding

#### Scenario: Collection panels round-trip through list responses
- **WHEN** a dashboard containing a collection panel is fetched via the panels list endpoint
- **THEN** the collection panel is returned with `type: "collection"` and its full `config`

### Requirement: Collection config shape with tolerant defaults
`CollectionPanelConfig` SHALL carry: `dataTypeId` (string), `fieldMapping` (object — the shared
mapping applied to every item), `baseType` (string), `layout` (`"grid"` | `"list"`), and optional
`itemOptions` (object keyed per base type). Absent or malformed collection options SHALL decode to
defaults — `baseType: "metric"`, `layout: "grid"`, no `itemOptions` — never an error response. The
binding SHALL persist in the existing `type_id` / `field_mapping` columns; collection-specific
concerns SHALL persist in a single nullable `collection_options` JSONB column (NULL = defaults).

#### Scenario: Create with empty config yields defaults
- **WHEN** a collection panel is created with `config: {}`
- **THEN** the response config has `baseType: "metric"` and `layout: "grid"`

#### Scenario: Optional fields absent on the wire decode to defaults
- **WHEN** a create or update payload omits `baseType`, `layout`, and `itemOptions` entirely
  (spray-json omits `None` — fields are absent, not null)
- **THEN** decoding succeeds and absent fields resolve to their defaults, leaving present fields intact

#### Scenario: Malformed stored options do not 500
- **WHEN** a panel row holds a malformed or legacy `collection_options` value
- **THEN** the panels list request returns 200 and the panel decodes with default collection options

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

### Requirement: Collection config PATCH follows absent-vs-null semantics
`PATCH /api/panels/:id` config patches for collection panels SHALL treat an absent field as
"unchanged", an explicit `null` as "clear to default", and a value as "set" — for `dataTypeId`,
`fieldMapping`, `baseType`, `layout`, and `itemOptions` alike.

#### Scenario: Layout-only patch leaves binding untouched
- **WHEN** a PATCH config carries only `layout: "list"`
- **THEN** the response shows `layout: "list"` with `dataTypeId`, `fieldMapping`, `baseType`, and
  `itemOptions` unchanged

#### Scenario: Null itemOptions clears stored options
- **WHEN** a PATCH config carries `itemOptions: null`
- **THEN** the stored options are cleared and the response omits `itemOptions`

### Requirement: Collection config survives duplication and export
Panel duplication and dashboard export/import SHALL preserve the full collection config —
`dataTypeId`, `fieldMapping`, `baseType`, `layout`, and `itemOptions` — through both mapper
directions (row→domain and domain→row).

#### Scenario: Duplicating a collection panel preserves its config
- **WHEN** `POST /api/panels/:id/duplicate` is called on a configured collection panel
- **THEN** the duplicate's config equals the original's (binding, base type, layout, item options)

### Requirement: Collection appears in every panel-type contract surface

Every contract surface that enumerates panel `type` values SHALL include `collection`, matching the
backend `PanelType` canonical set. This covers the JSON Schemas
`create-panel-request.schema.json`, `panel.schema.json`, `update-panels-batch-request.schema.json`,
and `dashboard-proposal.schema.json`, and the helio-mcp proposal tool's `PANEL_TYPES` enum. Every
surface that enumerates *data-panel* kinds (kinds requiring a bound DataType) SHALL include
`collection`, matching the backend `DataPanelKinds` set — this covers helio-mcp's `DATA_PANEL_TYPES`
and the Proposal Review UI's `DATA_PANEL_TYPES` (`ProposalReview.tsx`), which drives the "needs bound
DataType" warning. A CI schema-parity check SHALL fail when any of these surfaces diverges from the
backend canonical sets, so a newly added panel type cannot ship without updating every surface.

#### Scenario: Batch update accepts a collection panel

- **WHEN** an `update-panels-batch-request` payload contains an item with `type: "collection"`
- **THEN** the JSON Schema validates the payload as conformant

#### Scenario: A dashboard proposal may contain a collection panel

- **WHEN** a `dashboard-proposal` payload contains a panel with `type: "collection"`
- **THEN** the JSON Schema validates the payload as conformant

#### Scenario: helio-mcp propose tool accepts collection panels

- **WHEN** the helio-mcp proposal tool validates a panel with `type: "collection"`
- **THEN** the panel passes the tool's panel-type validation and is treated as a data panel
  (requiring `dataTypeId`), matching the backend

#### Scenario: Proposal Review UI flags an unbound collection panel

- **WHEN** a proposal containing a collection panel with no bound DataType is shown in the Proposal
  Review UI
- **THEN** the panel is treated as a data panel and surfaces the "needs bound DataType" warning,
  rather than rendering as if no binding is required

#### Scenario: Parity check fails on a missing panel type

- **WHEN** any enumerating surface omits a panel type present in the backend `PanelType` canonical set
- **THEN** the `npm run check:schemas` parity check exits non-zero and names the diverging surface


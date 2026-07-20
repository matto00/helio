## ADDED Requirements

### Requirement: Timeline is a persisted panel kind

The system SHALL support `timeline` as a panel `type` value end-to-end: `POST /api/panels` and
`PATCH /api/panels/:id` SHALL accept it, and panel responses SHALL carry `type: "timeline"` with a
typed `config` object.

#### Scenario: Create a timeline panel

- **WHEN** `POST /api/panels` is called with `type: "timeline"` and a config carrying `dataTypeId`
- **THEN** the response has `type: "timeline"` and a `config` object echoing the binding

#### Scenario: Timeline panels round-trip through list responses

- **WHEN** a dashboard containing a timeline panel is fetched via the panels list endpoint
- **THEN** the timeline panel is returned with `type: "timeline"` and its full `config`

### Requirement: Timeline config shape with tolerant defaults

`TimelinePanelConfig` SHALL carry: `dataTypeId` (string), `fieldMapping` (object binding the `time`
and `event` slots), and optional `timelineOptions` (object) with a `sort` field
(`"asc"` | `"desc"`, default `"asc"`) controlling chronological order. Absent or malformed timeline
options SHALL decode to defaults (`sort: "asc"`, no options), never an error response. The binding
SHALL persist in the existing `type_id` / `field_mapping` columns; timeline-specific concerns SHALL
persist in a single nullable `timeline_options` JSONB column (NULL = defaults), mirroring the
`collection_options` precedent.

#### Scenario: Create with empty config yields defaults

- **WHEN** a timeline panel is created with `config: {}`
- **THEN** the response config resolves `sort` to `"asc"` with an empty binding

#### Scenario: Optional fields absent on the wire decode to defaults

- **WHEN** a create or update payload omits `timelineOptions` entirely (spray-json omits `None` —
  the field is absent, not null)
- **THEN** decoding succeeds and the absent field resolves to its default, leaving present fields intact

#### Scenario: Malformed stored options do not 500

- **WHEN** a panel row holds a malformed or legacy `timeline_options` value
- **THEN** the panels list request returns 200 and the panel decodes with default timeline options

#### Scenario: Invalid sort on the create path is rejected

- **WHEN** `POST /api/panels` is called with `type: "timeline"` and `timelineOptions.sort` set to a
  value outside `{"asc", "desc"}`
- **THEN** the request is rejected with 400 and a curated error message naming the valid values

### Requirement: Timeline config PATCH follows absent-vs-null semantics

`PATCH /api/panels/:id` config patches for timeline panels SHALL treat an absent field as
"unchanged", an explicit `null` as "clear to default", and a value as "set" — for `dataTypeId`,
`fieldMapping`, and `timelineOptions` alike.

#### Scenario: Options-only patch leaves binding untouched

- **WHEN** a PATCH config carries only `timelineOptions: { sort: "desc" }`
- **THEN** the response shows `sort: "desc"` with `dataTypeId` and `fieldMapping` unchanged

#### Scenario: Null timelineOptions clears stored options

- **WHEN** a PATCH config carries `timelineOptions: null`
- **THEN** the stored options are cleared and the response resolves `sort` back to its default

### Requirement: Timeline config survives duplication and export

Panel duplication and dashboard export/import SHALL preserve the full timeline config —
`dataTypeId`, `fieldMapping`, and `timelineOptions` — through both mapper directions (row→domain
and domain→row).

#### Scenario: Duplicating a timeline panel preserves its config

- **WHEN** `POST /api/panels/:id/duplicate` is called on a configured timeline panel
- **THEN** the duplicate's config equals the original's (binding and timeline options)

### Requirement: Timeline appears in every panel-type contract surface

Every contract surface that enumerates panel `type` values SHALL include `timeline`, matching the
backend `PanelType` canonical set. This covers the JSON Schema (`schemas/panel.schema.json` panel
`type` enum plus a `TimelineConfig` `$def`) and the helio-mcp `create_panel` / `bind_panel` tool
type enums, so agent-driven dashboards can create and bind timeline panels.

#### Scenario: JSON Schema enumerates timeline

- **WHEN** `schemas/panel.schema.json` is inspected
- **THEN** the panel `type` enum includes `"timeline"` and a `TimelineConfig` definition describes
  its config shape

#### Scenario: MCP tools accept timeline

- **WHEN** the helio-mcp `create_panel` and `bind_panel` tool type enums are inspected
- **THEN** both include `"timeline"` so a timeline panel can be created and bound via MCP

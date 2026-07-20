## ADDED Requirements

### Requirement: propose_dashboard exposes the v1.5 panel type set

The MCP `propose_dashboard` and `apply_proposal` tools SHALL accept the panel `type` set
`metric/chart/table/text/markdown/image/collection` and SHALL NOT offer `divider`, matching
`create_panel`'s type set for agent/UI parity (mirroring HEL-249 / HEL-315). No stale type list
SHALL remain in the proposal flow's tool schemas or descriptions. The `dashboard-proposal.schema.json`
`ProposalPanel.type` enum SHALL likewise drop `divider`.

#### Scenario: Divider is not offered in the proposal flow
- **WHEN** an agent inspects the `propose_dashboard`/`apply_proposal` panel `type` enum
- **THEN** `divider` is absent from the accepted values and only the seven proposable types remain

#### Scenario: Collection is proposable
- **WHEN** an agent calls `propose_dashboard` with a panel of `type: "collection"`
- **THEN** the tool accepts it and the assembled proposal carries the collection panel

### Requirement: Proposal panels accept a generic config passthrough

Each proposal panel SHALL accept an optional generic `config` object that is carried through
`apply_proposal` to `POST /api/dashboards/apply-proposal` and merged into the config the backend
derives from the flat fields, then decoded by the SAME panel-create path (`PanelConfigCodec`). This
SHALL make every v1.5 config surface expressible via a proposal — collection `baseType`/`layout`,
chart `chartOptions` (per chart type), table `density`/`columnOrder`, and text/markdown content
binding. On key conflict the explicit `config` SHALL win over a derived flat field, EXCEPT that a
data panel's server-resolved `dataTypeId` binding SHALL remain authoritative so the V41 pipeline-only
binding guarantee cannot be bypassed via `config`.

#### Scenario: Collection base type and layout via proposal config
- **WHEN** an agent applies a proposal whose collection panel supplies
  `config: { baseType: "metric", layout: "grid" }` and a valid `dataTypeId`
- **THEN** the applied panel persists as a collection with that base type and layout, bound to the
  DataType

#### Scenario: Chart chartOptions via proposal config
- **WHEN** an agent applies a proposal whose chart panel supplies
  `config: { chartOptions: { smooth: true } }` alongside its binding
- **THEN** the applied chart panel persists with those chart options

#### Scenario: config cannot bypass pipeline-only binding
- **WHEN** an agent applies a proposal whose data panel `config` attempts to override `dataTypeId`
  with a source-companion (non-pipeline-output) DataType id
- **THEN** the flat-field binding remains authoritative and the V41 pipeline-only rule is still
  enforced

### Requirement: Proposal config passthrough is backward compatible

The `config` field SHALL be optional and additive: a proposal carrying only the existing flat fields
(and no `config`) SHALL produce byte-for-byte the same created panels as before this change. The
shared in-app Proposal Review UI, which posts to the same endpoint, SHALL continue to round-trip
proposals unchanged.

#### Scenario: Flat-field-only proposal is unchanged
- **WHEN** an agent applies a proposal whose panels use only the flat fields (`fieldMapping`,
  `aggregation`, `content`, `chartType`, etc.) and no `config`
- **THEN** the created dashboard and panels are identical to the pre-change behavior

#### Scenario: Proposal Review UI still round-trips
- **WHEN** a proposal is applied through the in-app Proposal Review UI
- **THEN** the dashboard and its panels are created correctly with no regression

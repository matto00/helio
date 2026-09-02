## MODIFIED Requirements

### Requirement: Proposal panels accept a generic config passthrough

Each proposal panel SHALL accept an optional generic `config` object that is carried through
`apply_proposal` to `POST /api/dashboards/apply-proposal` and merged into the config the backend
derives from the flat fields, then decoded by the SAME panel-create path (`PanelConfigCodec`). This
SHALL make every v1.5 config surface expressible via a proposal — collection `baseType`/`layout`,
chart `chartOptions` (per chart type), table `density`/`columnOrder`, and text/markdown content
binding. On key conflict the explicit `config` SHALL win over a derived flat field, EXCEPT that a
data panel's server-resolved `outputId` binding SHALL remain authoritative so the V41 pipeline-only
binding guarantee cannot be bypassed via `config`.

#### Scenario: Collection base type and layout via proposal config
- **WHEN** an agent applies a proposal whose collection panel supplies
  `config: { baseType: "metric", layout: "grid" }` and a valid `outputId`
- **THEN** the applied panel persists as a collection with that base type and layout, bound to the
  DataType

#### Scenario: Chart chartOptions via proposal config
- **WHEN** an agent applies a proposal whose chart panel supplies
  `config: { chartOptions: { smooth: true } }` alongside its binding
- **THEN** the applied chart panel persists with those chart options

#### Scenario: config cannot bypass pipeline-only binding
- **WHEN** an agent applies a proposal whose data panel `config` attempts to override `outputId`
  with a source-companion (non-pipeline-output) DataType id
- **THEN** the flat-field binding remains authoritative and the V41 pipeline-only rule is still
  enforced

### Requirement: Proposal panels derive a timeline binding from flat fields

The proposal flow SHALL let a `timeline` panel express its full binding through flat fields alone,
at parity with `metric`/`collection`. A `timeline` proposal panel with a `outputId` and a
`fieldMapping` binding the `time` and `event` slots SHALL apply to a bound, rendering Timeline panel
without requiring the generic `config` passthrough. The proposal panel contract SHALL additionally
accept an optional flat `sort` field (`"asc"` | `"desc"`); when present on a `timeline` panel,
`DashboardProposalService` SHALL derive it into the panel's `config.timelineOptions.sort` so it is
decoded by the same panel-create path (`PanelConfigCodec`) as any other timeline config. An invalid
flat `sort` value SHALL be rejected up front (before any dashboard or panel is created), mirroring the
existing `chartType` / `orientation` pre-create checks. The helio-mcp `propose_dashboard` tool schema
and description, the `dashboard-proposal.schema.json` `ProposalPanel` definition, and the helio-mcp
`ProposalPanel` type SHALL advertise the flat `sort` field and describe timeline binding accurately.

#### Scenario: Timeline binding via flat fields only

- **WHEN** an agent applies a proposal whose `timeline` panel supplies a valid `outputId` and a
  `fieldMapping` of `{ time, event }` and no `config`
- **THEN** the applied panel persists as a bound timeline panel whose `config` carries that
  `outputId` and `fieldMapping`, with `sort` resolving to its default `"asc"`

#### Scenario: Timeline sort via the flat field

- **WHEN** an agent applies a proposal whose `timeline` panel supplies `sort: "desc"` alongside its
  binding and no `config`
- **THEN** the applied panel persists with `config.timelineOptions.sort` equal to `"desc"`

#### Scenario: Invalid flat sort rejects the whole proposal

- **WHEN** an agent applies a proposal whose `timeline` panel supplies a `sort` value outside
  `{ "asc", "desc" }`
- **THEN** the request is rejected with a 400 and no dashboard or panel is created

#### Scenario: Explicit config still overrides the flat sort

- **WHEN** an agent applies a proposal whose `timeline` panel supplies `sort: "asc"` and also
  `config: { timelineOptions: { sort: "desc" } }`
- **THEN** the applied panel persists with `config.timelineOptions.sort` equal to `"desc"` (explicit
  `config` wins over the flat-derived value)

#### Scenario: Proposal tool advertises the flat sort field

- **WHEN** an agent inspects the `propose_dashboard` tool schema/description and
  `dashboard-proposal.schema.json`
- **THEN** the flat `sort` field (`"asc"` | `"desc"`) is present and the timeline binding guidance
  describes it as a flat field rather than requiring `config`

### Requirement: Proposal panels accept an optional metricId bound via the existing HEL-500 config path

Proposal panels SHALL accept an optional `metricId` (string) on the `propose_dashboard`/
`apply_proposal` `panelSchema` (`helio-mcp/src/tools/proposal.ts`), the helio-mcp `ProposalPanel` type
(`types.ts`), and the backend `ProposalPanel` protocol (`DashboardProposalProtocol.scala`), additive to
the existing flat fields. `outputId` SHALL remain required for `metric`/`chart`/`table` proposal panels
exactly as today — `metricId` does not relax that requirement. When present and valid,
`ProposalPanelSupport.buildCreateRequest`/`buildDataConfig` SHALL include `metricId` in the created
panel's config, reusing the same `MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig` `metricId`
slot HEL-500 already validates and materializes at read time. `schemas/dashboards/dashboard-proposal.schema.json`
SHALL document the field. The `propose_dashboard` tool's `description` string SHALL document `metricId`
per-type (mirroring the existing `label`/`unit` bullet for `metric`) — the zod schema itself carries no
per-field `.describe()`, so this is the only place a calling agent can discover the capability. A
proposal supplying only the pre-existing flat fields (no `metricId`) SHALL behave byte-for-byte as
before this change.

#### Scenario: Proposal panel with a valid metricId is created bound to that metric

- **WHEN** an agent applies a proposal whose `metric` panel supplies a valid `outputId`,
  `fieldMapping`, and a `metricId` resolving to a metric the caller owns
- **THEN** the created panel's `config.metricId` is set to that id

#### Scenario: Proposal without metricId is unchanged

- **WHEN** an agent applies a proposal whose panels use only the pre-existing flat fields and no
  `metricId`
- **THEN** the created dashboard and panels are identical to the pre-change behavior

#### Scenario: Tool description documents metricId

- **WHEN** an agent inspects the `propose_dashboard` tool's description
- **THEN** it documents that `metric`/`chart`/`table` panels may supply `metricId` to bind to a
  defined metric, alongside the existing per-type field guidance


## ADDED Requirements

### Requirement: Proposal panels derive a timeline binding from flat fields

The proposal flow SHALL let a `timeline` panel express its full binding through flat fields alone,
at parity with `metric`/`collection`. A `timeline` proposal panel with a `dataTypeId` and a
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

- **WHEN** an agent applies a proposal whose `timeline` panel supplies a valid `dataTypeId` and a
  `fieldMapping` of `{ time, event }` and no `config`
- **THEN** the applied panel persists as a bound timeline panel whose `config` carries that
  `dataTypeId` and `fieldMapping`, with `sort` resolving to its default `"asc"`

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

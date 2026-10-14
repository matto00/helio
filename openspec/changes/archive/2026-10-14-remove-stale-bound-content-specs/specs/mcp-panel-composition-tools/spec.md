## REMOVED Requirements

### Requirement: propose_dashboard exposes the v1.5 panel type set
**Reason**: States a `metric/chart/table/text/markdown/image/collection` type set and a "Collection is proposable" scenario; `collection` and the metric/chart/table kinds were deleted (HEL-904) and the current set is `text/markdown/image/output/form`.
**Migration**: Replaced by "propose_dashboard exposes the current agent-facing panel type set".

### Requirement: Proposal panels accept a generic config passthrough
**Reason**: Its scenarios describe a `collection` panel "bound to the DataType", a `chart` panel's `chartOptions`, and a "source-companion (non-pipeline-output) DataType id"; none of those panel kinds or DataType ids exist on the proposal wire any more.
**Migration**: Replaced by "Proposal panels accept a generic config passthrough for current panel types", which keeps the merge and binding-authority rules and restates the scenarios against the current kinds.

## ADDED Requirements

### Requirement: propose_dashboard exposes the current agent-facing panel type set

The MCP `propose_dashboard` and `apply_proposal` tools SHALL accept the panel `type` set
`text/markdown/image/output/form` and SHALL NOT offer `divider`, which is excluded from the agent-facing proposal set
for a stated product-scope reason (purely presentational layout chrome with no content, binding or data an agent can
author) recorded in the repository's agent-surface exclusion table. The panel kinds
`metric`, `chart`, `table`, `collection` and `timeline` no longer exist and SHALL NOT be offered. No stale type list
SHALL remain in the proposal flow's tool schemas or descriptions. The `dashboard-proposal.schema.json`
`ProposalPanel.type` enum SHALL be exactly the same set.

#### Scenario: Divider is not offered in the proposal flow
- **WHEN** an agent inspects the `propose_dashboard`/`apply_proposal` panel `type` enum
- **THEN** `divider` is absent from the accepted values and only the five proposable types remain

#### Scenario: Deleted panel kinds are not proposable
- **WHEN** an agent calls `propose_dashboard` with a panel of `type: "collection"` (or `metric`, `chart`, `table`,
  `timeline`)
- **THEN** the tool rejects the panel's `type` as outside the accepted set

#### Scenario: Output panel is proposable
- **WHEN** an agent calls `propose_dashboard` with a panel of `type: "output"` and a valid, caller-owned `outputId`
- **THEN** the tool accepts it and the assembled proposal carries the output panel

### Requirement: Proposal panels accept a generic config passthrough for current panel types

Each proposal panel SHALL accept an optional generic `config` object that is carried through
`apply_proposal` to `POST /api/dashboards/apply-proposal` and merged into the config the backend
derives from the flat fields, then decoded by the SAME panel-create path (`PanelConfigCodec`). This
SHALL make every current panel config surface expressible via a proposal — for example text/markdown literal
`content` and image `imageUrl`/`caption`. On key conflict the explicit `config` SHALL win over a derived flat field,
EXCEPT that an `output` panel's flat `outputId` binding (and a `form` panel's flat `dataSourceId`) SHALL remain
authoritative, so the V41 pipeline-only binding guarantee cannot be bypassed via `config`.

#### Scenario: Literal markdown content via proposal config
- **WHEN** an agent applies a proposal whose markdown panel supplies `config: { content: "# Notes" }`
- **THEN** the applied panel persists as a markdown panel whose `config.content` is `"# Notes"`

#### Scenario: Output panel binding via proposal
- **WHEN** an agent applies a proposal whose `output` panel supplies a valid flat `outputId`
- **THEN** the applied panel persists as an output panel whose `config.outputId` is that Output id

#### Scenario: config cannot bypass pipeline-only binding
- **WHEN** an agent applies a proposal whose `output` panel `config` attempts to override `outputId` with a different
  id than the panel's flat `outputId`
- **THEN** the flat-field `outputId` remains authoritative and the V41 pipeline-only rule is still enforced

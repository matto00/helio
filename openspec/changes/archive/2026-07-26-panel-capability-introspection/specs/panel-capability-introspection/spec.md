## ADDED Requirements

### Requirement: Panel-capability introspection endpoint
The system SHALL expose `GET /api/types/:id/panel-capabilities`, returning for the owner-scoped DataType
identified by `:id` the set of data-bindable panel kinds (`metric`, `chart`, `table`, `collection`,
`timeline`) that are structurally bindable, each kind's required/optional `fieldMapping` slots, the
eligible columns per slot, and coarse shape signals (column list with types, row count, single-row flag,
whether the type is a pipeline output).

#### Scenario: Numeric multi-row pipeline-output type
- **WHEN** a caller requests capabilities for a pipeline-output DataType with multiple rows and at least
  one numeric column
- **THEN** the response marks `chart`, `table`, `metric`, and `collection` as `bindable: true`, each with
  its required/optional slots and the columns eligible for each slot

#### Scenario: Companion DataType reports no bindable data panels
- **WHEN** a caller requests capabilities for a DataType with a non-null `sourceId` (a source companion)
- **THEN** every one of the five panel kinds is `bindable: false` with a reason identifying it as a
  non-pipeline-output type (V41), matching what a bind attempt against that DataType would reject

#### Scenario: Timestamp-bearing type is timeline-eligible
- **WHEN** a caller requests capabilities for a pipeline-output DataType that has a timestamp (or other
  orderable) column and at least one other column
- **THEN** `timeline` is `bindable: true` with `time` and `event` required slots, and the timestamp/orderable
  column(s) listed as eligible for `time`

#### Scenario: Single-numeric-column multi-row type is metric-eligible
- **WHEN** a caller requests capabilities for a pipeline-output DataType with many rows and exactly one
  numeric column (post-HEL-292 aggregation applies across all bound rows)
- **THEN** `metric` is `bindable: true` — bindability does not require exactly one row

### Requirement: Panel-capability lookup is owner-scoped
The system SHALL resolve the DataType by id scoped to the requesting user's ownership, returning 404 when
the DataType does not exist or belongs to a different owner — never a 403 that would leak cross-tenant
existence.

#### Scenario: Cross-tenant request returns 404
- **WHEN** user B requests panel capabilities for a DataType id owned by user A
- **THEN** the response is 404 Not Found, not 403 Forbidden

### Requirement: Slot definitions share one source of truth
The system SHALL define each bindable panel kind's required/optional `fieldMapping` slots in exactly one
backend location (`PanelBindingSpec`), consumed by the panel-capabilities endpoint, so the endpoint's
advertised slots cannot silently drift from the documented binding contract (`bind_panel`'s MCP tool
description and the frontend's `PANEL_SLOTS` map).

#### Scenario: Slot sets match the documented binding contract
- **WHEN** `PanelBindingSpec`'s slot set for `chart` (excluding the separately-merged `annotation` slot)
  and `timeline` is compared against the corresponding live-wired entries in the frontend's `PANEL_SLOTS`
  map, and `collection`'s slot set is compared against both `PanelBindingSpec.metric` and the hardcoded
  item-field keys in `CollectionEditor.tsx`
- **THEN** the sets match for every compared panel kind

### Requirement: MCP capability tool
The system SHALL provide an MCP read tool, `get_panel_capabilities`, that accepts a DataType id and returns
the panel-capabilities response so an external agent can build its offers menu from the server instead of
re-deriving Helio's binding rules.

#### Scenario: Agent queries capabilities via MCP
- **WHEN** an MCP client invokes `get_panel_capabilities` with a valid DataType id
- **THEN** the tool returns the same capability payload the HTTP endpoint would return for that id and
  caller

## ADDED Requirements

### Requirement: Filter capability contract read tool
helio-mcp SHALL expose `get_output_filter_capabilities(outputId)` returning `GET /api/outputs/:id/filter-capabilities`, each column entry carrying `operators` and `controlKinds`. Its description SHALL state that it is distinct from `get_output_capabilities` (pipeline step column shape), and `get_output_capabilities`' description SHALL cross-reference it.

#### Scenario: Agent reads the contract
- **WHEN** an agent calls `get_output_filter_capabilities` for an Output with a timestamp column
- **THEN** that column's entry lists `date-range` in `controlKinds`

### Requirement: Control add/update/remove tools
helio-mcp SHALL expose `add_output_control`, `update_output_control` and `remove_output_control`, mutating only `config.controls` of an output panel through `PATCH /api/panels/:id`. `add_output_control` SHALL mint the control id client-side and, when `column` is omitted, bind the first column in the Output's schema order whose `controlKinds` contains the requested kind.

#### Scenario: MCP-only date-range control
- **WHEN** an agent calls `add_output_control` with `kind: "date-range"` and no column on an output panel
- **THEN** the panel persists a `date-range` control bound to the Output's first date-eligible column and a human viewer sees it

#### Scenario: Contract-disallowed control
- **WHEN** an agent adds a control the contract disallows
- **THEN** the backend's defined 400 `control not eligible: ...` error is surfaced unchanged and nothing is persisted

### Requirement: Workspace context lists controls
`get_workspace_context` SHALL include, for each output placement, that panel's controls (`id`, `kind`, `column`, `label`).

#### Scenario: Controls in context
- **WHEN** an output panel has controls
- **THEN** its placement entry lists them; a panel without controls lists `[]`

### Requirement: Proposals declare and validate controls
A proposal panel of type `output` MAY declare `controls`; propose-time validation SHALL reject an ineligible control with the same `control not eligible: column '<c>', kind '<k>'` message and 400 status the panel write path returns, by invoking the same `OutputControlsValidator`, never a separate rule set.

#### Scenario: Ineligible control in propose_dashboard
- **WHEN** `propose_dashboard` includes a `date-range` control on a non-timestamp column
- **THEN** the proposal is rejected with the defined error and no dashboard is created

### Requirement: Documented status codes match the backend
Tool descriptions SHALL name only status codes observed from the running backend for each failure mode.

#### Scenario: Status code copy
- **WHEN** the tool copy documents the ineligible-control error
- **THEN** it says 400, matching the live response

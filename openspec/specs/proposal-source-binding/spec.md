# proposal-source-binding Specification

## Purpose
Lets an agent-authored proposal bind a source-backed panel (today: `form`) to a dataset source, so proposed form panels arrive bound and able to submit rather than structurally unbound.

## Requirements

### Requirement: Proposal panels can carry a dataset source binding
A proposed panel SHALL accept an optional `dataSourceId` on every agent-facing proposal wire that can carry a panel (dashboard proposal, combined proposal, MCP proposal tools, assistant proposal tools, and patch-set panel creation where `form` is creatable). When a `form` panel is created from a proposal, its created config SHALL carry that `dataSourceId`, authoritative over any `config.dataSourceId` passthrough.

#### Scenario: Proposed form round-trips its source and submits
- **WHEN** a proposal with a `form` panel carrying a caller-owned dataset `dataSourceId` is applied
- **THEN** the created panel's config carries that `dataSourceId` and `POST /api/panels/:id/submit` appends a row to that dataset

#### Scenario: Flat binding is authoritative
- **WHEN** a proposed `form` panel supplies `dataSourceId` and a conflicting `config.dataSourceId`
- **THEN** the created panel is bound to the flat `dataSourceId`

### Requirement: A form proposal without a valid source binding is rejected
A proposal containing a `form` panel with no `dataSourceId` SHALL be rejected at validation with a clear error naming the panel, creating nothing and dropping nothing silently. A supplied `dataSourceId` SHALL exist, be owned by the caller, and be a `dataset` source; otherwise the proposal SHALL be rejected the same way, at least as strictly as the direct form-panel create path.

#### Scenario: Missing binding rejected
- **WHEN** a proposal contains a `form` panel with no `dataSourceId`
- **THEN** the request fails with 400 naming the panel and no panel or dashboard is created

#### Scenario: Foreign or non-dataset source rejected
- **WHEN** a proposed `form` panel's `dataSourceId` is another tenant's source, does not exist, or is not a `dataset` kind
- **THEN** the request fails with 400 and nothing is created

### Requirement: Agent-facing panel types derive from wire expressibility
The set of panel types on the agent-facing proposal surfaces SHALL be derived from whether the proposal wire can express the kind's required binding, and any excluded kind SHALL be excluded for a stated reason enforced by a test, not by hardcoded name alone.

#### Scenario: Schema drift check has no form-specific exception
- **WHEN** `npm run check:schemas` runs
- **THEN** it passes with `form` on the agent surfaces and no `form`-specific carve-out in the script

### Requirement: Every proposal path enforces the binding before writing
The source-binding check SHALL run on the dashboard apply, contents-replace, combined-proposal (validate and apply, before any pipeline is written) and patch-set panel-creation paths, so a rejected form leaves no partial state.

#### Scenario: Rejected combined proposal leaves no pipeline
- **WHEN** a combined proposal contains a `form` panel with an invalid `dataSourceId`
- **THEN** it is rejected and no pipeline from that proposal exists

#### Scenario: Patch-set creating an unbound form is rejected
- **WHEN** a patch-set creates a `form` panel with no `config.dataSourceId`
- **THEN** the apply fails with a 400 naming the edit, and nothing is created

### Requirement: Conflicting or misplaced source bindings are rejected
A proposed `form` panel supplying both `dataSourceId` and `outputId`, or any non-source-bound panel kind supplying `dataSourceId`, SHALL be rejected with a clear error.

#### Scenario: Form with both bindings
- **WHEN** a proposed `form` panel carries `dataSourceId` and `outputId`
- **THEN** the proposal is rejected naming the panel

#### Scenario: dataSourceId on a non-form panel
- **WHEN** a proposed `output` panel carries `dataSourceId`
- **THEN** the proposal is rejected naming the panel

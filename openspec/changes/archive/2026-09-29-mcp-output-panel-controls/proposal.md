## Why

HEL-915's exit criterion: an agent can build what a human can, i.e. add a date-range control to an Output panel. HEL-1188 (filter capability contract) and HEL-1189 (`OutputPanelConfig.controls`, server validation via `OutputControlsValidator`) shipped the backend and UI; helio-mcp has no control support (no discoverability, no ergonomic add/update/remove, controls absent from `get_workspace_context`), and `propose_dashboard`/combined `validate` never check controls (an ineligible control only fails later, at apply).

## What Changes

- helio-mcp: new tool `get_output_filter_capabilities` (reads `GET /api/outputs/:id/filter-capabilities`). Deliberately NOT named `get_output_capabilities`, which already exists and means the pipeline step's column shape (`/api/pipelines/:id/capabilities`); both descriptions cross-reference each other.
- helio-mcp: new tools `add_output_control`, `update_output_control`, `remove_output_control` (read-modify-write of the panel's `config.controls` via `PATCH /api/panels/:id`; client mints the control id; `add` auto-binds the column when omitted, first eligible column in schema order).
- Backend (additive): each `filter-capabilities` column entry gains `controlKinds` (from the existing `OutputControlEligibility.kindsFor`), so agents never re-implement eligibility.
- `get_workspace_context`: each output placement lists its panel's controls.
- Proposals: `ProposalPanel` gains a first-class optional `controls` (output panels); `DashboardProposalService.validate` (propose/`PUT contents`) runs the existing `OutputControlsValidator` against the bound Output; combined/patch-set paths route through the same validator (see design).
- Tool copy/docs state the backend's observed status codes, verified live (HEL-1143).

## Capabilities

### New Capabilities
- `mcp-output-panel-controls`: helio-mcp tools, context listing and proposal-time validation for output panel controls.

### Modified Capabilities
None (deltas live in the new capability; existing specs referenced only).

## Impact

helio-mcp (`tools/outputs*.ts`, `tools/proposal.ts`, `context.ts`, `helioApi.ts`, `types.ts`, `server.ts` + tests), backend (`OutputRoutes` filter-capabilities response protocol, `DashboardProposalProtocol`, `ProposalPanelSupport`, `DashboardProposalService`, `CombinedProposalService`, patch-set preview validation), `schemas/outputs/output-filter-capabilities-response.schema.json`, `schemas/dashboards/dashboard-proposal.schema.json`. No migration.

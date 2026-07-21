## Why

The `timeline` panel kind (HEL-317) ships with direct `create_panel`/`bind_panel` support and is
already recognized as a data panel in the proposal path (`DataPanelKinds`), so a proposal binding a
timeline with `dataTypeId` + `{time, event}` `fieldMapping` already applies. But timeline's one
display option, `sort` (`asc`/`desc`), is still only reachable through the generic `config`
passthrough (`config.timelineOptions.sort`) added in HEL-316 — there is no flat field for it the way
`metric` has flat `label`/`unit`. This is the last parity gap that keeps an agent from expressing a
complete timeline binding without dropping to the raw `config` block.

## What Changes

- Add an optional flat `sort` field to the proposal panel contract (`ProposalPanel` case class,
  `dashboard-proposal.schema.json`, helio-mcp `ProposalPanel` type + `panelSchema`).
- Extend `DashboardProposalService` to derive `timelineOptions.sort` into a timeline panel's config
  from the flat `sort` field, and validate the value up front (mirroring the existing `chartType` /
  `orientation` pre-create checks) so a bad `sort` rejects the whole proposal before anything is
  created.
- Update helio-mcp `proposal.ts` enums/descriptions so `propose_dashboard` advertises the flat
  `sort` field (and no longer implies `config` is required for it).
- Keep the `config` passthrough working: an explicit `config.timelineOptions` still wins over the
  flat-derived value, exactly as for other data panels.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `mcp-panel-composition-tools`: the proposal-flow flat-binding derivation gains timeline's
  `sort` field, bringing `timeline` to the same flat-binding parity as `collection`/`metric`.

## Impact

- Backend: `ProposalPanel`, `DashboardProposalProtocol`, `DashboardProposalService`,
  `RequestValidation` (new `validateTimelineSort` helper).
- Contract: `schemas/dashboard-proposal.schema.json` (additive optional `sort`).
- helio-mcp: `src/tools/proposal.ts`, `src/types.ts`.
- Tests: `DashboardApplyProposalSpec` (timeline binding + sort derivation + invalid-sort rejection),
  `DashboardProposalProtocolSpec`.
- Backward-compatible: `sort` is optional; flat-field-only and `config`-passthrough proposals are
  unchanged.

## Non-goals

- No new timeline rendering, panel-config-editor, or Proposal Review UI field work — `sort` is
  derived server-side and the UI round-trips proposal JSON unchanged.
- No changes to `create_panel`/`bind_panel` (already at timeline parity via HEL-317).

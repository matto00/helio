## Why

HEL-315 brought the MCP write/composition tools (`create_panel`/`bind_panel`) to v1.5 panel parity
but scoped out the separate proposal flow. `propose_dashboard`/`apply_proposal` still cannot express
the v1.5 config surfaces (collection `baseType`/`layout`, chart `chartOptions`, table
`density`/`columnOrder`) and still advertises the removed `divider` type. The gap is not MCP-local:
the backend `ProposalPanel` contract is a flat HEL-293 shape whose `DashboardProposalService` only
emits `{dataTypeId, fieldMapping, aggregation, label/unit}` / `{content|imageUrl|orientation}`, so it
structurally drops every v1.5 config field before the panel is created.

## What Changes

- Add an optional generic `config` object to `ProposalPanel` (backend protocol + JSON schema) — an
  additive escape hatch mirroring `create_panel`'s `config` passthrough.
- In `DashboardProposalService.buildCreateRequest`, merge that `config` over the config derived from
  the existing flat fields, then hand it to the SAME `PanelService.create` / `PanelConfigCodec`
  decoder path — so every v1.5 surface the create path already accepts becomes expressible via a
  proposal. Flat-field precedence keeps existing proposals byte-for-byte unchanged.
- Drop `divider` from the proposal `type` enum (protocol validation stays; schema enum updated) for
  agent/UI parity, mirroring HEL-249 / HEL-315.
- Thread the `config` passthrough through the MCP client (`types.ts` `ProposalPanel`, `proposal.ts`
  panel zod schema + refreshed tool descriptions with accurate v1.5 guidance).
- Verify `apply_proposal` round-trips a collection + a chart with `chartOptions` end-to-end against a
  live backend, and that the in-app Proposal Review UI (same `POST /api/dashboards/apply-proposal`)
  still round-trips proposals.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `mcp-panel-composition-tools`: extend v1.5 panel parity to the proposal flow — `propose_dashboard`
  drops `divider`, and both proposal tools accept a generic per-panel `config` passthrough that
  reaches panel creation unchanged.

## Impact

- Backend: `DashboardProposalProtocol.scala`, `DashboardProposalService.scala` (+ tests).
- Schema: `schemas/dashboard-proposal.schema.json`.
- MCP client: `helio-mcp/src/types.ts`, `helio-mcp/src/tools/proposal.ts`.
- Shared write path `POST /api/dashboards/apply-proposal` (in-app Proposal Review UI) — additive,
  backward-compatible; verified, not modified.

## Non-goals

- No change to the flat-field convenience path (kept for backward compatibility).
- No natural-language proposal authoring, and no changes to `create_panel`/`bind_panel`.
- No new panel types or backend rendering changes.

## Why

After HEL-1466, living specs and agent-facing text still describe panel models the system no longer has: `typeId`-bound
metric/chart/table/text panels, a removed `create_panel` tool, and `collection`/`timeline`/`metricId` proposal
behaviour (see `ticket.md`). Agents ground on these, so stale statements produce wrong agent output.

## What Changes

- `panel-type-rendering`: replace the `typeId`-keyed body requirement with one per current canonical kind
  (`output`/`text`/`markdown`/`image`/`divider`/`form`); restate metric body rules for a metric-kind Output; drop the
  bound-text, trend and field-mapped-label scenarios that have no code path; fix the type-badge example.
- `mcp-panel-composition-tools`: remove the `collection` create-panel-request schema requirement, the timeline flat
  binding requirement and the three `metricId` requirements, each with a Reason/Migration grounded in the tree.
- Restate the divider exclusion reason without the `create_panel` parity clause in
  `scripts/lib/agentFacingPanelTypes.mjs`, `helio-mcp/src/tools/proposal.ts` (two comments) and
  `schemas/dashboards/dashboard-proposal.schema.json` (`ProposalPanel.type` description).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `panel-type-rendering`: per-kind body rendering, metric-kind Output body, type badge example.
- `mcp-panel-composition-tools`: removal of stale collection/timeline/metricId requirements.

## Non-goals

- Other stale-looking requirements outside the three named items (e.g. `mcp-panel-composition-tools`' chart
  `annotation` and flat-field backward-compat wording; `collection-panel-type`/`timeline-panel-type`/
  `metric-panel-trend-indicator` specs). Checked and recorded; triaged as a follow-up at Delivery.
- Any runtime behaviour change; removing the legacy flat `sort` wire field.

## Impact

`openspec/specs/*` (via archive), one exclusion-reason string, two TS comments, one JSON-schema `description`. No API,
wire, schema-shape or user-visible change. helio-mcp source comments change (owner's local dist rebuild note in PR).

# HEL-1592: After HEL-1466: remaining stale typeId/bound-text scenarios (panel-type-rendering), "mirrored by create_panel" wording, and stale collection/timeline/metricId requirements in mcp-panel-composition-tools

## Description

Origin: HEL-1466 (PR matto00/helio#1017, 2d815623f), lane-reported. Not fixed there; out of its scope.

1. `openspec/specs/panel-type-rendering/spec.md`: `typeId`-based scenarios are stale, including "Bound text panel renders live content". HEL-1466 removed the dead `TextRenderer` bound path, so text panels render only literal content.
2. The "mirrored by create_panel" wording names a tool that has been removed. It appears in `scripts/lib/agentFacingPanelTypes.mjs`, `helio-mcp/src/tools/proposal.ts` and `schemas/dashboards/dashboard-proposal.schema.json`. Restate it against the actual exclusion table, as HEL-1466 did for the spec.
3. `openspec/specs/mcp-panel-composition-tools/spec.md` still has stale requirements: collection, timeline, metricId.

Make all spec changes through OpenSpec deltas, with a verification command for every factual claim. This ticket was written from a lane report, so re-check each item against the tree first.

## Acceptance Criteria

- Each of the three items is re-derived against the tree; any item (or sub-claim) found not real is dropped with recorded evidence.
- `panel-type-rendering`: no requirement or scenario keys rendering on a panel `typeId` or describes a bound text panel; requirements describe the current canonical panel kinds (`output`, `text`, `markdown`, `image`, `divider`, `form`) as rendered today.
- The "mirrored by create_panel" / "mirroring create_panel" / "create_panel's enum" wording is gone from the three named files and restated against `AGENT_SURFACE_EXCLUSIONS` and the live tool surface; the panel-create-path comment in `proposal.ts` no longer names `create_panel`.
- `mcp-panel-composition-tools`: the `collection` create-panel-request schema requirement, the timeline flat-binding requirement and the three `metricId` requirements are removed or restated to match the tree.
- All spec changes are OpenSpec deltas; `openspec validate <change> --type change --strict` passes.
- Every factual claim has a verification command and its output in the change's `evidence.md`.
- No behaviour change: schema checks (`npm run check:schemas`), helio-mcp typecheck/tests and any generated artifact derived from the changed schema description are verified unchanged-or-green by running them, not assumed.

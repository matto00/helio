## Why

`form` binds to a dataset **source** (`dataSourceId`), but no agent-facing proposal wire can express that, so an agent-proposed `form` is structurally unbound and can never submit. HEL-1083 shipped `form` on the agent surfaces knowingly incomplete; this change closes the gap at the cause (the wire cannot express a source binding) rather than hiding it behind a carve-out.

## What Changes

- Add a first-class optional `dataSourceId` to the proposal panel wire (backend `ProposalPanel`, `schemas/dashboards/dashboard-proposal.schema.json`, combined-proposal schema, MCP `propose_*` zod schema and types, assistant proposal tool schemas, and the patch-set `create_panel` shape where it can carry a `form`).
- Proposal validation: a `form` panel with no `dataSourceId` is rejected with a clear 400 before anything is created; a supplied `dataSourceId` must exist, be owned by the caller, and be a `dataset` kind (mirrors the existing form panel create path; never weaker).
- Apply path threads the flat `dataSourceId` into the created panel's `config.dataSourceId`, authoritative over any `config` passthrough (same rule as `outputId`), so the panel arrives bound and `POST /api/panels/:id/submit` works.
- Derive `agentFacingPanelTypes` in `scripts/check-schema-drift.mjs` from "expressible on the proposal wire" (a kind is agent-facing iff the wire can carry its required binding) with a stated reason per exclusion, tested; no `form`-specific exception.
- Add a seam test: a shared wire fixture used by the MCP side and the backend route side, and a test that drives the real MCP handler against the real backend route where feasible.
- MCP-side pre-validation warning for a `form` proposal lacking/with unknown `dataSourceId`.

## Capabilities

### New Capabilities
- `proposal-source-binding`: proposal panels can carry a dataset-source binding, validated and applied so agent-proposed form panels arrive bound; unbound form proposals are rejected loudly.

### Modified Capabilities
<!-- none: delta kept in the new capability to avoid restating unchanged requirements -->

## Impact

Backend: proposal protocol/service/support, combined-proposal path, patch-set create_panel resolver (if it can create a `form`), assistant tool schemas. helio-mcp: proposal/combined schemas, validation, types, tests. `schemas/`, `scripts/check-schema-drift.mjs`. No DB migration expected.

# HEL-1148: Agent proposal wire carries no dataSourceId, so an agent-proposed form panel is structurally unbound

## Description
`form` is the first panel kind that binds to a **source** (a `dataset`) rather than an Output. The agent-facing proposal wire carries no `dataSourceId`, so an agent-proposed `form` panel has nowhere to record what it writes into. `form` was knowingly allowed onto the agent surfaces via `check-schema-drift.mjs`'s `agentFacingPanelTypes` (canonical minus `divider`) by HEL-1083; this ticket is the tracked fix.

Scope: extend the proposal wire (and `schemas/`, `openspec/` specs in the same change) so a proposed panel can carry a source binding; wire it through proposal -> apply so an agent-proposed `form` arrives bound and able to submit; a proposed `form` with no `dataSourceId` must fail loudly at validation (never silently dropped, never created unbound); reconsider deriving `agentFacingPanelTypes` from "expressible on the proposal wire".

## Acceptance Criteria
1. An agent-proposed `form` panel round-trips with its `dataSourceId` and can submit a row end to end.
2. A proposal carrying a `form` panel with no source binding is rejected with a clear error, not created unbound and not silently dropped; a test proves the rejection and fails before the fix.
3. Schemas and specs are updated in the same change as the code, and `npm run check:schemas` passes without a `form`-specific exception.
4. Any remaining kind excluded from the agent surface is excluded for a stated, tested reason rather than by hardcoded name.

## Driver notes (claims to verify)
- Validate the dataSourceId exists, is caller-owned, and is a `dataset` kind; mirror (never weaken) the existing form create path (PanelService HEL-1083/1084 checks).
- Enumerate every proposal wire (dashboard proposal, combined proposal, patch-set create_panel, MCP propose_*/apply_*/create_panel, assistant proposal tool schemas) and prove current behavior red before fixing.
- Seam test required: a shared fixture or MCP handler driven against the real backend route.
- HEL-1071 made apply validate layouts (lg validated, md/sm/xs reflowed); form must still lay out validly.
- No migration expected (V114 next free). No production actions.

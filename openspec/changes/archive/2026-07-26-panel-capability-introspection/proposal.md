## Why

`helio-news`'s planner works because it's offered a menu of real, valid options instead of being asked to
invent panel keys. That menu is hand-rolled client-side today (`agents.story_offers()`), re-deriving Helio's
binding rules (which panel types fit which data shape, which `fieldMapping` slots each needs) out of band.
Every external agent has to redo this work, and it drifts from what the server actually enforces at bind
time. Helio should expose the menu itself.

## What Changes

- New `GET /api/types/:id/panel-capabilities` endpoint: given an owner-scoped DataType, returns which of the
  five data-bindable panel kinds (`metric`, `chart`, `table`, `collection`, `timeline`) are structurally
  bindable, each with its required/optional `fieldMapping` slots and the eligible columns per slot, plus
  shape signals (columns+types, row count, pipeline-output vs. source-companion).
- New `PanelBindingSpec` (one per bindable `PanelType`) in the domain layer — the single definition of each
  panel's slots and per-slot column-type eligibility, consumed by the new endpoint. `bind_panel`'s MCP tool
  description and `panelSlots.ts` (frontend) are the existing prose/UI statements of this same contract;
  the Scala spec becomes the canonical version and a test cross-checks it against both so they can't drift
  further apart.
- Companion (non-pipeline-output) DataTypes report no bindable data panels, matching what `PanelService`'s
  V41 check actually rejects — mirrors `findByIdOwned`'s 404-not-403 pattern for cross-tenant access.
- `metric`/`chart` eligibility reflects HEL-292 aggregation (any DataType with ≥1 numeric column is
  metric-eligible regardless of row count); the response does not advertise aggregated pie/scatter (HEL-624
  gap) — scoped honestly rather than promising a render that won't happen.
- New MCP `get_panel_capabilities` read tool (`helio-mcp/src/tools/read.ts` + `helioApi.ts`) wrapping the
  endpoint.
- `schemas/` + `openspec/` updated with the response shape.

## Capabilities

### New Capabilities
- `panel-capability-introspection`: given a DataType, report which panel kinds are structurally bindable,
  their field-mapping slots, and per-slot eligible columns.

### Modified Capabilities
(none — purely additive read surface; no existing requirement changes)

## Impact

- Backend: new `PanelCapabilityService`, a new route added to the existing `DataTypeRoutes.scala` (see
  design.md D6 — folded into the existing DataType-scoped router rather than a new route file, matching
  its `/rows` and `/validate-expression` sub-paths), a new `PanelBindingSpec` in `domain/panels/`.
- `helio-mcp`: new read tool + `helioApi.ts` client method.
- `schemas/` + `openspec/`: new response schema/spec.
- No DB migration — reads existing `DataType`/`DataTypeRow` data.
- Does not touch `frontend/` — this is a server + MCP surface for external agents (`helio-news` etc.), not
  an in-app feature. `frontend/src/features/panels/state/panelSlots.ts` is read (research-only) as a
  cross-check reference for the design gate.

## Non-goals

Editorial "should this render" judgement, chart sub-shape recommendation (bar vs. line), and aggregation
planning all stay out of scope (owned by the calling agent / a pipeline, per the ticket). HEL-364/370/366/
367/368 (compound bind, batch create, tagging, auto-pack, panel id key) are queued behind this ticket and
are not absorbed here.

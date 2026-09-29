## Why

HEL-915 (re-scoped) needs authors to be able to attach date/dropdown/numeric/text controls to an
Output panel so a later leaf (HEL-1190) can let viewers parameterize the read. HEL-1188 already
ships the capability contract (which columns/operators an Output actually supports); this change
adds the persisted control model, its server-side contract validation, and the author-facing
editor that produces it — leaf 2 of 5.

## What Changes

- Add a `controls: Vector[OutputControlSpec]` list to `output` panel config (kind, bound column,
  author default value, label), stored alongside the existing `outputId` on the placement.
- Auto-bind on add: the offered kinds and, per kind, the offered columns are derived from
  HEL-1188's `/filter-capabilities` contract (paired with the Output's own schema to distinguish a
  date-range-eligible column from a numeric-range-eligible one, since the contract carries no
  column type). A kind with no eligible column is not offered.
- Server-side validation rejects a saved control whose column/kind the contract doesn't allow, with
  a defined 400. Defines and surfaces schema-drift behavior when a bound column later disappears or
  changes type.
- Panel config editor UI: add/configure/remove controls, DESIGN.md-compliant, both themes,
  keyboard-operable/labelled/announced.
- Schemas (`schemas/panels/`) and openspec specs updated in the same change.

## Capabilities

### New Capabilities
- `output-panel-controls-editor`: the authoring UI for adding, configuring, auto-binding, rebinding
  and removing controls on an `output` panel, and the client-side mirror of the contract-eligibility
  rule.

### Modified Capabilities
- `output-panel-placement`: the `output` panel's persisted config gains a `controls` list; adds the
  server-side contract-validation requirement (400 on an ineligible column/kind) and the defined,
  non-silent behavior when a bound column's schema drifts.

## Impact

Backend: `OutputPanelConfig`/new `OutputControlSpec` (domain), a new `output_controls` JSONB column
(migration V112), `PanelRowMapper`, `PanelService`'s create/update validation path (contract lookup
via `OutputFilterCapability`), `PanelProtocol`/schemas.
Frontend: `PanelDetailModal`'s output section, a new controls-editor component, `outputService.ts`
(fetch `/filter-capabilities`), panel types.
Out of scope (leaf 3/5): rendering controls for viewers, applying them to the read, MCP.

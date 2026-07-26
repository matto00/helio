## Why

`PATCH /api/panels/:id` and `POST /api/panels/updateBatch` currently rebuild the panel's
`appearance` from the incoming payload instead of merging it, so any field the caller omits
silently reverts to a hardcoded default — an omitted `chart` drops a previously-set `chartType`,
an omitted `background` reverts to `"transparent"`. This has already caused real data loss in the
`helio-news` unattended pipeline and forces every agentic caller (including the `helio-mcp` server,
whose tool description already — incorrectly — claims partial-merge semantics) to resend a complete
appearance object on every call just to avoid clobbering itself.

## What Changes

- Replace the appearance PATCH decode path with a partial-merge decoder (`Option[Option[T]]`
  absent-vs-null idiom, mirroring the existing `MetricPanelConfig.Patch` pattern) so a field absent
  from the payload preserves the panel's stored value, and an explicit `null` resets that field to
  `PanelAppearance.Default`/`ChartAppearance.Default`'s corresponding value.
- Extend the merge one level into `chart`: a payload chart carrying only `chartType` (or any subset
  of `seriesColors`/`legend`/`tooltip`/`axisLabels`/`chartType`) merges over the stored `ChartAppearance`
  (or `ChartAppearance.Default` when none stored) instead of requiring the full sub-object. **BREAKING**
  for any caller relying on the *current* 400 rejection of a partial `chart` object — none is known to
  exist; this is the acceptance criterion the ticket exists to satisfy.
- Apply identical merge semantics to the batch appearance path (`POST /api/panels/updateBatch`),
  replacing its existing ad hoc top-level-only `getOrElse` merge (which already partially worked but
  couldn't do a partial `chart`) with the same shared decoder used by the single-item path.
- Keep create-time appearance (`resolveCreateAppearance`) building from `PanelAppearance.Default`
  unchanged — this ticket touches only the two update paths.
- Correct the `helio-mcp` `update_panel_appearance` tool description so its "partial" claim is
  accurate, including for nested `chart` fields.
- Add a `panel-appearance-patch.schema.json` (all fields optional, incl. within `chart`) for the
  update wire shape; leave `panel-appearance.schema.json` (full-object) as the create-time contract.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `panel-appearance-settings`: the "Panel appearance settings are persisted through resource
  updates" requirement changes from replace-semantics to merge-semantics; add absent-vs-null and
  partial-`chart` requirements.
- `panel-batch-update`: the appearance-update scenario changes from ad hoc top-level merge to the
  shared partial-merge decoder (partial `chart` now supported in batch too).

## Impact

- Backend: `PanelServiceHelpers`, `PanelPatchApplier`/`PanelService` (single-item), `PanelMutationRepository.batchUpdate`
  (batch), `PanelProtocol` (wire types for `UpdatePanelRequest.appearance` / `PanelBatchItem.appearance`
  become raw `JsValue`, mirroring `config`), new `PanelAppearance.Patch` / `ChartAppearance.Patch`
  decoders in `domain/model.scala`.
- `helio-mcp/src/tools/write.ts` tool description.
- `schemas/panel-appearance-patch.schema.json` (new), `update-panels-batch-request.schema.json` ($ref
  swap).
- No frontend change — the editor already sends complete objects, which continue to work identically.

## Non-goals

- Redesigning the `PanelAppearance` domain model or adding new appearance fields.
- Frontend appearance editor changes.
- A dedicated field-clear/reset UI gesture — explicit-null-clears-to-default is a backend contract
  detail, not a new product surface.
- Dashboard appearance PATCH (`PATCH /api/dashboards/:id`) has the identical replace-semantics bug
  (confirmed: `DashboardServiceValidation.normalizeAppearance` rebuilds from defaults) but is a
  narrower 2-scalar-field surface with its own call sites; scoped out to a spinoff ticket rather than
  widening this one, per design.md.

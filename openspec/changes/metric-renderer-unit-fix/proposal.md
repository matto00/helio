## Why

`MetricRenderer` silently drops the `unit` slot and shows a spurious "No data" label whenever a
metric is bound with a value but no label, even though the value is fine. Both defects were seen
on the prod Netflix dashboard's "Avg User Rating" tile (HEL-291). This is a targeted UI bug fix.

## What Changes

- Render `data?.unit` adjacent to the value in `MetricRenderer` (e.g. `84 /100`).
- Fix the "No data" fallback so it only appears when the **value** slot is genuinely absent;
  a missing label alone no longer triggers it (a metric with a value but no label renders the
  value with no label line, not `NO DATA`).
- Add a code comment on the `label`/`unit` fieldMapping slots clarifying they are column
  references resolved via `usePanelData` (not literal text) — the config-depth ticket
  (sibling of HEL-291) is the one introducing a literal `label` override; this ticket does not
  change that resolution mechanism.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `panel-type-rendering`: the "Bound metric panel renders live value and label" scenario is
  extended to cover `unit` rendering, and a new scenario documents the value-only "No data"
  fallback.

## Impact

- `frontend/src/features/panels/ui/renderers/MetricRenderer.tsx` — render logic change.
- `frontend/src/features/panels/ui/PanelContent.css` — new `panel-content__metric-unit` class.
- New test coverage for `MetricRenderer` (no existing test file for this component).
- No backend, schema, or API changes; `fieldMapping.unit` already flows through `usePanelData`
  and `MappedPanelData` unchanged.

## Non-goals

- Making `label` (or `unit`) a literal string instead of a column reference — that is the
  config-depth ticket's scope.
- Changing the panel-level `noData` skeleton/placeholder in `PanelContent.tsx` (fires before rows
  ever load); this ticket only changes `MetricRenderer`'s internal label fallback.

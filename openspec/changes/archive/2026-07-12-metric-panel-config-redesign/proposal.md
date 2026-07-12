## Why

The Metric panel's config UI splits "which value do I show" across two overlapping controls — a
`fieldMapping.value` slot and a separate `aggregation.value`/`agg` pair — so a user can set both,
leaving it unclear which wins (aggregation silently overrides `fieldMapping.value` at render time).
Literal label/unit overrides (HEL-293) are only settable at panel-creation time; there is no way to
edit them afterward. This ticket is also the pattern-setter for HEL-244/245/247, which need the same
"bind to a field, or use fixed text" contract for their own single-value slots.

## What Changes

- Replace Metric's separate "Field mapping: Value" row + "Aggregation: Field/Function" section with
  one **Value** control: a field select plus a "Reduce" select (`None (first row)` / Count / Sum /
  Average / Min / Max). `None` writes `fieldMapping.value`; any other choice writes `aggregation`
  (and clears `fieldMapping.value` so the two never disagree).
- Add a **Label** and **Unit** control per slot with a "Bind to field" / "Fixed text" mode toggle,
  closing the gap where `config.label`/`config.unit` (HEL-293) could only be set at creation time.
- Extract the mode-toggle control as a shared component (`BoundOrLiteralField`) so HEL-244/245/247
  can reuse it verbatim for their own field-or-literal slots.
- Thread `label`/`unit` through `updatePanelBinding` (thunk → service → `buildBindingPatch`) using
  the existing absent/null/value PATCH convention already used for `aggregation`.
- No change to chart/table field mapping, aggregation semantics, rounding (HEL-297), or the
  no-false-"No data" rendering (HEL-295) — this is a config-UI reorganization, not a behavior change
  to data resolution beyond removing the redundant `fieldMapping.value`-vs-`aggregation` disagreement.

## Capabilities

### New Capabilities

- `panel-config-field-or-literal-pattern`: the reusable "bind to field, or fixed text" control
  pattern and the paired "field + optional reduce" value-selection pattern, documented as the
  contract HEL-244/245/247 mirror.

### Modified Capabilities

- `panel-datatype-binding`: Metric's "Value, Label, Unit" field-mapping slots requirement is replaced
  by the unified Value control and the Label/Unit bind-or-literal controls.
- `panel-viz-aggregation`: Metric aggregation is now selected via the same Value control as plain
  field mapping (mutually exclusive with `fieldMapping.value`) rather than a separate section.

## Impact

- Frontend: `BindingEditor.tsx` (metric branch), new `MetricValueEditor`/`BoundOrLiteralField`
  components, `panelPayloads.ts` (`buildBindingPatch`), `panelThunks.ts`, `panelService.ts`.
- No backend changes — `MetricPanelConfig`/`Patch` already carry `label`/`unit` (HEL-293).
- No schema changes — `schemas/panel.schema.json` already documents `label`/`unit`/`aggregation`.

## Non-goals

- No changes to Chart/Table field mapping or aggregation UI.
- No changes to smart-pipeline / filter-field concepts from the original ticket text — HEL-292's
  viz-level `aggregation` already ships the "single-row reduction" the ticket asked for; this change
  is scoped to the config UI's clarity, not a new reduction mechanism.
- HEL-244/245/247 implementation itself is out of scope; only the reusable pattern + component ships.

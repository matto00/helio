# HEL-1432: Output editor: Kind/Step labels' htmlFor points at nothing (shared Select takes no id); table options overflow the Configuration card at 375px

## Description

Origin: HEL-1388 (matto00/helio#878, 023aa4bb), lane-reported. Priority Low; labels Follow-up, Bug.

1. In the Output editor, the Kind and Step labels use `htmlFor="output-kind"` and `htmlFor="output-step"`, but the
   shared `Select` component takes no `id`, so the labels aren't programmatically associated with their controls. Add
   `id` pass-through to the shared `Select` (check every other caller) and wire it up. Test with `getByLabelText`.
2. At 375px, a table Output's options (cell density and the column selects) overflow the Configuration card's right
   edge. This predates HEL-1388. Verify in the running app in both themes.
   Overlap: HEL-1430 (OutputEditorSheet split) touches the same file. Combine if picked up together.

## Acceptance Criteria

- The shared `Select` accepts an optional `id` that lands on its trigger (the combobox button); callers that pass no
  `id` render exactly as before (no new or changed ids anywhere else in the app).
- In the Output editor, `getByLabelText("Kind")` resolves to the Kind combobox in both create and edit mode, and
  `getByLabelText("Step")` resolves to the Step combobox in create mode. Tests are red on the WHOLE pre-fix tree.
- The HEL-1388 locked-Kind accessible description (`aria-describedby` → the "can't be changed" hint) still works in
  edit mode alongside the new id.
- Planner-approved in-scope extension (same defect, same surface): every other visible label rendered inside the
  Output editor whose `htmlFor` currently resolves to no element is associated with its control. Measured set at
  planning time (`htmlFor` with no matching `id` anywhere): `output-chart-type`, `output-metric-format`,
  `output-collection-format`, `output-slot-<key>` (OutputKindFields/OutputKindConfigCard); `table-density`
  (TableDisplayFields); `bar-orientation`, `bar-stacking`, `scatter-size-field`, `scatter-color-field`
  (ChartDisplayFields); `agg-field`, `agg-fn`, `agg-group-by` (ChartAggregationFields); `metric-value-field`,
  `metric-value-reduce` (MetricValueEditor). These four panels/ui/editors components are rendered only by the Output
  editor today. The 7 dangling targets on other surfaces (add-root-source, divider-orientation, form-editor-dataset,
  image-fit, pipeline-source, schedule-kind, source-method) are out of scope (follow-up).
- At a 375px viewport, a table Output's Configuration card content (Cell density row and every Columns row incl. its
  format select and move buttons) does not overflow the card's right edge, measured in the running app in light and
  dark themes. At 768px (inside the established `max-width: 768px` mobile query) the card content also does not
  overflow and the HEL-469/HEL-813 invariants hold; at 1100 and 1440px the table options' layout is unchanged.
- New code is lint-clean under the enforced @typescript-eslint/recommended rules, with no new eslint-disable.

## Driver context

HEL-1430 (#897) split OutputEditorSheet.tsx; labels for Kind/Step remain in OutputEditorSheet.tsx, the table options
now render via OutputKindConfigCard.tsx → OutputKindFields.tsx (TableKindFields) → panels/ui/editors/TableDisplayFields.tsx.

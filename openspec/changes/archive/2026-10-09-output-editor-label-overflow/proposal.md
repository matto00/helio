## Why

Output editor labels (Kind, Step, and several others) use `htmlFor` ids that no element carries, because the shared
`Select` (`frontend/src/shared/ui/Select.tsx`) accepts no `id`. The labels are therefore not programmatically associated
with their controls (no label-click focus, `getByLabelText` fails). Separately, at a 375px viewport a table Output's
options (Cell density and the Columns rows) overflow the Configuration card's right edge.

## What Changes

- `Select` gains an optional `id` prop applied to its trigger button. Omitted → no `id` attribute (unchanged).
- Output editor: Kind and Step `Select`s receive `id="output-kind"` / `id="output-step"`; every other dangling
  label target rendered inside the Output editor (chart type, formats, mapping slots, table density, chart display and
  aggregation fields, metric value fields — 14 more, enumerated in ticket.md) is wired the same way. The HEL-1388 `aria-describedby` hint on the locked Kind control is preserved.
- Table options layout (expected in `TableDisplayFields.css`; wherever the measured cause is) is fixed so the card content fits at 375px, using existing
  DESIGN.md tokens/patterns; root cause measured in the running app before the fix.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-output-sheet`: adds label-association and narrow-viewport fit requirements for the Output editor.

## Impact

Frontend only: `shared/ui/Select.tsx`, `features/pipelines/ui/outputEditor/{OutputEditorSheet,OutputKindFields,
OutputKindConfigCard}.tsx`, `features/panels/ui/editors/{TableDisplayFields,ChartDisplayFields,ChartAggregationFields,
MetricValueEditor}.tsx`, `TableDisplayFields.css`, plus tests. No API/schema change.

## Non-goals

- The 7 other dangling `htmlFor` targets on other surfaces (panel detail editors, pipeline modals, schedule dialog,
  sources form) — follow-up ticket.
- Making table Cell density functional for Outputs (it is a documented no-op today).
- Changing any control's existing `aria-label` / accessible name.

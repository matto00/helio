## Standing Constraints

- [C1] Any "fails on the old code" measurement uses the WHOLE pre-fix tree (all non-test sources at the base SHA), never one old file in the current tree.
- [C2] `Select` with no `id` prop renders no `id` attribute on its trigger; no other caller's DOM ids change.
- [C3] The overflow fix uses existing DESIGN.md tokens/patterns only and keeps the HEL-469 (column name never 0px) and HEL-813 (move gap --space-4, 44px tap floor) invariants.
- [C4] Screenshots/measurements go to /home/matt/Development/helio/.concertino/runs/HEL-1432/evidence/, never the worktree root.
- [C5] Dev DB: throwaway user only (never matt@helio.dev); record every created id; delete only by exact id.

## 1. Frontend

- [x] 1.1 Add optional `id` prop to `shared/ui/Select.tsx`, applied to the trigger button only (D1)
- [x] 1.2 Pass `id="output-step"` and `id="output-kind"` in `OutputEditorSheet.tsx`, keeping `ariaDescribedBy` (D5)
- [x] 1.3 Pass ids for `output-chart-type`, `output-metric-format`, `output-slot-${key}` (OutputKindFields) and `output-collection-format` (OutputKindConfigCard)
- [x] 1.4 Pass ids for `table-density`, `bar-orientation`, `bar-stacking`, `scatter-size-field`, `scatter-color-field`, `agg-group-by`, `agg-field`, `agg-fn`, `metric-value-field`, `metric-value-reduce`
- [x] 1.5 Measure the 375px table-options overflow in the running app (light + dark), record the root cause with numbers
- [x] 1.6 Fix the overflow where the measured root cause lives (expected `TableDisplayFields.css`), in the mobile query (D6, C3)
- [x] 1.7 Re-measure 375 + 768 (both themes): no overflow, invariants hold; 1100/1440 unchanged vs. before; save evidence (C4)

## 2. Tests

- [x] 2.1 `Select` unit test: `id` lands on the combobox trigger; absent `id` → no `id` attribute
- [x] 2.2 Output editor test: `getByLabelText("Kind")`/`("Step")` resolve in create mode; `("Kind")` in edit mode is disabled with the hint as its description
- [x] 2.3 Label-element association test (D7) per id, one render each; assert no duplicate `id` in every render:
- [x] 2.3a create: output-kind, output-step; edit: output-kind (disabled, hint description intact)
- [x] 2.3b chart (line): output-chart-type, agg-group-by, agg-field, agg-fn (use a render that shows the agg fields)
- [x] 2.3c chart bar: bar-orientation, bar-stacking; chart scatter (with bound field options — `isBound`): scatter-size-field, scatter-color-field
- [x] 2.3d metric: output-metric-format, metric-value-field, metric-value-reduce
- [x] 2.3e collection: output-collection-format, output-slot-value/-label/-unit; timeline: output-slot-time/-event
- [x] 2.3f table: table-density
- [x] 2.4 Output editor test: clicking the Kind label opens the listbox in create mode, no-op in edit mode (D4)
- [x] 2.5 Run the new tests against the whole pre-fix tree; record red for ALL 16 targets, not only Kind/Step (C1)
- [x] 2.6 Lint (zero warnings, no new eslint-disable), typecheck, format, full Jest suite green

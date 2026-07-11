- `frontend/src/features/panels/ui/renderers/MetricRenderer.tsx` — render `data?.unit` inline next
  to `data?.value` (new `panel-content__metric-unit` span, only when unit is truthy); key the
  label/"No data" fallback on value presence (`hasValue = !!data?.value`) instead of label
  presence, so the label line is omitted (not replaced with "No data") when a value is present
  but no label is mapped; add a code comment clarifying `value`/`label`/`unit` are column
  references resolved via `usePanelData`'s `firstRow[field]`, not literal text.
- `frontend/src/features/panels/ui/PanelContent.css` — new `.panel-content__metric-unit` rule
  (muted color, `--text-sm`/`--weight-medium`, `--space-1` left margin) plus compact
  (`--text-xs`) and spacious (`--text-base`) container-query overrides alongside the existing
  `__metric-value`/`__metric-label`/`__metric-trend` rules. Token-only, no hardcoded values.
- `frontend/src/features/panels/ui/renderers/MetricRenderer.test.tsx` — new test file (no prior
  coverage for this component): unit rendered adjacent to value; unit span absent when unit is
  falsy; value-with-no-label omits both the label line and "No data"; no-value shows "No data"
  (including the `data: null` unbound case); value+label+trend regression (all three lines
  render); trend direction classes (`--up`/`--down`/`--flat`) and trend-absent case.

## Root cause / bug-fix evidence (per systematic-debugging.md)

- **Root cause:** `MetricRenderer.tsx` (render layer) never read `data.unit`, and its label
  fallback was keyed on `data?.label` truthiness (`data?.label ?? "No data"`) rather than
  `data?.value` truthiness — since `label` is a column reference that silently resolves to `""`
  when unmapped, any value-only metric fell through to the "No data" string even though the
  value itself was present and correct.
- **Probe:** wrote `MetricRenderer.test.tsx` cases against the pre-fix component:
  `render(<MetricRenderer data={{ value: "84" }} />)` — confirmed pre-fix output contained the
  literal text "No data" (label fallback firing on missing label, not missing value), and no
  `.panel-content__metric-unit` node existed for `data={{ value: "84", unit: "/100" }}` (unit
  field never read).
- **Probe output (post-fix):** `npm test -- --testPathPatterns=MetricRenderer` → `Test Suites: 1
  passed, 1 total / Tests: 10 passed, 10 total` — the same scenarios above now pass: no "No data"
  when value-only, unit renders in its own span, "No data" still shown only when value is absent.

# Files modified — HEL-323 (bound-caption-annotation-fields)

## Schema / contract

- `schemas/panel.schema.json` — document the reserved `fieldMapping.annotation` slot and its
  literal-wins relationship to the static `config.annotation` on the chart config (no shape break;
  `fieldMapping` stays `type: object`). (Task 1.2)
- `helio-mcp/src/tools/write.ts` — note in the `create_panel` / `bind_panel` tool docs that a chart
  annotation can be bound via `fieldMapping.annotation` (first-row value), passed through unchanged.
  (Task 1.3)

## Frontend

- `frontend/src/features/panels/ui/PanelContent.tsx` — resolve the effective chart annotation
  literal-wins: `config.annotation ?? data?.annotation ?? null`, forwarded to `ChartRenderer`.
  (Task 2.1)
- `frontend/src/features/panels/ui/editors/ChartDisplayFields.tsx` — replace the plain annotation
  `TextField` with the shared `BoundOrLiteralField` (driven by an `annotationState` prop); offer
  "Bind to field" only when a DataType is bound (`isBound`), else fall back to a fixed-text-only
  input. (Task 2.3)
- `frontend/src/features/panels/ui/editors/BindingEditor.tsx` — add a `useBoundOrLiteralState`
  instance for the annotation slot; on save, per-slot-merge `fieldMapping.annotation` into the
  outgoing chart mapping (Bind-to-field sets it; any other mode deletes it) and write
  `config.annotation` (Fixed-text sets/clears; Bind-to-field clears to `null`). Mode defaults via
  `defaultBoundOrLiteralMode(config.annotation !== undefined)`. (Task 2.2; Task 2.4 rides the
  existing `fieldMapping`/`annotation` passthrough in `panelPayloads`/`panelThunks`/`panelService`,
  which needed no change.)

## Tests

- `frontend/src/test/panelFixtures.ts` — `makeChartPanel` now carries `config.annotation` so tests
  can exercise the static/bound annotation paths.
- `frontend/src/features/panels/ui/PanelContent.test.tsx` — bound annotation renders the resolved
  `data.annotation`, static `config.annotation` wins over a bound value, and none renders when
  neither is set. (Task 3.1)
- `frontend/src/features/panels/ui/editors/ChartDisplayFields.test.tsx` — updated to the
  `annotationState` prop; asserts fixed-text-only when unbound, mode toggle + field dropdown when
  bound, and mode switching. (Task 3.2)
- `frontend/src/features/panels/ui/editors/BindingEditor.annotation.test.tsx` (new) — integration
  test of the save path: Fixed-text sets `config.annotation` and removes `fieldMapping.annotation`;
  Bind-to-field sets `fieldMapping.annotation` and clears `config.annotation` to `null`. (Task 3.2)
- `backend/src/test/scala/com/helio/domain/PanelSpec.scala` — chart config decode/patch/applyPatch
  round-trips the reserved `fieldMapping.annotation` slot (and so duplicates it), and the bound
  column appears in the panel query's selected fields. (Task 3.3)

## Notes for the evaluator

- No backend domain change, no Flyway migration, no new column — the bound annotation reuses the
  free-form `fieldMapping` JsObject (already stored/round-tripped/query-selected via
  `Panel.selectedFieldsFromMapping`). Confirmed in `ChartPanel.scala` (no slot allowlist). (Task 1.1)
- Image-caption binding is intentionally NOT implemented — scoped out per the `image-panel-type`
  spec delta and design D4.
- `BindingEditor.tsx` is ~430 lines (over the ~400 CONTRIBUTING soft budget). It was already over
  before this change; I kept additions minimal per refactor discipline. A split (extracting the
  chart display/annotation block, mirroring `MetricBindingFields`) is a good spinoff candidate but
  out of scope for this focused change.

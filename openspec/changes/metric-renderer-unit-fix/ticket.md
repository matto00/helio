# HEL-295: Metric renderer fixes: render unit; no false "No data"

Part of [HEL-291](https://linear.app/helioapp/issue/HEL-291/agent-native-dashboard-usability-panel-aggregation-config-depth-and). Two concrete `MetricRenderer` defects seen on the prod Netflix dashboard.

## Defects

1. `unit` **is never rendered.** `MetricRenderer` draws only value + label + trend. A metric with `fieldMapping.unit = "/100"` shows just `84`, dropping the unit silently. (`frontend/src/features/panels/ui/renderers/MetricRenderer.tsx`)
2. **Spurious "No data".** The label falls back to the literal string `"No data"` when no label is present (`data?.label ?? "No data"`), so the "Avg User Rating" tile rendered `84` **with** `NO DATA` underneath even though the value was fine. Compounded by `label` being a **column reference** in `usePanelData` (`firstRow[label]`), not literal text — so a label that isn't a real column silently yields the fallback.

## Change

* Render `unit` adjacent to the value (e.g. `84 /100`).
* Only show the empty/"No data" state when the **value** is genuinely absent, never merely because a label is missing.
* Clarify label semantics (literal vs column ref) — coordinate with the config-depth ticket which exposes a literal `label`.

## Acceptance criteria

* A metric with a value and a `unit` renders `<value> <unit>` and no "No data".
* The "No data" state appears only when there is truly no value.

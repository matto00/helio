## Why

Text panels only render static authored `content` today — no path from a DataType to a Text panel exists.
HEL-243 (Metric) established the DataType-integration pattern and its design explicitly deferred
Text/Markdown, since neither has a `dataTypeId`/`fieldMapping` today. This closes that gap for Text.

## What Changes

- `TextPanelConfig` gains `dataTypeId`/`fieldMapping` (mirrors `MetricPanelConfig`), joining the
  "bound-capable" panel set alongside metric/chart/table.
- `TextPanel.scala` implements `dataTypeId`/`fieldMapping`/`buildQuery` for real (currently hardcoded
  `None`); `withBindingCleared` clears only the binding, preserving literal `content` (deliberate
  divergence from Metric's blanket-`Empty` reset — see design.md).
- No Flyway migration: the `panels` table's `type_id`/`field_mapping` columns are already generic
  (shared by metric/chart/table); Text starts populating them.
- `schemas/panel.schema.json`'s `TextConfig` gains `dataTypeId`/`fieldMapping`.
- New "Content" editor (mirrors `MetricValueEditor`, reuses `DataTypePicker`/`BoundOrLiteralField`/
  `useBoundOrLiteralState` per HEL-243's field-or-literal pattern): Source/Static mode toggle; Source
  shows `DataTypePicker` + a single field select; Static shows the content textarea. Wired into
  `PanelDetailModal`, which currently has no Text editor at all (a pre-existing gap this closes).
- `BoundOrLiteralField` gains an optional multiline literal input (Text's content is long-form, unlike
  Metric's single-line label/unit) — additive prop, unchanged default for existing callers.
- `isBoundCapablePanel` widens to include `TextPanel`; `usePanelData`'s existing generic per-slot
  mapping then populates `data.content` with no Text-specific code (`TextRenderer` already reads
  `data?.content ?? content` — added preemptively, unused until now).
- Panel-creation modal already lists `text` in `DATA_BOUND_TYPES` and passes a selected `dataTypeId`
  through; `buildCreatePanelBody`'s `text` case currently discards it — this wires it through.

## Capabilities

### New Capabilities

- `text-panel-content-source`: Text panel's Source/Static content modes, the content editor UI, and how
  bound vs. literal content resolves at render time.

### Modified Capabilities

- `panel-datatype-binding`: broadens the bound-capable panel set to include Text; documents Text's
  single-slot (`content`) field mapping and query-building behavior.
- `panel-config-field-or-literal-pattern`: documents `BoundOrLiteralField`'s new multiline option and
  Text as the pattern's first non-Metric consumer.

## Impact

Backend: `TextPanel.scala`, `PanelRowMapper.scala`, `schemas/panel.schema.json`. Frontend: `types/panel.ts`,
`panelNarrowing.ts`, `usePanelData.ts`, new `TextContentEditor.tsx`, `BoundOrLiteralField.tsx`,
`PanelDetailModal.tsx`, `panelPayloads.ts`. No new external dependencies.

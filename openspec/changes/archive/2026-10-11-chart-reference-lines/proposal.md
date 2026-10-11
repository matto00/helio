## Why

A chart cannot show a target (an SLO, a queue-time goal) today; authors put it in a separate tile or table
(HEL-1306, found building the helio-news CI Health dashboard). ECharts' markLine/markArea draw exactly this, but
`echartsCore.ts` registers neither component and no config carries a reference value.

## What Changes

- Two new chart Output config keys (owner ruling 1): `referenceLines` (up to 5 of `{value, label?, tone?}`) and
  `referenceBands` (up to 3 of `{from, to, label?, tone?}`, `from < to`). Static numbers only (ruling 3).
- Write-time validation of both keys (shape, caps, finite numbers, 60-char label, tone vocabulary) on every Output
  config write path; a violation is a 400 naming the key. Schemas, `KeysDoc`, helio-mcp docs updated.
- Rendering on bar, line, scatter and histogram charts (ruling 2) on the value axis only (ruling 4): a labelled line
  per entry and a translucent band per band; never on pie or heatmap, or a normalized (percent) stacked bar.
- Tone vocabulary `neutral | success | warning | error` (ruling 5, shared with HEL-1307, ruling 6) resolved from the
  theme's hex tokens, so lines track light/dark.
- An Output editor section to add, edit and remove lines and bands, shown for the four supported chart types.
- `MarkLineComponent` and `MarkAreaComponent` registered; bundle-size delta measured and noted in the PR.

## Capabilities

### New Capabilities

- `chart-reference-lines`: reference lines and bands on chart Outputs — config shape, rendering rules, editor.

### Modified Capabilities

- `output-routes-api`: the per-kind known-key set for chart Outputs gains `referenceLines` / `referenceBands`, and
  config writes validate them.

## Non-goals

- Computed lines (average, median, percentile) — a follow-up ticket (ruling 3).
- Category/x-axis (vertical) lines, histogram bin-index mapping, lines on the History view chart (`HistoryChart`).
- Any runtime coupling with HEL-1307's conditional formats (ruling 6).
- No migration (additive JSON config keys).

## Impact

- Backend: `OutputConfigValidation` (+ a new validator object), `PipelineCreatePreflight` (via `validate`),
  `AssistantProposalToolSchemas` / `RefinementEditShape` (via `KeysDoc`).
- Schemas: the three Output request schemas (`create-output-request`, `update-output-request`,
  `create-pipeline-transactional-output-request`).
- Frontend: `echartsCore.ts`, `buildChartOption.ts` (new pass), `chartAppearance.ts` theme tokens,
  `outputConfigTypes.ts`, `buildOutputConfig.ts`/`configPatch.ts`, `useOutputKindState.ts`, `OutputKindFields.tsx`,
  a new editor component. helio-mcp `tools/outputs.ts` docs.
- Public dashboards pick it up unchanged (the public meta route already returns the Output's whole config).

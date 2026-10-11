## Context

See proposal.md (Why) and ticket.md (owner rulings 1-7, 2026-10-11). Ground truth on main at b3a7efc96 (HEL-1311):
- `frontend/src/features/panels/ui/echartsCore.ts` registers Bar/Line/Pie/Scatter/Heatmap + Grid/Legend/Tooltip/
  VisualMap + Canvas; no MarkLine/MarkArea. Each entry carries a "why" comment the file requires.
- Chart Output config keys: `OutputConfigValidation.KnownKeys(Chart)` = shared + `chartType, aggregation,
  chartOptions, annotation`; `validate` is the single key/shape check, reached by `validateConfig` (create/PATCH/
  patch-set) AND `PipelineCreatePreflight.validateOutputConfig` (single-call pipeline create). `KeysDoc` feeds
  `AssistantProposalToolSchemas` and `RefinementEditShape`. Tolerance rule: only a changed value is judged.
- Schemas carrying Output `config` properties: `schemas/outputs/create-output-request.schema.json`,
  `update-output-request.schema.json`, `schemas/pipelines/create-pipeline-transactional-output-request.schema.json`
  (each has a long `config.description` listing keys per kind). helio-mcp `src/tools/outputs.ts` repeats the list.
- Render path: `ChartOutputPanel` -> `readChartConfig` -> `ChartRenderer` -> `ChartPanel` -> `useChartOption` ->
  `buildChartOption` (appearance merge -> `applyChartTypeOptions` -> heatmap theme -> `applyChartOverlay` ("vs") ->
  axis tooltip / hover emphasis -> compact pass). Bar `horizontal` swaps axes in `applyChartTypeOptions`; histogram
  is a bar series on a category x axis with counts on the value y axis.
- Editor: `useOutputKindState` (state + setters, dirty), `buildOutputConfig`, `configPatch.openingParams` (PATCH
  sends only changed top-level keys), `OutputKindFields.ChartKindFields` (renders `HistogramBinCountField`,
  `ChartCompareField`). `readChartConfig` (`outputConfigTypes.ts`) sanitizes what the renderer/editor read.
- Theme: `--app-success|warning|error|text-muted` are hex in both themes; `-surface` ones are `color-mix()` (C1).
- Public dashboards: `PublicPanelOutputMetaResolver` returns the whole Output config, so no backend change.

## Goals / Non-Goals

**Goals:** one validated shape across backend/schemas/frontend/MCP; marks always visible, themed, click-inert;
an editor that can only save valid config. **Non-Goals:** proposal.md Non-goals.

## Decisions

**D1 Config shape (ruling 1, 5, 7).** `referenceLines: null | [{value, label?, tone?}]` (0-5 items),
`referenceBands: null | [{from, to, label?, tone?}]` (0-3 items). `value/from/to` finite JSON numbers (strings
rejected), `from < to`. `tone` one of `neutral|success|warning|error`, absent = `neutral`. No other item keys. `[]`
and `null` both mean none. Label rule (ONE rule, all layers): `label`, when present, has raw length 1-60 AND at
least one non-whitespace character; the server stores it as sent (no trimming); the schema says
`minLength: 1, maxLength: 60, pattern: "\\S"`; the editor trims the draft before emitting and omits an empty label,
so it can only emit a value the other two accept. Absent label = render the formatted value (a band shows none).
Alternative "one key with a discriminated union" rejected: two arrays give each cap and error its own key name.

**D2 Backend validation.** New pure object `ChartReferenceMarks` (`domain/panels`, next to `ChartTypes`) with the
constants (`MaxLines=5`, `MaxBands=3`, `MaxLabel=60`, `Tones`) and `validate(written, stored)`. Called from
`OutputConfigValidation.validate` after `validateBinCount`, so `PipelineCreatePreflight` gets it with no edit there.
Judged per key only when the written value differs from stored (tolerance rule); messages name `referenceLines` /
`referenceBands` and the problem (e.g. "referenceLines allows at most 5 lines", "referenceBands[0]: from must be less
than to", "referenceLines[1].tone must be one of neutral, success, warning, error"). `KnownKeys(Chart)` gains both
keys; `KeysDoc` gains one sentence describing the shape and caps (built from the constants, not literals).
Validation is independent of `chartType` (ruling 2 preserves stored lines on an unsupported type).

**D3 Schemas + MCP.** The three Output request schemas gain `referenceLines` / `referenceBands` properties
(`type: [array, null]`, `maxItems`, item `additionalProperties: false`, `required`, `tone` enum, label
`minLength 1`/`maxLength 60`/`pattern "\\S"`) and the `config.description` key lists and rules mention them. `from < to` is not
expressible in JSON Schema; the description states it. helio-mcp `tools/outputs.ts` doc text lists both keys + caps.

**D4 Registration.** `MarkLineComponent`, `MarkAreaComponent` added to `echartsCore.ts` with "why" comments.
Bundle impact measured: `npm run build` chunk sizes (the lazy chart chunk and the main chunk) before/after,
recorded in the evidence dir and the PR body.

**D5 Render pass `applyReferenceMarks(option, chartType, chartOptions, marks, tokens, textColor)`.** New module
`frontend/src/features/panels/ui/referenceMarksOption.ts`. Returns its input unchanged when: chartType is pie or
heatmap; the bar is `stacking: "normalized"`; there are no valid marks; there is no series. Otherwise:
- Carrier: marks ride on ONE dedicated carrier series that is ALWAYS `type: "line"` (an empty `bar` carrier takes its
  own bar column and halves every bar, skeptic r1 probe 103.5 -> 52.1 px), `data: []`, no `name`, fixed id
  `__helio_reference_marks__`, `silent: true`, `tooltip: {show: false}`, `emphasis: {disabled: true}`; markLine and
  markArea themselves `silent: true` (series `silent` does not cover markers). `emphasis.disabled` does NOT stop
  ECharts blurring the marks when a data series with `focus: "series"` is hovered (skeptic r2 browser probe: line
  0.1, band 0.012), so `markLine.blur` keeps line + label opacity 1 and `markArea.blur` keeps band opacity 0.12 and
  label opacity 1 (applies to the series[0] fallback too). Rationale over series[0]: toggling a
  data series off in the legend must not hide the target.
- Pass order: called in `buildChartOption` AFTER `applyChartOverlay`, `applyAxisTriggerTooltip` and
  `applyHoverEmphasis` (all three count or style `toSeriesArray(option)`: `chartOverlayOption.ts:45` bails unless
  exactly 1 series, `chartAppearance.ts:240` switches to an axis tooltip at >1 series, hover emphasis sets `focus`)
  and BEFORE the compact pass (which only reads `overlayApplied` and the legend). So the overlay, the tooltip
  trigger and emphasis are computed on exactly the series they see today.
- Legend: every non-pie data option already sets `legend.data` explicitly (`chartDataOptions.ts`), and the carrier
  has no name, so it adds no entry; the executor verifies this rather than adding code.
- Value axis: `yAxis` normally, `xAxis` for a horizontal bar. markLine data `{yAxis: v}` / `{xAxis: v}`; markArea
  data `[[{yAxis: from}, {yAxis: to}]]` (or x).
- Visibility: ECharts 6.1 does not widen an axis for a mark (probe), so the value axis gets ECharts 6.1's
  `dataMin`/`dataMax` options (`dataMin = min(lowest mark, existing dataMin)`, `dataMax = max(highest mark, existing
  dataMax)`), merged into the data extent before zero inclusion and nice ticks. NOT `min`/`max` callbacks, which pin
  both ends and drop the zero baseline (probe: [5,37.3] instead of [0,40]).
- Fallback: if on the running app the carrier still alters bar width, the overlay, the tooltip trigger, emphasis or
  the legend, put marks on series[0] instead and record why in files-modified.md.
- Style: line `lineStyle: {color: tone, type: "solid", width: 1.5}`, `symbol: "none"` — SOLID, so it is never
  confused with the dashed muted "vs" overlay line (`chartOverlayOption.ts`, dashed, 2px); label
  `position: "insideEndTop"`, `color: tone`, font from the existing textStyle, formatter = label or
  `formatChartNumber(value)`; band `itemStyle: {color: tone, opacity: 0.12}`, label (if any) `insideTop`,
  `color: textColor`. Animation off when `prefersReducedMotion()`.
- Tone colours (C1): `ChartThemeTokens` gains `success`, `warning`, `error` read via `parseableOr` from
  `--app-success|warning|error` (dark-theme hex fallbacks); `neutral` = existing `textMuted`. Never a `-surface`
  token or a `color-mix()` value.
- Band labels (cycle 2): a markArea's label takes the markArea's z, so a label in the fill area (z 1) was painted
  under the bars (z 2). The fill therefore carries no label; labels ride a SECOND nameless line carrier
  (`__helio_reference_band_labels__`) whose markArea is fully transparent at z 5, with a `surfaceStrong` text halo so
  the text stays legible where a bar passes behind it. Compact mode (`effectiveCompact`: the whole mobile panel stack,
  or any chart measured at 179px or less, `CHART_COMPACT_HEIGHT_PX`; the 375px stack plots are about 70px tall, where a
  label can only sit on the bars) HIDES band labels; line labels stay and carry the same halo. Verified at 375px.

**D6 Click inertness (already true).** `useChartClickHandler` returns early on `params.componentType !== "series"`,
and a mark click reports `markLine`/`markArea`, so no selection results; a mark click falls through to the panel-body
handler exactly like a grid click. No new guard; a test pins it (task 3.5).

**D7 Frontend config read.** `ChartOutputConfig` gains `referenceLines` / `referenceBands`; `readChartConfig`
sanitizes them with ONE shared pure module `utils/referenceMarks.ts` (types, `REFERENCE_TONES`,
`MAX_REFERENCE_LINES=5`, `MAX_REFERENCE_BANDS=3`, `MAX_REFERENCE_LABEL=60`, `sanitizeReferenceMarks`): invalid items
are dropped (renderer never throws on legacy/bad stored data), caps applied. echarts-free, so the editor imports it
without the lazy chart chunk. `ChartOutputPanel` passes them to `ChartRenderer` -> `ChartPanel` -> `useChartOption`
(memo deps) -> `buildChartOption`; the editor preview (`OutputPreviewPane`/`OutputSheetPreviewCard`) too.

**D8 Editor.** New `outputEditor/ReferenceMarksField.tsx`, rendered in `ChartKindFields` only for bar/line/scatter/
histogram. Rows of Value (numeric `TextField`), Label (max 60), Tone (`Select`: Neutral/Good/Warning/Critical
labels for neutral/success/warning/error, matching HEL-1307's tone words); "Add line" disabled at 5; bands section
(From, To, Label, Tone), "Add band" disabled at 3; remove buttons with accessible names. Invalid drafts (empty,
non-numeric or non-finite value, e.g. `1e400`; from >= to; trimmed label over 60) show an inline error and BLOCK Save (same pattern as
`binCountInvalid`). State in `useOutputKindState` (dirty/cancel), emitted by `buildOutputConfig`, diffed by
`configPatch` (an untouched Output sends neither key; clearing all sends `null`). 44px touch targets, shared UI
components and tokens only (DESIGN.md). On an unsupported chart type the field is hidden and stored marks are kept.

**D9 Seam test (red first) and guard.** Shared fixture `shared-test-fixtures/chart-reference-marks.json` (repo
convention, as `OutputSummaryReducerSeamSpec`) holding: `limits` `{maxLines, maxBands, maxLabel, tones}`; `editorState`
(an editor input) and `validConfig` (the exact config it must produce); `schemaRejects` (string value, 6 lines, 4
bands, tone `red`, 61-char label, whitespace-only label, extra item key, non-array) and `serverOnly` (`from >= to`,
metric kind + `referenceLines`), each with its expected server message fragment.
- Frontend seam (`referenceMarksSeam.test.ts`): `buildOutputConfig` for `editorState` `toEqual` `validConfig`'s keys,
  and the `configPatch` PATCH body for that edit carries exactly those keys (the `layoutCreateSeam.test.ts` pattern);
  `validConfig` validates (Ajv2020) against all three Output request schemas; each `schemaRejects` case is rejected by
  all three; `sanitizeReferenceMarks` case by case: an invalid item is dropped, an over-cap list
  is truncated to the cap, a non-array reads as none (the kind-mismatch case is server-only, not a reader concern).
- Backend seam (route spec): POST and PATCH `validConfig` -> 201/200 and GET round-trips it identically; single-call
  pipeline create with it -> 201; each invalid case -> 400 whose message contains the case's expected fragment
  (e.g. `at most 5`, `from must be less than to`, `tone must be one of`). On main every case returns the generic
  `Unknown config key` 400, so these are red before the change; that red output is saved in evidence.
- GUARD (labelled; mutation-proven, red output saved): `ChartReferenceMarksSpec` asserts the Scala constants equal
  `limits`; a Jest test asserts the TS constants equal `limits` and walks the three schemas (asserting exactly 3
  found) checking `maxItems`, `maxLength` and the `tone` enum against `limits`.

## Risks / Trade-offs

- [HEL-1307 also edits `OutputConfigValidation`, the same schemas' descriptions, `KeysDoc`] -> expect a textual
  merge; re-sync with origin/main before PR and re-run the seam/guard tests after the merge.
- [Carrier series affects legend/tooltip/click] -> D5 legend.data, silent, tooltip off; verified on running app.
- [dataMin/dataMax must not change a no-mark or in-range chart] -> unit test: extent identical with a mark inside
  the data range; a mark above widens it with zero still included.
- [HEL-1307 overlaps editor files too (`useOutputKindState`, `buildOutputConfig`, `configPatch`, preview cards,
  schemas, MCP docs)] -> rebase/merge after 1307 lands; rerun every seam test.
- [Canonical known-key requirement lists chart keys exhaustively] -> at the pre-PR re-sync, if HEL-1307 has merged,
  add a MODIFIED delta of "Output config writes reject unknown keys per kind" copied from the post-1307 canonical
  text with the chart clause gaining `referenceLines`, `referenceBands`; if it has not, MODIFY it from current main
  text and note that 1307 must re-base its delta (stated in the PR body). The archived spec must not contradict itself.
- [Normalized stack silently hides marks] -> editor shows a hint under the field when stacking is normalized.
- [Bundle growth] -> measured (D4).

## Migration Plan

None (additive JSON keys; no Flyway). Rollback = revert; stored keys become tolerated legacy keys, not rendered.

## Planner Notes

- Self-approved: solid 1.5px lines, 0.12 band opacity, label positions, tone labels Neutral/Good/Warning/Critical
  (HEL-1307's words), line carrier with series[0] fallback. Histogram needs no bin-index mapping (ruling 4).
- Follow-up to file: computed reference lines (avg/median/percentile) — owner ruling 3.

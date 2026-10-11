- `backend/src/main/scala/com/helio/domain/panels/ChartReferenceMarks.scala` — new pure validator + constants (caps, label limit, tones, KeysDoc sentence) for `referenceLines`/`referenceBands` (D1/D2)
- `backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala` — both keys added to `KnownKeys(Chart)`, validator wired into `validate` (reaches every write path incl. single-call create), `KeysDoc` extended
- `backend/src/test/scala/com/helio/domain/panels/ChartReferenceMarksSpec.scala` — every rejection, tolerance rule, and the Scala-constants-vs-fixture GUARD
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputReferenceMarksSeamSpec.scala` — backend seam: POST/PATCH/single-call round trip and every invalid fixture case via real routes (red on main saved to evidence)
- `backend/src/test/scala/com/helio/services/pipelines/OutputConfigValidationSpec.scala` — known-keys placeholder test excludes the shape-checked keys; new keys cases
- `shared-test-fixtures/chart-reference-marks.json` — shared limits, editorState, validConfig, schemaRejects, serverOnly (D9)
- `schemas/outputs/create-output-request.schema.json`, `schemas/outputs/update-output-request.schema.json`, `schemas/pipelines/create-pipeline-transactional-output-request.schema.json` — both properties (maxItems, item shape, tone enum, label minLength/maxLength/pattern) and description text
- `helio-mcp/src/tools/outputs.ts` — OUTPUT_CONFIG_KEYS_DOC lists both keys, caps and rules
- `frontend/src/utils/referenceMarks.ts` — echarts-free types, constants, `sanitizeReferenceMarks`, label rule
- `frontend/src/utils/referenceMarks.test.ts`, `frontend/src/utils/referenceMarks.guard.test.ts` — sanitizer unit tests; GUARD for TS constants + exactly three schema definitions vs fixture limits
- `frontend/src/utils/chartAppearance.ts` (+ `.test.ts`) — `success`/`warning`/`error` tone tokens via `parseableOr`; `textMuted` now also `parseableOr` (C1)
- `frontend/src/features/panels/ui/referenceMarksOption.ts` — `applyReferenceMarks`: line carrier, dataMin/dataMax widening, blur pins, tones (D5)
- `frontend/src/features/panels/ui/referenceMarksOption.test.ts` — D5 tests measured on a real ECharts SSR instance (extent, bar width, legend, tooltip, blur, axes, tones)
- `frontend/src/features/panels/ui/buildChartOption.ts`, `useChartOption.ts`, `ChartPanel.tsx`, `renderers/ChartRenderer.tsx`, `ChartOutputPanel.tsx` — thread `referenceMarks`; pass runs after overlay/tooltip/emphasis
- `frontend/src/features/panels/ui/ChartPanel.referenceMarks.test.tsx`, `ChartOutputPanel.referenceMarks.test.tsx` — threading + mark click makes no selection (task 3.5)
- `frontend/src/features/panels/ui/echartsCore.ts` — registers MarkLineComponent, MarkAreaComponent
- `frontend/src/features/pipelines/ui/outputEditor/ReferenceMarksField.tsx`, `referenceMarksDraft.ts` (+ test) — editor section and pure draft->config conversion
- `frontend/src/features/pipelines/ui/outputEditor/OutputKindFields.tsx`, `OutputKindConfigCard.tsx`, `OutputEditorSheet.tsx`, `OutputSheetPreviewCard.tsx`, `OutputPreviewPane.tsx`, `useOutputKindState.ts`, `buildOutputConfig.ts`, `configPatch.ts`, `outputConfigTypes.ts`, `OutputEditorSheet.css` — state, builder (explicit null clears), baseline seed, preview, Save-blocking, styles
- `frontend/src/features/pipelines/ui/outputEditor/referenceMarksSeam.test.ts`, `OutputEditorSheet.referenceMarks.test.tsx`, `buildOutputConfig.test.ts` — frontend seam (Ajv2020 against all three schemas), sheet behaviour, builder
- `frontend/src/features/pipelines/ui/outputEditor/__snapshots__/OutputEditorSheet.openingState.test.tsx.snap`, `OutputEditorSheet.compare.test.tsx`, and six `ChartThemeTokens` test fixtures (`chartOverlay.heatmapHistogram.test.ts`, `ChartPanel.defaultAppearance.test.tsx`, `ChartPanel.theme.test.tsx`, `PanelCard.aggregatePieChart.test.tsx`, `buildChartOption.{heatmapHistogram,overlay,textColor}.test.ts`) — new controls/keys/required tokens
- `e2e/hel1306-chart-reference-lines.spec.ts` — live dashboard (bar above data + band, overlay + neutral line, hover/legend) and editor, light/dark x 1440/375; fixtures recorded and deleted by exact id
- `openspec/changes/chart-reference-lines/specs/output-routes-api/spec.md` — MODIFIED known-key requirement added (copied from current canonical text; HEL-1307 must re-base its delta)
- `openspec/changes/chart-reference-lines/tasks.md` — tasks ticked

## Cycle 2 (evaluation-1.md)
- `frontend/src/features/panels/ui/referenceMarksOption.ts` — CR1: band labels moved to a second transparent markArea carrier at z 5 (fill stays z 1, under bars), `surfaceStrong` text halo; band labels hidden in compact mode (new `bandLabels` param)
- `frontend/src/features/panels/ui/buildChartOption.ts` — passes `!effectiveCompact` as `bandLabels`
- `frontend/src/features/panels/ui/referenceMarksOption.test.ts` — display-list z assertion on real ECharts (red under mutation, `cycle2-mutation-label-z.txt`), compact hides band labels, fill carries no label
- `e2e/hel1306-chart-reference-lines.spec.ts` — asserts live label z 5 > bar z 2 at 1440, no band label at 375
- `frontend/src/utils/referenceMarks.ts` — CR2 comment pointer fixed; label length counted in code points
- `backend/src/main/scala/com/helio/domain/panels/ChartReferenceMarks.scala` — label length in code points (matches JSON Schema maxLength); tests `ChartReferenceMarksSpec`, `OutputReferenceMarksSeamSpec` (red: `cycle2-backend-codepoint-red.txt`), `referenceMarks.test.ts`, `referenceMarksSeam.test.ts`
- `shared-test-fixtures/chart-reference-marks.json` — `schemaAccepts` (31 and 60 emoji labels) and a 61-emoji reject case
- `openspec/changes/chart-reference-lines/design.md` — D5 band-label/compact decision, code-point label rule

## Final-gate fix round (skeptic-final-1.md)
- `frontend/src/features/panels/ui/referenceMarksOption.ts` — line labels get the `surfaceStrong` text halo (shared `LABEL_HALO_WIDTH`)
- `frontend/src/features/panels/ui/referenceMarksOption.test.ts` — halo test on line and band labels (red under mutation: `final1-mutation-line-halo.txt`)
- `frontend/src/features/pipelines/ui/outputEditor/ReferenceMarksField.tsx` (+ `OutputEditorSheet.referenceMarks.test.tsx`) — label inputs no longer use UTF-16 `maxLength`; 60 code points accepted, 61 flagged inline and Save blocked
- `openspec/changes/chart-reference-lines/specs/chart-reference-lines/spec.md` — compact exception on the band requirement plus a "Compact chart" scenario
- `openspec/changes/chart-reference-lines/design.md` — D5 compact trigger described as `effectiveCompact` (mobile stack or measured height <= 179px)
- `e2e/hel1306-chart-reference-lines.spec.ts` — marked bar also carries an unlabelled line at 25 crossing the last bar (screenshots in `screenshots-f1/`)

## Full-path declarations (orchestrator, Delivery)

Branch files whose earlier entries were basename-only or relative and did not resolve for squash-branch.sh; each is part of this change's own commits (diff against merge-base b3a7efc96).

- `frontend/src/features/panels/history/chartOverlay.heatmapHistogram.test.ts`
- `frontend/src/features/panels/ui/ChartOutputPanel.tsx`
- `frontend/src/features/panels/ui/ChartPanel.defaultAppearance.test.tsx`
- `frontend/src/features/panels/ui/ChartPanel.theme.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.aggregatePieChart.test.tsx`
- `frontend/src/features/panels/ui/buildChartOption.heatmapHistogram.test.ts`
- `frontend/src/features/panels/ui/buildChartOption.overlay.test.ts`
- `frontend/src/features/panels/ui/buildChartOption.textColor.test.ts`
- `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.compare.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/referenceMarksDraft.test.ts`
- `frontend/src/utils/chartAppearance.test.ts`

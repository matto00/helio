# HEL-1313: Validate Output config keys; fix ignored chart aggregation on Output panels

## Description

Found while designing the CI Health dashboard in helio-news. A typo'd config key is silently accepted and ignored, so
`build.py` needed read-back assertions after every write. Chart `aggregation` config on an Output is stored but never
applied.

Evidence (as filed 2026-10-05; see Premise Validation below for what changed since):

* `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala:459-460` `validateConfig` checks only
  `fieldMapping` and `compare`; unknown keys pass.
* `frontend/src/features/panels/hooks/usePanelData.ts:46,240,269` `chartAggregate: null` for Output panels, so chart
  `aggregation` (consumed in `buildChartOption.ts:90`) never takes effect.

What: validate Output config against a per-kind known-key set (reject or warn on unknown keys, with a did-you-mean
hint), and either wire `aggregation` through on Output panels or reject it at validation.

## Acceptance Criteria

- [ ] An unknown/typo'd config key returns 400 naming the key (or a documented warning), for each kind.
- [ ] Chart `aggregation` either affects the rendered chart or is rejected with a clear error (tested).
- [ ] Existing stored configs with legacy keys do not break reads (migration or tolerance covered).

## Premise Validation (orchestrator, 2026-10-08, against main 55b7c4269)

- HEL-1351 (#820, de1ae5b00) already wired a WELL-FORMED chart aggregation `{groupBy, agg, yField}` through on the
  dashboard (`ChartOutputPanel.tsx` groups client-side via `chartAggregationSpec`). AC2's remaining gap: a malformed or
  inapplicable aggregation (missing/empty groupBy/yField, agg outside count|sum|avg|min|max, metric-shaped
  `{value,agg}` on a chart, aggregation on a scatter chart, aggregation on a kind that never reads it) is still stored
  and silently ignored, and nothing validates `aggregation` on any write path.
- `validateConfig` now also validates `historyPayloads` (HEL-1276); unknown keys still pass. The single-call pipeline
  create / proposal grounding path (`PipelineService.validateOutputFieldMapping`) is a second validator that must get
  the same checks.
- Stored legacy keys exist (migration V94 wrote `metricLabel`, `metricUnit`, `columnWidths`, `tableDensity`,
  `chartAnnotation`, `collectionOptions`, `timelineOptions`; dead deep-merge keys `legend`/`tooltip`/`seriesColors`/
  `axisLabels`). PATCH validates the merged config, so naive rejection would break updates of those Outputs.
- Full evidence: `.concertino/runs/HEL-1313/evidence/premise-validation.md`.

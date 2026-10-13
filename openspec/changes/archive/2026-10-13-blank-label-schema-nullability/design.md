## Context

See proposal.md (Why). Owner rulings recorded 2026-10-12 (escalation HEL-1424-1791873620011-3ecf7d, all four
recommendations): label "(blank)" + DESIGN.md rule; exactly four surfaces; relabel stored "null" in history;
persist optional `nullable` going forward, legacy reads `true` for CSV sources and Outputs, no migration, no V130.

Current tree (fd8e8a78c):
- `frontend/src/utils/aggregate.ts` `groupAndAggregate` keys groups by `String(row[groupBy])`, so null becomes
  "null" (null and the text "null" share one group today, unchanged by this change).
- `ChartOutputPanel.tsx` computes `groupHasNull` (strict `=== null`) and `chartClickSelection.ts:151` maps a click on
  "null" to `""` only when `groupHasNull`. `chartDataOptions.ts:232-260` renders `aggregate.categories` as axis data
  and pie names. `OutputPreviewPane.tsx:106` aggregates without `groupHasNull`.
- History: server `OutputSummaryReducer` stores the category "null" (`JsSemantics.jsString(JsNull)`).
  `HistoryChart.tsx` renders grouped points; `chartOverlayOption.ts:34-41` aligns overlay x to primary categories by
  `String(x)`.
- `CrossFilterIndicator.tsx:22-25`, `PanelInspectView.tsx:130` (header) and `:157-158` (button) print the raw value.
- `SchemaField(name, type)` (`domain/engine/SchemaField.scala`) persists as `{name,type}` via
  `PipelineAnalyzeService.schemaFieldJsonFormat` into `data_sources.inferred_schema` and `outputs.schema`.
  CSV writes: `DataSourceService` createCsv (~306), createCsvUrl (~375), refresh (`upsertSourceDataType` ~1338).
  Output writes: `PipelineRunSucceededWrites.scala:143-146`, `PipelineRunBackfill.scala:167-169`.
  Reads pin `false`: `InferredFieldResponse.fromDomain` (`DataSourceProtocol.scala:257`),
  `PanelCapabilityService.scala:77`, `WorkspaceContextService.scala:396`.
- `SchemaInferenceEngine.fromCsvLines` folds nullability over only the first 100 rows (`InferSampleRows`);
  `inferShallowFromJsObjects` hardcodes `nullable = false` (its comment about a caller pinning `true` is stale).

## Goals / Non-Goals

**Goals:** spec behavior in `specs/blank-category-label` and `specs/stored-schema-nullability`; AC3 test nits.

**Non-Goals:** see proposal Non-goals. Also: no change to `PipelineSchemaDrift` (compares name+type only, so a
nullable-only change is never drift), to `SchemaFieldResponse` (analyze wire shape), or to grouping semantics.

## Decisions

**D1. One shared label module.** Add `frontend/src/utils/blankLabel.ts` exporting `BLANK_LABEL = "(blank)"` and
pure helpers: `selectionValueLabel(value)` (`""` -> label, else value) and a category relabel helper. Every surface
imports it; no second literal "(blank)" in non-test code. Alternative (inline strings per component) rejected: the
click mapper and the renderer must agree on one value.

**D2. Relabel inside `buildChartOption`, after `applyChartOverlay`; keys stay raw.** `groupAndAggregate` and its
group keys are unchanged. `buildChartOption` builds the option from raw categories (`buildChartOption.ts:148`), then
`applyChartOverlay` aligns overlay points to `xAxis.data` by `String(c)` (`:271`, `chartOverlayOption.ts:30-46`).
A new `BuildChartOptionParams` flag (e.g. `blankCategory: boolean`, fed from `groupHasNull`) makes `buildChartOption`
relabel the "null" category to `BLANK_LABEL` as a final step AFTER `applyChartOverlay`: the `data` of whichever
axis is the category axis (`xAxis` for vertical bar/line, `yAxis` for a horizontal bar, whose categories
`applyChartTypeOptions` moves there, `chartTypeOptions.ts:131-136`) and pie `data[].name` (legend and tooltip read
these). Only the aggregate plan with a category axis is
relabelled; the time-axis plan (`chartTimeDataOptions.ts`) is untouched. Because alignment runs on raw keys first,
a live chart's history overlay keeps its blank-group point (test: `buildChartOption` with an overlay whose points
include `"null"` and `blankCategory: true` -> the overlay series value sits at the `(blank)` index). Because every
orientation is relabelled, a click on the blank category always reports `params.name === BLANK_LABEL`; the click
mapper maps `BLANK_LABEL && groupHasNull` -> `""` (replacing the `"null"` check) for vertical, horizontal and pie
alike, with tests for each orientation (render + click). Alternative
(relabel the aggregate in `ChartOutputPanel` before the build) rejected: overlay alignment would no longer find the
blank group. Alternative (re-key null groups in `groupAndAggregate`) rejected: splits the shared null/"null" group.

**D3. Preview parity.** `OutputPreviewPane` computes `groupHasNull` the same way `ChartOutputPanel` does (factor the
predicate into the shared module or a shared helper so both use one strict `=== null` check) and passes it to the
same relabel step. Click stays unwired in the preview.

**D4. History.** `HistoryChart.tsx` renders a stored series as raw rows (`String(p[0])`) plus a "vs" overlay from
`selectPointOverlay` (`chartOverlay.ts:134-156`) matched by `String(x)`. For a grouped (categorical) series, BOTH the
selected rows' x and the comparison overlay points' x map a stored "null" to `BLANK_LABEL` before they reach
`buildChartOption`, so they stay aligned (owner ruling 3: unconditional; history cannot distinguish a null group
from the text "null"). Time-series history points are not relabelled. A live chart's overlay is covered by D2
(the overlay keeps raw "null" and aligns before the relabel). Server reducer and stored history unchanged.

**D5. Selection headers.** `CrossFilterIndicator` and both `PanelInspectView` strings render
`selectionValueLabel(value)`. Redux selection/cross-filter values and the `setCrossFilter` dispatch are untouched
(standing constraint C1).

**D6. Persisted nullability: `SchemaField(name, type, nullable: Option[Boolean] = None)`.** The default keeps every
existing construction site compiling and analyze-derived fields `None`. JSON write emits `nullable` only when
`Some`; read accepts its absence (and a non-boolean value reads as absent). The structural `require` on `type` is
kept. Write paths that know nullability pass `Some(..)`: the three CSV sites from `InferredField.nullable`, the two
Output sites from the shallow inference. `upsertSourceDataType` (`DataSourceService.scala:1332-1339`) is
shared by CSV, text, pdf and image refresh: it passes `Some` only for CSV; content kinds stay `None`. REST/SQL (`SchemaInferenceFacade`), dataset, text/pdf/image and static
writes stay `None`. Equality: grep every `==`/`!=`/`distinct`/`toSet` over `SchemaField`/`Vector[SchemaField]`
values; any comparison that means "same columns" must compare name+type only, or document why nullability belongs.

**D7. Read defaults are per kind, not global.** `InferredFieldResponse.fromDomain` takes the legacy default from its
caller: the CSV variant passes `true`, every other variant `false` (today's value), and a `Some(v)` always wins.
`PanelCapabilityService.columnsOf` and `WorkspaceContextService.toDataTypeEntry` read `nullable.getOrElse(true)`
(Outputs). `PipelineNodeReads.buildNodeCapabilities` is unchanged (node schemas are analyze-derived).

**D8. Inference.** `fromCsvLines`: nullability folds over every data row as a streaming fold over the line
iterator (never a whole-file `toVector`; `fromCsvBytes` documents that it does not materialise the file). Blank and
whitespace-only LINES are skipped by the fold, matching the row loader (`InProcessPipelineEngine.scala:807`), so a
trailing newline no longer marks every column nullable; `SchemaInferenceEngineSpec.scala:724-726`
(`fromCsv("a,b\n1,2\n")` -> `Seq(true, true)`) is deliberately updated to `Seq(false, false)`. A blank CELL in a
non-blank line still marks nullable. The header-only case stays `false`. Type stays `string`.
`inferShallowFromJsObjects` computes `nullable = presentNonNullCount < objects.size` per key (JsNull or absent counts
as null), mirroring `inferFromObjects`; fix its stale comment. The executor confirms the Output write paths infer
over the full materialized node rows; if over a capped sample, a column is `nullable: true` unless every
materialized row was checked.

**D9. DESIGN.md.** Add a short copy rule near "Nulls sort last": a null/blank category or selection value is shown
as "(blank)"; data grids keep an empty cell.

## Risks / Trade-offs

- [A real text value "(blank)" in a group that also has nulls is clicked as blank] -> same accepted trade-off the
  `"null"` check had; documented in a comment.
- [History shows a real "null" text group as "(blank)"] -> owner-accepted (ruling 3).
- [Patch-set fingerprints hash `inferredSchema`] -> a preview taken before deploy and applied after may 409 once
  (`PATCH_SET_STALE`), never a silent wrong apply. Acceptable.
- [Legacy CSV with no blanks reports `true` until refresh] -> conservative by ruling; self-heals.
- [Scanning every CSV row for nullability] -> streaming fold, bounded by existing CSV size limits.
- [Content-kind refresh writing `Some(false)`] -> avoided: only CSV passes `Some` (D6).
- [Add-source modal's nullable checkbox is ignored server-side (`FieldOverridePayload` has no `nullable`)] ->
  pre-existing, out of scope; follow-up candidate.

## Migration Plan

None (no Flyway migration, no V130). Rollback: revert; old code ignores the extra `nullable` key on read.

## Planner Notes

- Self-approved: D2 presentation-layer relabel; D7 per-kind default; D8 full-row CSV scan; node capabilities out.
- HEL-1502 (PR #985) files are off-limits: `TimestampParsing.scala`, `CastStep.scala`, `chartTimeAxis.ts`.
- PR body still carries read-only count queries (legacy CSV sources / Outputs without a `nullable` key) so the owner
  can see the self-heal surface, though no data migration ships.

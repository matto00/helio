## Context

Paths under `frontend/src/` unless stated. Facts read from the tree at `c1add2394` (HEL-1631 merged).

- **Reserved track.** `features/pipelines/ui/spine/PipelineSpineLayout.tsx:286` renders an empty `<div className="spine-body__live-output" aria-hidden="true" />`; `PipelineSpineLayout.css` sets `--pipeline-live-output-width: 0px` and the body grid `clamp(180px, max(34cqi, min(240px, 100cqi - 320px)), 340px) minmax(0,1fr) var(--pipeline-live-output-width)` keyed to the page container (`container-type: inline-size` on `.pipeline-detail-page--spine`). `PipelineDetailPage.spine.test.tsx:207` asserts the slot is empty and zero-width (must change).
- **Draft frames.** `features/pipelines/hooks/usePipelineDraftFrames.ts` walks base and draft ONLY while `hasDraft` (`baseDefs`/`draftDefs` null otherwise) and returns `views: Map<stepId, DraftStepView>` (`status ok|error|pending|stale|notPreviewed`, `count`, `rows: Frame|null`, `frameStale`, `message`), `baseRows`, `baseCounts`, `sampleTruncated`, `pending`. A server-resolved step's rows exist only for the focused step (`buildDraftPreviewRequest({focusStepId})` → `rowsStepId`). Consumed via `hooks/usePipelineDraftPresentation.ts` (`usePipelineDraftPresentation(page, selectedStepId)`) in both `PipelineSpineLayout` and `ui/mobile/PipelineMobileLayout.tsx`.
- **Frame values.** `features/pipelines/evaluator/value.ts`: `Value = null|boolean|string|number|Integral`; `Integral` is a class (`String(integral)` is `"[object Object]"`), so a frame row is not directly a panel record.
- **Saved panel path.** `features/panels/ui/OutputPanelContent.tsx` → `ChartOutputPanel.tsx` (`readChartConfig`, `resolvePanelChartType`, `chartAggregationSpec`, `groupAndAggregate` over `records`, `groupHasNull`, `sanitizeReferenceMarks`, `toChartFieldTypes(schema)`, plus `useOutputHistory` for the compare overlay) and `MetricOutputPanel.tsx` (`resolveServerMetricField(config)`, `computeAggregate(records, field, agg)` = `loadedValue`; the headline is `view.headline` from history when present — `metricHistoryView.ts:118,170` — else `loadedValue`). Records → `headers`/`rawRows` in `features/panels/hooks/usePanelData.ts:~320-337` (`Object.keys(rows[0])`, `Object.values(row).map(v => v == null ? "" : String(v))`).
- **Editor preview path.** `features/pipelines/ui/outputEditor/OutputPreviewPane.tsx` renders `ChartRenderer`/`MetricRenderer`/a simple table from editor STATE props (`metricField`, `chartGroupBy`...), not from a saved config; its metric field rule (`metricField`) is not `resolveServerMetricField`, so it is not parity-safe against a saved config by itself.
- **History.** `features/panels/history/outputHistoryCache.ts` (`outputHistoryKey`, `loadHistory`, `refreshHistory`, `subscribeHistory`), `outputHistoryService.ts` `fetchOutputHistory`; `OutputHistory.current: {capturedAt, rowCount, value} | null`.
- **Outputs on the page.** `page.allOutputs` (the spine already lists them), `outputsByStepId`; `Output.nodeStepId?` / `rootId?`, `kind`, `config`, `schema`.
- **Run refresh.** `hooks/usePipelineRunAndSaveActions.ts:54` `refreshVisibleOutputPreviews` runs after a run (and the draft save path in `usePipelineDraftSave.ts` after Save & run).
- **DESIGN.md §11:** the "live" marker (success-intent dot + lowercase mono "live") appears only on a surface recomputed from the current draft. §0 accent discipline: accent only on the primary action, selection and focus.

## Goals / Non-Goals

**Goals:** the ticket's three ACs; parity with the saved panel by shared code plus a test; zero requests per edit; no regression of the HEL-1631 edit-latency test; desktop, narrow-desktop and phone placement that DESIGN.md accepts.

**Non-Goals:** editing an Output's config while drafting (blocked by HEL-1631 D2; HEL-1684); the chart compare overlay (`config.compare`) in the column (it is a history read per Output and compares against saved rows — omitted, listed); history sparkline; HEL-1685 polish; any backend change.

## Decisions

### D1. Shared pure render-input functions (parity by construction)

New module `features/panels/ui/outputRenderInputs.ts` (pure, unit-tested), extracted behaviour-preservingly from the saved path:

- `recordsToPanelRows(records) → {headers: string[] | null, rawRows: string[][] | null}` — the exact `usePanelData` conversion; `usePanelData` (and `usePublicPanelData` if it has the same code) call it.
- `chartRenderInputs({config, schema, appearance, records, rawRows, headers}) → {appearance (resolved type), fieldMapping, chartAggregate, aggregationSpec (click spec), chartOptions, annotation, referenceMarks, fieldTypes}` — the body of `ChartOutputPanel` minus the history overlay. `ChartOutputPanel` keeps its `useMemo`s by calling the pieces (or one memoized call) so its re-render behaviour is unchanged.
- `metricLoadedValue(config, records, rawRows, headers) → string` — `MetricOutputPanel`'s `loadedValue`.
- `keyAggregate(kind, config, records) → {label, value} | null` — metric: `resolveServerMetricField(config)` + `computeAggregate`; chart: the `chartAggregationSpec` agg over its `yField` when the spec exists; else `null` (only the rows tile shows). Label `"<AGG> <FIELD>"` uppercase mono like the board ("AVG MINUTES" uses the config unit/label when present; executor picks the label rule and lists it).

The existing panel tests (`ChartOutputPanel.*.test.tsx`, `MetricOutputPanel*`, `usePanelData*`) must pass unchanged; that is the behaviour-preservation evidence.

### D2. Frame → records

`frameToRecords(frame: Frame, schema) → Record<string, unknown>[]`: `Integral` → its `value` number, everything else as is. Rows are the node's full frame (≤ the sample's 1,000 rows, no 50-row cut), which is what a panel with all rows loaded renders.

**Column order is a known, documented divergence (skeptic-design-1 CR1).** The saved panel's column order is NOT reproducible client-side: rows are stored as JSONB (keys re-ordered by Postgres) and parsed back into a spray-json `JsObject` (`NodeSnapshotRepository.scala:227`), whose `Map` iteration order is not insertion order beyond 4 fields. The live path therefore orders columns deterministically by the Output's declared `schema` field order (`output.schema`), then any extra frame keys in frame order, via one exported function `orderLiveColumns`. Order-dependent cases where the live render can differ from a saved panel for the same rows: a chart with no xAxis mapping (`headers[0]`, `chartClickSelection.ts:35`), the pie / no-yAxis first-numeric-column fallback, and the read-only table's column order when the Output has no `columns` config. Every case with an explicit field mapping or column config is order-independent and covered by the parity test; the no-xAxis-mapping case is pinned by a test asserting the live render uses schema order. Listed in the PR as a known divergence (a follow-up candidate: make the saved path's order deterministic server-side).

### D3. Which rows: the node's frame from the walks, always computed when there is an Output

`usePipelineDraftFrames` gains an always-on base walk when the pipeline has ≥1 Output (`needBase = hasDraft || outputCount > 0`): with no draft the column renders the saved pipeline over the sample; counts and preview table with no draft are UNCHANGED (views stay `null`, no transport). It exposes `baseNodes` (status + rows per node, including root frames for an Output bound to a root). The first draft edit no longer pays the base walk (it is already memoized), so this cannot slow the edit-latency test.

Resolution per displayed Output (pure `liveOutputSource(...)`, unit-tested), node = `nodeStepId` (or the root's frame for `rootId`):

| state | rows shown | marker | caption |
|---|---|---|---|
| no draft, base node ok/disabled | base frame | none | "Rendered from the saved pipeline over the cached sample." |
| no draft, base node not client-evaluable (needsServer/notPreviewed/blocked) | saved rows (D5) | "saved" (neutral) | "Showing the last run." |
| draft, view `ok`, not `frameStale` | draft frame | **live** (success dot + mono "live") | "Rendered from the draft. Nothing is written until you save and run." |
| draft, view `pending` | last good frame (view rows, else base frame) | "updating" (neutral) | same draft caption |
| draft, view `error`/`stale`/`frameStale` | last good frame | "stale" (warning tone, not accent) + the step's message | same draft caption |
| draft, view `notPreviewed` (AI or downstream) | saved rows (D5) | "stale" | "Not previewed (AI step): showing the last run's data." |
| draft, server-resolved node that is not the focused step (no rows line for it) | last good frame | "stale" + "Select this step to update it" hint | same draft caption |
| draft, view `ok` with `rows === null` and not `frameStale` (a server-resolved, non-focused step with no earlier rows, `draftStepView.ts:121-129`; or an unknown node, `:84`) | saved rows (D5) | "stale" + "Select this step to update it" hint | same draft caption |
| Output bound to a root (`rootId`), draft or not | the root's sample frame | none (root frames are not recomputed by the draft, so never "live") | "Rendered from the cached sample." |
| sample still loading | skeleton | none | — |
| no sample available (sample status `error`, an image source, or no sample entry for this viewer) | saved rows (D5) | "saved" (no draft) / "stale" (draft) | "Showing the last run." |

"live" therefore appears only on a surface recomputed from the current draft (DESIGN.md §11).

**Evaluation order of the table (skeptic-design-2 notes).** `liveOutputSource` checks, in order: (1) sample still loading, where a MISSING sample entry counts as loading until the sources list has loaded and analyze has answered (the sample hook only requests after those), so an editor never flashes saved rows before the sample arrives; (2) no usable sample (status `error`, image source, or still no entry after both have answered) → saved rows; (3) root-bound Output; (4) no draft rows; (5) the draft-view rows. A root-bound Output with a failed sample therefore shows saved rows.

### D4. Baseline: one history read per Output per page load, after a run

`useLiveOutputBaseline(outputId)`: `loadHistory(outputHistoryKey(outputId), () => fetchOutputHistory(outputId))` with the DEFAULT limit, exactly as `useOutputHistory.ts:45` does (the cache key ignores the limit, so a short read would poison a dashboard panel's sparkline later in the session; skeptic-design-1 CR4) through the shared cache, subscribed with `subscribeHistory`; no refetch on edits, selection changes, Discard or draft changes. After a run settles (`runStatus` → succeeded/failed from `submitPipelineRun` or the Save & run path) it calls `refreshHistory` once for the displayed Output(s). Switching to another Output fetches that Output once. Tiles: ROWS OUT = displayed row count; "±N vs last run" = displayed count − `history.current.rowCount`, shown only when a `current` point exists AND the root sample is not truncated (a 1,000-row sample count vs a full run count is not a comparison; the tile carries the existing "sample" marker instead). Delta text is secondary text colour (never accent, never red/green: fewer rows is not a failure).

### D5. Saved rows for not-previewed nodes

`getOutputRows(outputId, 0, 500)` once per Output per page load (500 is the route's `Page.MaxLimit`; module cache keyed by outputId, cleared when a run settles like D4 and when leaving the pipeline page, never on a layout or tab unmount), only when D3 resolves to "saved rows". Never fetched for a client-evaluable Output. Rendered through the same D1 path. A failed read shows "No saved data yet. Save & run to populate it." (no retry loop).

### D6. Component

`features/pipelines/ui/liveOutput/LiveOutputColumn.tsx` (+ `.css`): header row ("Output" eyebrow in the spine's mono eyebrow style, marker, and when ≥2 Outputs a compact native `select` of Output names), the Output name, the render card, the tiles row (2 tiles), the caption. Rendering (pure-props child `LiveOutputRender`):
- chart → `ChartRenderer` with D1 `chartRenderInputs` (`compact`, no overlay, no `onDataPointSelect`), with `defaultPanelAppearance` as the appearance, so the chart type is the Output config's own (`resolvePanelChartType` with no panel override). A dashboard panel whose own appearance overrides the chart type renders that type instead; the column shows the Output, not a particular panel (listed);
- metric → `MetricRenderer` with `metricLoadedValue` (draft value, never the history headline), label/unit/format/conditional formats from `readMetricConfig`; no comparison/sparkline;
- table/collection/timeline → `OutputPreviewPane`'s read-only table branch (no `TableRenderer`: it PATCHes column widths against a panel) / `CollectionRenderer` / `TimelineRenderer` (pure renderers with `readCollectionConfig`/`readTimelineConfig`, as `OutputPanelContent` does);
- markdown → `MarkdownRenderer` with `readMarkdownConfig`.
Which Output: the user's explicit pick (component state, reset when it is deleted); else the Output on the selected step; else the first in `page.allOutputs`. No Outputs → an empty state "No Output yet. Add one from the spine." (no request).

**Latency.** The render input is passed through `useDeferredValue` so the step count and preview table commit first and the chart (ECharts) renders in a deferred pass. The HEL-1631 latency test's fixture has NO Output, so it does not protect this change (skeptic-design-1 CR3): `e2e/hel1632-live-output.spec.ts` runs the SAME 10-edit burst with a chart Output displayed at 1280 and asserts the SAME budget on the step count / preview update (edit 1 < 100 ms, edits 2-10 < 50 ms). If the deferred render still breaks it (ECharts `setOption` runs synchronously after the deferred commit and can delay the next edit's handler), the executor additionally coalesces the column's render to at most one per animation frame / idle callback and re-measures; the fix must keep the budget, not relax it. `e2e/hel1631-draft-mode.spec.ts` must also stay green unchanged. The executor also measures input → live-output DOM update for 10 edits at 1280 (reported, not gated).

### D7. Placement

The 1280×800 no-document-scroll check and the 769–1100 spine-title readability check are re-run with the column present, with the context list at 248px and 400px.

- **Desktop ≥ the three-column width.** `--pipeline-live-output-width: clamp(340px, 28cqi, 380px)` when the page body is at least `THREE_COLUMN_MIN_WIDTH = 960px` wide. The mode is measured (`useThreeColumnLayout`, `useLayoutEffect` plus `ResizeObserver` on `.spine-body`) and set as `data-live-layout="column"|"disclosure"`, because the same signal decides whether the chart is mounted at all. While the column is present the spine track is `clamp(220px, 28cqi, 340px)` (273px at 1280 with the list at 248, keeping the 270-340px invariant and a ~363px centre). Spine formula updated to subtract the live track. Column: own scroll, `border-left: 1px solid var(--app-border-subtle)`, `padding: var(--space-4)`, tokens only. The "page fits 1280×800, 8 preview rows" requirement must still hold.
- **Narrow desktop (below the threshold, includes much of 769–1100).** The track stays 0; the column renders as a collapsed-by-default disclosure "Output" row (with marker) at the bottom of the centre column; expanded it shows the same render capped at ~40% of the column height with internal scroll. State per page session.
- **Phone (≤768).** The same `LiveOutputColumn` renders in the Preview tab below the step preview, full width with the 12px gutters; clearance follows `--pipeline-mobile-actions-h`.
- Motion: no new motion; the chart's own ECharts animation follows the existing renderer behaviour under Full/Subtle/Off (the renderer already honours the motion setting, or the executor verifies and reports). Values do not tween in this change.

### D8. Tests

- Unit: `outputRenderInputs` (D1), `frameToRecords` (D2, Integral, key order), `liveOutputSource` (D3 table, every row), baseline delta rules (D4).
- **Parity test** (`LiveOutputColumn.parity.test.tsx`): one fixture of records produced by the REAL client evaluator over a fixture pipeline; render (a) the saved panel (`OutputPanelContent` with `output` prop, history mocked to `null`) with records in the frame's schema order, and (b) the live render from the same frame; assert identical `ChartRenderer` props-derived series (capture the ECharts option the same way existing ChartRenderer tests do) for a line chart with an explicit x/y mapping and an aggregated bar chart, identical metric value text, identical key-aggregate. Plus a case with NO xAxis mapping whose input records are in a DIFFERENT key order than the schema: assert the live render uses schema order (the D2 known divergence, pinned). Second case: history mocked with `current.value` ≠ the rows' aggregate → saved panel shows the history value, live shows the draft value.
- Component: caption and marker for every D3 state; Output selector; no-Output empty state.
- `PipelineDetailPage.spine.test.tsx:207` updated (slot now filled).
- e2e `e2e/hel1632-live-output.spec.ts` (`attachApiRequestCounter` as hel1631): seed a pipeline with a filter step and a chart Output and a metric Output; at load assert exactly one `/api/outputs/:id/history` for the displayed Output; burst of ≥5 filter edits → zero requests and the render (tiles + chart) updates to the draft count; caption visible; marker live; error state (an invalid expression) → stale; a server-only step pending → updating; an AI-step Output → saved data labelled stale (route-stub the AI step's existence if seeding one needs an API key: the not-previewed state is driven by step kind, not by a run); Discard → back to saved-sample render, zero requests; the 10-edit latency burst with a chart Output displayed (D6, same budget as HEL-1631); screenshots at 1280 (light/dark), one width in 769–1100, 375 and 430 phone, motion Full/Subtle/Off, into `.concertino/scratch/HEL-1632/`.

## Risks / Trade-offs

- **Sample vs full run.** The column renders over the ≤1,000-row sample; for a large source it differs from the dashboard. Mitigated by the "sample" marker and suppressing the vs-last-run delta when truncated (D4).
- **Always-on base walk** (D3) adds one memoized evaluator walk at page load for pipelines with Outputs (no network). Accepted; it moves work off the first draft edit.
- **Server-resolved non-focused nodes** show stale frames (D3); a second rows line per request would need a transport change (out of scope; listed as a follow-up candidate).
- **Chart compare overlay omitted** (Non-Goals) — listed.

## Reversible UI calls (built as recommended, listed in the PR)

Column visible without a draft (no marker, neutral caption); Output selector + selection rule; chart appearance = the Output's own (no panel override); schema-ordered columns (D2 known divergence); tile label rule; delta colour; narrow-desktop disclosure; phone placement in the Preview tab; no-Output empty state copy; "Select this step to update it" hint.

## Open Questions

None blocking.

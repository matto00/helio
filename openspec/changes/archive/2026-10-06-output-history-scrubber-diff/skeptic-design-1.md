## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/{output-history-scrubber,chart-history-overlay,output-history-api}/spec.md, against the live tree at HEAD 3962e6eb2c09a009259c8f75f2cf1aa4c1fe3526 (the planning artifacts are untracked and nothing else is changed). Owner rulings were checked in `.concertino/runs/HEL-1277/answer.json` and in events.jsonl (`escalation.answered`, id HEL-1277-1791271966819-f692da: A, A, A, B). C1–C4 match the rulings verbatim. I did not re-litigate them.

### What I verified (with evidence)

**Q1. D10 (`series` on resolved points)**
- **It is needed.** `OutputHistoryService.forOutput` resolves a window baseline via `historyRepo.nearestAtOrBefore`, which is independent of `points`/`limit` (OutputHistoryService.scala:116-121). A 7d/30d baseline is therefore usually absent from `points`, and its series is unreachable without D10.
- **It is zero-query.** `resolve(p)` already holds the loaded `OutputHistoryPoint` with its `summary` (OutputHistoryService.scala:127). Reading `summary.fields("series")` adds no statement, so the HEL-1273 bounds hold.
- **It is public-safe.** The public `points[].summary` already carries the full stored summary, including `series` (OutputHistoryProtocol.scala:150-152, `PublicOutputHistoryPoint(capturedAt,rowCount,summary)`). D10 exposes no new category of data, only a summary for a point outside `points`. That is allowed by D8.
- **It conflicts with the contract files** (see CR3):
  - `schemas/outputs/output-history-response.schema.json` and `public-output-history-response.schema.json` both define `resolvedPoint` with `additionalProperties: false`.
  - The schema-seam route tests validate live responses against them: OutputHistoryRoutesSpec.scala:299, OutputHistoryPayloadRoutesSpec.scala:48, OutputHistoryPublicRoutesSpec.scala:87.
  - The design and tasks never mention these files.
- **It changes the MCP surface** (see CR4). `getOutputHistoryHandler` (helio-mcp/src/tools/outputsHandlers.ts:113-126) passes `current`/`baseline` through untouched, while stripping `points[].summary` by default.
- **The existing spec is fine as-is.** `openspec/specs/output-history-api/spec.md` says "Each resolved point SHALL carry its capture time, row count and headline value". An ADDED requirement adding `series` is compatible with that.

**Q2. D9 omission rules**
- **`filterActive` is sourced correctly.** It uses the same expression as the metric branch: `viewerFilterActive || crossFilterMode === "server" || isCrossFiltered` (PanelContent.tsx:313).
- **`rowsComplete` is computable.** `OutputPanelContent` already receives `rowsTruncated`, which comes from usePanelData's `paginationEntry.hasMore` (usePanelData.ts:35-42).
- **The config-identity mirror is wrong for dashboards** (CR1):
  - `usePanelData.chartAggregate` is hard-coded `null` (usePanelData.ts:44-46, 240, 269).
  - No dashboard render path reads `config.aggregation`. Grep shows only the editor and `OutputPreviewPane.tsx:87` call `groupAndAggregate`.
  - So the dashboard always plots rows mode via `buildDataOption(rawRows, headers, fieldMapping)` (chartDataOptions.ts:147-160).
  - The backend reducer stores a `grouped` series whenever `aggregation.groupBy/agg/yField` is set and chartType≠scatter (OutputSummaryReducer.scala:112-115).
  - D9's mirror would therefore accept a grouped baseline and draw `agg(yField) by groupBy` over a primary plotting raw `yAxis by xAxis`.
- **D8 misses normalized bar stacking** (CR2). For a single series, `applyBar` rewrites every value to a percent share (100) and sets the value axis to `max: 100`, `"{value}%"` (chartTypeOptions.ts:79-99). The design inserts the overlay after this pass, so raw baseline values would be plotted against a 0–100% axis.
- **Horizontal bars are omitted silently.** The category axis is swapped onto yAxis (chartTypeOptions.ts:101-106), so D8's "category xAxis" check skips the overlay. That is safe, but it is unspecified.

**Q3. D7 row identity and the `rowClassName` hook**
- **Identity survives.** With `paginationRows`, `normalizedRows` returns the same array (TableRenderer.tsx:381-382). The filter keeps references (TableRenderer.tsx:405-408). `useSortedRows` reorders the same objects. So object-identity keying holds.
- **`rowClassName` works with virtualization.** DataGrid virtualizes via `visibleRows = rows.slice(start,end)` (DataGrid.tsx:628-655), so a per-row hook receives the same row objects.
- **The design leaves no read-only gap.** With no `ownerId`, `canWrite` is false (TableRenderer.tsx:300). Sort, filter and pin persistence are all gated on it.
- **The "Change" column has no mechanism** (CR8). `TableRenderer` derives columns from row keys (`naturalKeys`/`deriveKeys`, TableRenderer.tsx:320-338) and has no extra-column prop. `ColumnDef.render(row)` exists (DataGrid.tsx:34), so a supported path does exist.

**Q4. D1 card restructure**
- **The fact is right.** `OutputGalleryCard` is a single `<button class="output-gallery-card" aria-label="Open {name} output">` (OutputGalleryCard.tsx:61-66).
- **Existing selectors survive.** Jest uses `getByRole("button",{name:/Open Revenue output/})` (OutputsGalleryTab.test.tsx:95). e2e counts `.output-gallery-card` (hel968:166, hel910:169). Both survive if exactly one element per card keeps that class.
- **The card CSS moves.** The `.output-gallery-card` rules (padding, border, hover, `cursor:pointer`) would move to the wrapper div. Final-gate visual concern only.

**Q5. D2 separate fetch**
- **Sound.** `useOutputHistory` writes the shared cache keyed `output:<id>` with the default 30-point fetch (useOutputHistory.ts:38-55). A 100-point entry there would change metric sparklines. Today's `fetchOutputHistory(outputId)` takes no options (outputHistoryService.ts:46-49), so adding `{limit}` is an additive change.

**Other facts checked**
- Modal supports `size="xl"` (Modal.tsx:8).
- The Compare picker is metric-only (OutputEditorSheet.tsx:548-561). The `buildOutputConfig` chart branch writes no `compare` (buildOutputConfig.ts:66-85). See CR5.
- Backend `TriggerSource` includes `"auto-run"` (PipelineRunService.scala:1718-1723). RunHistoryModal's `TRIGGER_SOURCE_LABELS` has only manual/scheduled/external (RunHistoryModal.tsx:53-57). See CR6.
- Payload tier caps: free = 0 (PayloadHistoryConfig.scala:20-43). The CI e2e job sets no `HELIO_OWNER_EMAILS` (ci.yml e2e env), and no e2e spec or support helper changes a user's tier. Only `e2e/support/historySeed.ts` touches the DB, to backdate `captured_at`. See CR7.
- `compareLabel` returns "previous" for previous_run and never "previous run" (metricHistoryView.ts:76-80). That is consistent with C3.

### Verdict: REFUTE

### Change Requests

1. **D9: mirror what the dashboard plots, not what the backend reducer selects** (design.md D9, chart-history-overlay spec, task 2.3).
   - Dashboard chart panels ignore `config.aggregation`. They always plot rows mode: x=`fieldMapping.xAxis`, y=`fieldMapping.yAxis` (usePanelData.ts `chartAggregate: null`; PanelContent.tsx:263-271; chartDataOptions.ts:147-160).
   - Required rule: overlay only when `baseline.series.mode === "rows"`, `x === fieldMapping.xAxis` and `y === fieldMapping.yAxis`.
   - State that a chart Output with `config.aggregation` set gets no dashboard overlay. The backend stores `grouped` there, which the primary does not plot.
   - Add a unit test: aggregation set plus a matching grouped baseline gives no overlay.
   - The History view's chart-from-series is self-consistent and unaffected.
   - Note: the editor preview groups (OutputPreviewPane.tsx:87) while dashboards don't. This is pre-existing and worth recording as a found issue, not fixing here.

2. **D8: exclude normalized bar stacking** (design.md D8, chart-history-overlay spec, task 3.1).
   - When `chartOptions.bar.stacking === "normalized"`, the primary has already become percent shares on a `max:100` axis (chartTypeOptions.ts:79-99), so the overlay must be omitted.
   - Specify explicitly that horizontal orientation is also omitted, because its category axis is yAxis.
   - Add tests for both.

3. **Missing contract update for D10; the proposal contradicts the design** (proposal.md "What Changes" last bullet and "Impact"; tasks §1).
   - Add a task to update `resolvedPoint` in both `schemas/outputs/output-history-response.schema.json` and `schemas/outputs/public-output-history-response.schema.json`. Add `series` as required, `oneOf [null, #/$defs/seriesSummary]`.
   - Without it, `additionalProperties:false` fails the three schema-seam route specs.
   - Fix proposal.md. It says "No backend, schema, migration, or MCP change", calls the change "Frontend only", and lists no Modified Capabilities. But D10, tasks 1.1-1.2 and `specs/output-history-api/` change the backend, the wire contract and an existing capability. List `output-history-api` under Modified Capabilities and add the backend change to Impact.

4. **D10's MCP consequence is undecided** (design.md D10; proposal "no MCP change").
   - `get_output_history` returns `current`/`baseline` unfiltered (outputsHandlers.ts:113-126). With D10, every default call gains up to 2×200 series points. That is exactly the bulk the handler strips from `points[].summary` unless `includeSummaries`.
   - The design must decide one of two options and add a task:
     - (a) strip `current.series`/`baseline.series` unless `includeSummaries`, with a handler test; or
     - (b) pass them through deliberately.
   - Either way, update the `OutputHistoryResolvedPoint` mirror in `helio-mcp/src/types.ts:259-263`, which documents that it mirrors the schema.

5. **Unstated product consequence: no UI sets `compare` on a chart Output.**
   - The Compare picker renders only for `kind === "metric"` (OutputEditorSheet.tsx:548-561). The chart branch of `buildOutputConfig` never writes `compare`.
   - So the Q4=B dashboard overlay is reachable only by API/MCP PATCH. The owner ruled Q4=B on the premise "dashboard chart panels with config.compare", and the design never says that no author can set it from the UI.
   - Do one of:
     - (a) record it explicitly as a non-goal, with a follow-up filed per the repo's follow-up convention; or
     - (b) if a chart Compare picker is wanted, treat it as scope added beyond the ticket's Touches list and escalate.
   - It must not stay implicit.

6. **D4: the trigger-source vocabulary is incomplete.**
   - History points can carry `triggerSource: "auto-run"` (PipelineRunService.scala:1722). It is a real, successful run and records history per D5.
   - The map D4 extracts from RunHistoryModal (RunHistoryModal.tsx:53-57) has no entry for it, so it renders `undefined`.
   - The extracted helper must label `auto-run` and fall back for unknown strings. Add a test.

7. **Task 5.1: the payload-tier mechanism is unspecified.**
   - Free tier stores no payloads (cap 0). CI's e2e job has no owner-email config, and the driver forbids touching ci.yml's e2e job. No e2e helper changes tiers today.
   - "On a tier that allows payloads" is therefore not implementable as written. Specify the mechanism, for example a scoped `psql` tier update in the style of `e2e/support/historySeed.ts`: on a freshly registered user only, by exact id, row count asserted, recorded, and reverted or cleaned.
   - Otherwise, state how AC1's "rows when a payload exists" is proven end-to-end in CI.

8. **D7: specify the "Change" column mechanism.**
   - `TableRenderer` builds columns from row keys and has no extra-column API. Injecting a synthetic key into row objects would break D7's object-identity keying, and that key would flow into filtering, sorting, pinning and `columnOrder`.
   - Specify a `TableRenderer` prop, for example `leadingColumns?: ColumnDef[]`, rendered via `ColumnDef.render(row)`. It must be excluded from filter, sort, pin and persistence, and must not mutate rows.

### Non-blocking notes
- **Hook placement (D9).** The chart branch of `OutputPanelContent` runs after the `isLoading || !output` early return (PanelContent.tsx:225-231). `useOutputHistory` must live in a child component (the precedent is `MetricOutputPanel`), not inline in the branch.
- **Custom compare label.** `compareLabel` returns `"custom"` for a non-day custom duration, so the legend would read "vs custom". Consider labelling by the baseline capture time instead.
- **Nulls in the History view chart.** It renders series points through `rawRows` strings. A null y becomes `""`, then `parseFloat` gives NaN, which is coerced to 0 (chartDataOptions.ts:150-153). That matches the dashboard's coercion but draws gaps as zeros. Consider rendering through `buildChartOption` directly with nulls preserved.
- **Hover emphasis.** `applyHoverEmphasis` runs after the overlay insertion, so it will also style the overlay. Confirm visually at the final gate.
- **Card CSS (D1).** Moving `.output-gallery-card` to the wrapper div moves the hover and `cursor:pointer` styling to an element that contains two targets. Judge at the final gate in both themes.
- **History view freshness.** The view never refreshes on a pipeline-terminal event while open. That is acceptable, but should be stated.

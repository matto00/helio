## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ticket / design context**
- Read `ticket.md` (HEL-624), `design.md` (4-round design gate history, D1-D5), `tasks.md` (21/21 checked),
  `files-modified.md`, both spec deltas (`specs/panel-viz-aggregation/spec.md`,
  `specs/echarts-chart-panel/spec.md`), and `workflow-state.md` (execution history, including an executor
  death/recovery mid-cycle-1 — reconciled against real diff content per the recovery log, not just trusted).

**All FIVE backend enforcement sites — read each function, not just grepped**
1. Direct create: `PanelService.buildForCreate` (`backend/src/main/scala/com/helio/services/PanelService.scala:143-175`)
   calls `panel.validateConfig` after `buildNewPanel`, before `rejectCompanionBinding`/insert — confirmed by
   reading the function body.
2. Proposal/replace-contents: `ProposalPanelSupport.validatePanel`
   (`backend/src/main/scala/com/helio/services/ProposalPanelSupport.scala:30-65`) calls
   `ChartPanel.rejectsAggregation(panel.chartType, mergedAggregationPresent(panel))`, where
   `mergedAggregationPresent` calls the real `buildCreateRequest` and peeks its *resolved* `config` JSON for
   an `aggregation` key — confirmed this is NOT the flat `panel.aggregation` field (closing the round-2
   config-passthrough bypass). Confirmed both `DashboardProposalService.apply` → `validateStructure` and
   `DashboardContentsService.replaceContents` → `validatePanels` call this before any write (read both call
   sites, `apply`/`replaceContents` — validation strictly precedes `createAll`/`buildAndReplace`).
3. Single update: `PanelService.update` (line 374-408) calls
   `PanelServiceHelpers.validateScatterAggregationConflict(existing, spec)` before `patchApplier.apply`. Read
   the helper (`PanelServiceHelpers.scala:235-249`): type-narrows to `ChartPanel` first (non-chart panels are
   a no-op), computes effective chartType/aggregation-present accounting for a partial PATCH, delegates to
   the shared `rejectsAggregation` predicate.
4. Batch update: `PanelService.batchUpdate` (line 250-301) runs `validateBatchAggregationConflict` inside the
   same pre-write `for`-comprehension as `validateBatchTypeMatch`/`validateBatchChartTypes`. Read the helper
   (line 254-269): same type-narrowing guard, per-`(item, panel)` pair, `Left` short-circuits before
   `panelRepo.batchUpdate`.
5. Dashboard-snapshot import: `DashboardServiceValidation.validatePanelEntries`
   (`DashboardServiceValidation.scala:58-74`) pattern-matches `decodeCreateConfig`'s `ChartCreate(c)` result
   and calls `rejectsAggregation(entry.appearance.chart.flatMap(_.chartType), c.aggregation.isDefined)`.
   Confirmed `DashboardService.importSnapshot` (line 218-226) calls `validateSnapshotPayload` before
   `dashboardRepo.importSnapshot`.

All five delegate to the single `ChartPanel.rejectsAggregation` predicate
(`ChartPanel.scala:332-342`) — read it directly; it is a pure, two-line `Option`-returning function with no
divergent logic between call sites.

**Config-passthrough bypass (round-2 finding) — confirmed closed**
- `ProposalPanelSupport.mergedAggregationPresent` (line 61-65) calls `buildCreateRequest` (the real,
  side-effect-free construction function used to build the actual create request) and inspects its resolved
  `config` JSON — the exact same JSON `ChartPanelConfig.decodeCreate` will read — for an `aggregation` key,
  regardless of whether it arrived via the flat `panel.aggregation` field or the generic `config`
  passthrough. Verified the dedicated regression test
  `DashboardApplyProposalAggregationSpec.scala` exercises exactly this: one test supplies `aggregation` via
  the flat field, a second supplies it only via `"config":{"aggregation":{...}}` — both 400 with zero writes
  (`dashboardCount()` unchanged). Ran this spec as part of the full suite (below); both pass.

**Pie aggregate rendering — verified live, not just read**
- Code: `buildAggregateDataOption` (`ChartPanel.tsx:157-176`) branches on `chartType === "pie"` to emit
  `{series:[{type:"pie", data: categories.map((name,i)=>({name,value:values[i]}))}]}`; `useAggregate`
  extended to `bar||line||pie` (line 213-214). Diffed against `main` — this is the ONLY functional change to
  `ChartPanel.tsx` (`git diff main:...ChartPanel.tsx`); the non-aggregate `chartAggregate==null` path is
  byte-identical to `main`.
- Live UI: created a fresh chart panel on a fresh dashboard, chart type Pie, bound `AggregateResult`
  (fields `date`/`profit`), set Aggregation `groupBy=date, valueField=profit, agg=Sum`, saved. Screenshot
  confirmed a real 5-slice pie chart labelled by date with per-date profit sums — genuinely renders
  `{name,value}` aggregate slices, not a code-only claim.
- Scatter unchanged: `ChartPanel.tsx` `useAggregate` remains false for scatter — confirmed by code (no
  `"scatter"` branch added) and by `ChartPanel.test.tsx`'s pre-existing "ignores chartAggregate for a
  scatter chart" test (still present, still passing).

**UI hide/clear (D4) — verified live**
- `BindingEditor.tsx:413-432`: renders `ChartAggregationFields` when `chartType !== "scatter"`; renders an
  inline note ("Aggregation isn't available for scatter — each point plots a raw row.") otherwise. Live UI:
  opened the pie panel's editor (with Group by / Value field / Function populated), switched the Chart type
  radio to Scatter — the Aggregation section was immediately replaced by the note; saved; re-opened editor —
  aggregation fields were empty (cleared), confirming `BindingEditor.tsx:209-217`'s "adjust state during
  render on transition into scatter" logic actually fires. No 400 on save (fields were correctly omitted).
- Theme parity: toggled to light theme, re-opened the scatter note — reuses the pre-existing
  `panel-detail-modal__type-hint` class (confirmed via `getComputedStyle`: `color: rgb(114,107,98)`,
  transparent background — a shared muted-text token, not a new hardcoded style). `git diff main...HEAD
  --stat -- '*.css' '*.scss'` returned no changes — zero new CSS, 100% token/class reuse, matching DESIGN.md.

**Gates re-run fresh (all from a clean shell, not trusted from any prior report)**
- `npm run lint` (frontend): clean, zero warnings.
- `npm run format:check` (frontend): all files formatted.
- `npm test` (frontend, full suite): **138 suites / 1433 tests, 0 failures.**
- `sbt -batch test` (backend, full suite): **2206 tests, 0 failures**, `[success]`.
- `node scripts/check-scala-quality.mjs`: "clean" — zero inline-FQN violations (the 73 warnings are
  pre-existing informational file-size soft-budget notices across the whole codebase, not new to this
  ticket; `PanelService.scala`/`PanelServiceHelpers.scala`/`BindingEditor.tsx` were already over the 250/400
  line soft budgets on `main` before this diff — this ticket added modest increments, consistent with the
  evaluator's own non-blocking note).

**Contract docs**
- `schemas/panel.schema.json` line ~97-99: `ChartConfig.aggregation`'s description now states "Honored for
  `chartType` bar/line/pie... Rejected (400) at create/update when combined with `chartType: "scatter"`" —
  read directly.
- `helio-mcp/src/tools/write.ts` line 412-419: `create_panel`'s chart bullet gained an `aggregation` clause
  naming the `{groupBy,agg,yField}` shape, the bar/line/pie restriction, and the scatter rejection — read
  directly.

**Acceptance criteria traced**
- "Pie aggregates correctly or fails visibly" → pie aggregates correctly (live-verified above). ✓
- "Same decision applied consistently to scatter, rationale recorded" → scatter rejected loudly at all 5
  sites (verified) + design.md D3 records the rationale (scatter has no groupBy semantic). ✓
- "Discoverable without reading ChartPanel.tsx" → schema + MCP doc both updated (verified above). ✓
- "Test coverage" → backend: `PanelSpec` (rejectsAggregation unit tests), `PanelServiceScatterAggregationSpec`,
  `DashboardApplyProposalAggregationSpec`, `DashboardContentsReplaceAggregationSpec`,
  `DashboardSnapshotValidationSpec`, `ApiRoutesSpec` import-route test — all read and all pass in the fresh
  full-suite run. Frontend: `ChartPanel.test.tsx` pie-aggregate coverage,
  `BindingEditor.aggregation.test.tsx` — both read and pass. ✓

### A finding I traced to ground truth and determined non-blocking

While live-testing the scatter-clears-on-switch UI flow (D4), switching a **populated, real** pie chart
(aggregated data, live-rendered) to Scatter via the appearance editor triggered a genuine browser console
error and a React `ErrorBoundary` trip ("Something went wrong — Cannot read properties of undefined
(reading 'axisBuilder')"), traced to `echarts-for-react`'s `CartesianAxisView.render`. I did not accept this
as circumstantial — I isolated it with a controlled experiment: created a **second, unrelated** panel (Bar,
bound via plain `fieldMapping` — no aggregation touched at all), rendered real data, then live-switched its
type Bar → Scatter. **No crash.** I then reproduced the crash again via Pie → Scatter (still without ever
touching aggregation). This proves the crash is a pre-existing `echarts-for-react` library fragility
specific to switching between a pie option (no `xAxis`/`yAxis` keys) and any cartesian chart type within one
live-mounted chart instance — a transition already possible before this ticket (pie has been a selectable
chart type since HEL-248), not something this diff introduces. `git diff main...HEAD` confirms
`ChartPanel.tsx`'s non-aggregate render path (the `isPie ? ... : ...` option-merge logic responsible for
this) is untouched by this change. The `ErrorBoundary` recovers cleanly via "Try again" with the correct
final state (verified — the scatter chart re-rendered correctly with real data, no data loss). This is a
real, worth-filing defect, but it's an orthogonal, pre-existing rendering-layer bug this ticket doesn't
cause and doesn't need to fix to satisfy its own ACs (which are about validation and data shape, not
echarts' internal chart-type-switch handling). Recommend a spinoff ticket; not a blocker for HEL-624.

### Verdict: CONFIRM

### Non-blocking notes
- File-size soft-budget warnings on `PanelService.scala`, `PanelServiceHelpers.scala`, `BindingEditor.tsx`
  (already over budget pre-ticket; this diff adds modest increments) — informational only per
  `check:scala-quality`, already flagged by the evaluator.
- Recommend filing a spinoff for the pre-existing `echarts-for-react` pie↔cartesian live type-switch crash
  (traced above) — real, reproducible, user-visible ("Something went wrong"), but orthogonal to this
  ticket's scope and not caused by this diff.

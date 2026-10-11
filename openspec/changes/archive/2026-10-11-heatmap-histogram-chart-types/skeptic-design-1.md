## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `a29a7e5ce23108a682fd87aea7d79edd6b922dc9` (the change dir is still untracked). Owner rulings Q1-Q4 = A
(events.jsonl line 5, `escalation.answered`, sub_answers `["A","A","A","A"]`) are binding and were not re-opened.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/heatmap-histogram-chart-types/HEL-1311`.
- **Chart-type enumeration is complete.** I grepped the worktree for `scatter`/`"pie"` across frontend, backend, schemas,
  helio-mcp, e2e and docs, excluding archives. Every hard-coded set or check is in design.md's Context/D1 list:
  `chartAppearance.ts:5`, `panel.ts:54`, `resolvePanelChartType.ts:5`, `OutputKindFields.tsx:38/104`,
  `ChartAppearanceEditor.tsx:192`, `echartsCore.ts`, the six schema enums (I confirmed exactly six), `OutputConfigValidation.scala:31/47/113`,
  `RequestValidation.scala:83/89`, `AssistantProposalToolSchemas.scala:78`, `OutputSummaryReducer.scala:116`,
  `helio-mcp proposal.ts:74` and `outputs.ts:73`.
  The other backend hits are comment-only and route through `RequestValidation.validateChartType`: `DashboardServiceValidation`,
  `PanelServiceHelpers`, `PatchSetPreviewProjection`, `ChartAppearance.Patch.decode`.
  `OutputBindingSpec.validateFieldMapping` checks slot names only. `xAxis`/`yAxis`/`series` are all valid chart slots, so a
  histogram mapping with only `xAxis` is accepted because required slots are not enforced on write. No e2e spec pins the
  set. There is a precedent for a repo-root-reading drift test (`helio-mcp/src/tools/canonicalColumnTypesDriftGuard.test.ts`),
  so the seam tests can be built.
- **Design claims checked against the code:**
  - `useOutputKindState.ts:81` holds `const [chartFieldMapping] = useState(...)` with no setter, so the claim is accurate.
    `configPatch.buildConfigPatch` diffs every top-level key, so once a setter exists a `fieldMapping` change is sent
    automatically.
  - The eight "never aggregates" `=== "scatter"` sites are accurate. `OutputPreviewPane` goes through
    `chartAggregationSpec`, so it is covered.
  - `applyChartOverlay` (`chartOverlayOption.ts:38`) already returns early for any type other than line/bar, so D6's change
    there is a no-op. That is harmless.
  - `ChartRenderer` has the HEL-1358 truncation-note slot. The design's description of it is accurate.
  - `HistoryChart.tsx` already has the `output-history__muted` note idiom.
  - `buildChartOption` merge: the claim is **partly inaccurate. See CR6.**
  - "Numeric eligibility uses the same capability column types the existing pickers use" is **inaccurate. See CR2.**
- **History and "vs" safety:** `selectChartOverlay` returns null for a histogram (no `yAxis`), and `applyChartOverlay`
  ignores both types. The History view note replaces the chart, and `OutputSummaryReducer` recording is unchanged for
  configs the write paths can create. With the D6 blocker, the "vs" overlay and history views do not break.
- **ECharts 6.1.0 cursor behaviour (`frontend/node_modules`).**
  - zrender `Displayable.js:310` sets `dispProto.cursor = 'pointer'` as the default for every element.
  - `BarView.js:709-710` overrides it only when the item model sets a `cursor` value.
  - `chart/heatmap/HeatmapView.js` never reads `cursor` (0 matches). See CR1.
- **Spec arithmetic:** Sturges for n=100 is ceil(6.64)+1 = 8, which matches the spec. The binCount 5 over 0..10 scenario is
  consistent with the "last bin inclusive" rule.

### Verdict: REFUTE

The plan is close. The enumeration is complete and most claims about current code hold. However, one spec requirement
cannot be met by the planned mechanism, two tests would pass while the feature is broken, and two decisions are deferred
or misdescribed in ways that change what gets built.

### Change Requests

1. **The cursor requirement cannot be met by D6's mechanism (design D6, `chart-drilldown-inspect` spec).**
   - **Problem:** the spec says heatmap cells and histogram bars "SHALL NOT present a pointer cursor". D6 only skips
     `withPointerCursor`. But zrender's default element cursor is `pointer` (`zrender/lib/graphic/Displayable.js:310`):
     - A histogram `bar` series with no `cursor` still shows a pointer.
     - `HeatmapView.js` ignores the series `cursor` option entirely, so no series option can change a heatmap cell's
       cursor.
   - **Required:** D6 must name a mechanism that works for both types. For example, set `cursor: "default"` on the
     histogram bar series. For heatmap, pick a host-level approach (zr cursor override or a container style), or amend
     the spec wording with a stated reason.
   - **Tests:** task 4.7 must assert the observable cursor, through a live or e2e hover on both types, not just that
     `cursor: "pointer"` is missing from the option. That absence check passes even though the browser still shows a
     pointer.
   - **Also state** `calculable: false` on the continuous visualMap, so its drag handles do not become an undersized touch
     control (DESIGN.md's 44px touch floor).

2. **The numeric-only picker rule is undefined, and the claim behind it is wrong (D7, task 3.7).**
   - **What the code does:** the existing Output-editor pickers do no type filtering. `columnOptions` / `aggColumnOptions`
     (`outputConfigTypes.ts:153-160`) map every capability column. Two different "numeric" definitions exist in the tree:
     - backend `SlotEligibility.Numeric` = integer/float, exposed as `Capability.eligibleColumns`;
     - frontend `NUMERIC_TYPES` in `FilterConfig.tsx:36` / `AggregateConfig.tsx:58`.
   - **Required:** pin the exact predicate and source, e.g. "capability `eligibleColumns.yAxis` for chart". Also specify:
     - what the Value/Field picker shows when a stored mapping points at a column outside that set (it must stay visible,
       not be silently dropped on save);
     - the empty state when no numeric column exists.
   - **Why it matters:** a column typed `string` upstream (common for CSV inputs) would make the motivating
     job-duration histogram impossible to configure.

3. **Contract docs are not updated (task 2.1 covers only the enums).**
   - **Where:** the `config.description` prose in `schemas/outputs/create-output-request.schema.json:25`,
     `update-output-request.schema.json:14` and `pipelines/create-pipeline-transactional-output-request.schema.json:22`.
   - **What is stale:** each still says "`chartType` is bar|line|pie|scatter or null" and "never on a scatter chart", and
     none documents the new `chartOptions.histogram.binCount` 2-100 rule that D8 makes a 400.
   - **Also stale:** `RequestValidation.scala:89`'s error string lists the four values literally.
   - **Required:** add a task to update these descriptions (and derive the error string from `ChartTypes.All`). Run the
     schema-drift check after.

4. **The seam tests can pass vacuously, and their red is only by mutation (D2, tasks 4.1/4.3).**
   - **Problem:** an equality test between `CHART_TYPES` and the schema enums is green on the pre-change code. Both sides
     are bar/line/pie/scatter, so it can only go red by mutation. If schema discovery matches zero `chartType` enums,
     equality over an empty set passes.
   - **Required:**
     - Specify how enums are discovered: walk `schemas/**` for `chartType` properties, never a hand-copied path list.
     - Assert the discovered count, exactly 6, or fail.
     - Label these tests as guards, and record the mutation that turns each one red. Add `heatmap` to the frontend/MCP
       const only, and separately delete it from one schema.
     - The route-level 201 test and the `buildOutputConfig` test are the genuinely red-first ones (pre-change 400 and
       type error respectively). Say so.

5. **The colour-scale tokens are left open in a way that conflicts with DESIGN.md (D4).**
   - **Problem:** D4 says "add a token pair if none fits". DESIGN.md (around line 125) records that adding a token to
     `theme.css` is a visual-identity decision that needs owner sign-off.
   - **Required:** pin which existing custom properties feed the visualMap `inRange` low and high ends, its text, and the
     empty-cell fill, for example a surface/border rung up to `--app-accent-strong`. State that no new `theme.css` token is
     added without escalation. Note that `--app-accent` is user-selectable via the accent picker, so say whether the scale
     follows the user's accent.

6. **The buildChartOption y-axis merge is left as "verify", but the code gives a definite answer, and test 4.6 would miss
   it (D4, task 4.6).**
   - **What the code does:** in `buildChartOption.ts` the non-pie branch builds `yAxis` from `defaultOption.yAxis` plus
     `appearanceOption.yAxis` only. `dataOption.yAxis` is never merged. The appearance y axis hard-sets `type: "value"`
     and `formatter: formatChartNumber` (`chartAppearance.ts:173-180`).
   - **Consequence:** as written, a heatmap's category y axis (row values) is dropped outright.
   - **Required:**
     - D4 must state the merge change: data `yAxis` included, and the appearance `type`/`formatter` not overriding a
       category axis.
     - Task 4.6 must assert on the **built** option from `buildChartOption` (yAxis `type: "category"` carrying the row
       categories, and a `visualMap` present). Today it asserts only on `buildDataOption`, which would pass while the
       rendered chart has no row axis.

### Non-blocking notes

- **Bin count vs equal values:** the spec says "binCount when set", and also "single bin when every value is equal". State
  which wins when both apply; equal values should win.
- **Heatmap axis order:** the category order for columns and rows is unspecified. First-seen order matches the existing
  bar/line branches, so say so.
- **Compare help text:** the `ChartCompareField.tsx:11` help string is changed by the modified spec, but no task names it.
  Its snapshot (`__snapshots__/OutputEditorSheet.openingState.test.tsx.snap`, four occurrences) will need an intentional
  update, not a blind `-u`.
- **Note wording:** the `chartType` compare note must name the specific type, but `CHART_COMPARE_NOTES` is keyed by the
  blocker only. A parameterised note is needed.
- **Narrow cards:** the skipped-values note shares the footnote area with the HEL-1398 narrow-card clamp. Check it at
  375px alongside the truncation note, as task 4.9 already plans.
- **Specs prose:** the Purpose line of `openspec/specs/chart-type-selector/spec.md` lists "(bar, line, pie, scatter)".
  Consider a delta, or leave it and record why.
- **ChartAppearanceEditor:** it is still imported by `AppearanceEditor.tsx`, while the current chart-type-selector spec says
  the detail modal shows no selector. Task 3.8's reachability check is the right call; record the evidence.

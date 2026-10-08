## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 6218cd479966e7c5f04a75d993216a464d726cd7 (branch has no commits beyond main; change dir untracked).

### What I verified (with evidence)

**(a) AC1 is met in code on the dashboard render path.**
- `frontend/src/features/panels/ui/resolvePanelChartType.ts` resolves the chart type as stored `chart.chartType`, then the Output's `config.chartType` (only bar/line/pie/scatter), then `line`.
- `ChartOutputPanel.tsx:68` calls it with `(appearance.chart, config)`. Lines 69-77 put the resolved type into `resolvedAppearance` (using `defaultChartAppearance` as the base when the panel has no chart), and `ChartRenderer` receives `resolvedAppearance` (lines 111-112). That means `appearanceToEChartsOption`'s panel-only `resolveChartType` only ever sees an appearance whose type is already resolved. The design's claim holds.
- `PanelCard.tsx:463` uses the same resolver for Inspect. `PanelContent.tsx:263` sends chart Outputs through `ChartOutputPanel`.
- I checked that a fresh placement stores no chart. `placeOutputs` (`helio-mcp/src/helioApi.ts:951-964`) sends only `{title, type:"output", config:{outputId}}`. `resolveCreateAppearance` falls back to `PanelAppearance.Default`, whose `chart` is `None`.
- I checked whether the frontend edit sheet could write an implicit "line". `PanelDetailModal.buildInitialChart` does default `chartType` to "line", but the sheet renders `AppearanceEditor` with `showChartSection={false}`, and `handleEditSubmit` sends only background/color/transparency. A grep found no other frontend path that writes `appearance.chart`. So the UI cannot re-introduce the bug.
- In the helio-mcp client, `withCompleteChartAppearance` (default `chartType:"line"`) is used only by `createContentPanel`, and content panels never render charts. `updatePanelAppearance` passes the patch through unchanged.

**(b) The backend D1 merge-base defect is real and correctly scoped.**
- `model.scala:460-470`: `PanelAppearance.applyPatch` merges a chart patch over `existing.chart.getOrElse(ChartAppearance.Default)`. `Default.chartType = Some("line")` (`model.scala:238`). `ChartAppearance.applyPatch` keeps `existing.chartType` when the patch has none (`model.scala:369`). So on main, a legend-only patch on a chartless placement stores `"line"`. `resolvePanelChartType` then returns that stored value ahead of the Output's `bar`. The defect follows directly from the code.
- `PanelServiceHelpers.resolvePatch` (single PATCH) and `PanelMutationRepository.batchUpdate` (updateBatch, per the `validateBatchChartTypes` doc) both go through `applyPatchJson`, so one fix point covers both write paths. That matches the design.
- Patchset rollback/undo (`PatchSetApplyRollback.scala:240`, `PatchSetUndoInverse.scala:33`) sends `chart: null` when the prior panel had no chart. D1 does not change that behaviour.
- Existing tests are unaffected. `PanelAppearanceMergeSpec:68-74` (pie on chartless) still expects `Default.copy(chartType=Some("pie"))`, which D1 produces. The `"line"` assertions in `PanelAppearanceMergeSpec:137/153` and `ApiRoutesSpec:1811/1995` send `"line"` explicitly.

**(c) No AC is silently dropped.**
- AC1: the render path is already correct (a). The new e2e measures it through the batch-placement API (task 3.4).
- AC2: the existing unit test (`ChartOutputPanel.aggregate.test.tsx:221-228`, stored pie beats Output bar) plus a new live e2e override check (task 3.5).
- AC3: tasks 2.1/2.2 plus the description test in task 3.3. The ADDED spec requirement says what both tool descriptions must state. I confirmed the stale text exists today at `placements.ts:44` ("lives on the Output itself") and `write.ts:727-728` ("renders as the line default").

**(d) The e2e plan measures the literal `place_outputs` repro.**
- D3 places panels with `POST /api/panels/batch` using the exact body `placeOutputs` sends, with no appearance. HEL-1351's existing e2e only places through single `POST /api/panels` (lines 179-201), so this adds real coverage. The test asserts the rendered series `type`, and the legend-only case is red on main per (b).
- New e2e specs need no CI registration: `ci.yml:571` uses native `--shard`, so constraint C1 holds.

**Spec deltas.** The MODIFIED "Panel appearance chart merges partially" requirement keeps all three base scenarios (`openspec/specs/panel-appearance-settings/spec.md:174-202`) and adds the chartless legend-only scenario. The ADDED MCP requirement does not collide with any existing requirement name.

**Placeholders / contradictions.** There are no TODO/TBD markers. Proposal, design and tasks agree.

### Verdict: CONFIRM

### Non-blocking notes
1. The reason design.md gives for keeping `ChartAppearance.Default.chartType = Some("line")` is inaccurate. It says "the apply-proposal path and `DashboardSnapshotValidationSpec` read it". A grep of `backend/src/main` finds no use of `ChartAppearance.Default` outside `model.scala` itself; only tests reference it. Keeping the default is still the narrower choice and the decision stands. Fix the stated reason if you touch the scaladoc in task 1.2.
2. Task 3.4: the `liveChart` helper in `e2e/hel1351-aggregated-chart-overlay.spec.ts` returns only series *names*. The new spec has to read `series[].type`. The executor should not copy the helper unchanged and then assert on names.
3. Task 3.4: D3 says "seed ... chart Outputs" without naming the endpoint. To be the literal `add_output` repro, create the Outputs with `POST /api/pipelines/:id/outputs` (what `add_output` calls, `helioApi.ts:1105`), as the HEL-1351 template does, not with `create_pipeline` `outputs[]`.
4. Task 3.5 (red on main) needs evidence that the legend-only e2e case actually fails without the D1 change. A red run against the pre-fix backend, or the red `PanelAppearanceMergeSpec` case from task 3.1, would do.

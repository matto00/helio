### Backend

## 1. Validation rule

- [x] 1.1 Add `ChartPanel.rejectsAggregation(chartType: Option[String], aggregationPresent: Boolean): Option[String]` (companion object, pure) with the shared error message; wire `ChartPanel.validateConfig` to call it with `this.appearance`/`this.config`.
- [x] 1.2 In `PanelService.buildForCreate`, call `panel.validateConfig` after `buildNewPanel` and reject with `ServiceError.BadRequest` before `rejectCompanionBinding`/insert. This covers direct `POST /api/panels`, `POST /api/panels/batch`, and `create_bound_panel` (`BoundPanelService.createPanel` passes `appearance` through) — it does NOT cover apply-proposal/replace-contents (see 1.3a).
- [x] 1.3 Add `aggregationPresenceFromConfigPatch(json): Option[Boolean]` to `PanelServiceHelpers`, mirroring `chartTypeFromAppearanceJson`'s tolerant raw-JSON-peek style.
- [x] 1.3a Extend `ProposalPanelSupport.validatePanel` to reject `panel.type == "chart" && panel.chartType.contains("scatter") && mergedAggregationPresent(panel)`, where `mergedAggregationPresent` calls the existing `buildCreateRequest(dashboardId, panel).config` (pure, no side effects) and peeks its resolved `aggregation` key — NOT `panel.aggregation` directly, which the generic HEL-316 `config` passthrough can bypass (a proposal can supply `aggregation` via `config: {"aggregation": {...}}` instead of the flat field, and `ChartPanelConfig.decodeCreate` reads either identically). This runs inside the existing zero-write pre-pass both `DashboardProposalService.validateStructure` (apply-proposal) and `DashboardContentsService.validatePanels` (replace-contents) already call per-panel before any write — required because `ProposalPanelSupport.buildCreateRequest` never sets `appearance` on its `CreatePanelRequest` (chartType is applied later via a separate `applyAppearance` PATCH whose failure is swallowed), so task 1.2's `buildForCreate` check never sees the proposal's requested chartType for these two paths.
- [x] 1.4 Add `validateScatterAggregationConflict(existing: Panel, spec: ResolvedPanelPatch): Either[String, Unit]` to `PanelServiceHelpers`. First step: type-narrow with `existing match { case cp: ChartPanel => ...; case _ => Right(()) }` (a non-chart panel's incidental `appearance.chart` must never trigger this). Inside the `ChartPanel` branch, compute effective chartType/aggregation-present and delegate to `ChartPanel.rejectsAggregation`; call it synchronously in `PanelService.update` before `patchApplier.apply`.
- [x] 1.5 Add `validateBatchAggregationConflict(pairs: Vector[(PanelBatchItem, Panel)]): Either[String, Unit]` to `PanelServiceHelpers` using the same raw-peek approach (with the same `ChartPanel` type-narrowing guard) against each item's `appearance`/`config` JSON; wire into `PanelService.batchUpdate`'s existing pre-write `for`-comprehension alongside `validateBatchTypeMatch`/`validateBatchChartTypes`.
- [x] 1.6 In `DashboardServiceValidation.validatePanelEntries`, after `PanelConfigCodec.decodeCreateConfig(entry.type, Some(entry.config))` succeeds for a `"chart"` entry, pattern-match its result and — when it's `PanelConfigCodec.ChartCreate(c)` — call `ChartPanel.rejectsAggregation(entry.appearance.chart.flatMap(_.chartType), c.aggregation.isDefined)`; fold a `Some(msg)` into `Left(s"panel '${entry.snapshotId}': $msg")`, matching this function's existing per-entry error style. No raw-JSON peeking needed here — both `entry.appearance.chart.chartType` and the decoded config's `aggregation` are already typed and already the exact values `DashboardSnapshotRepository.importSnapshot` will persist. This is the 5th enforcement site (`POST /api/dashboards/import`), found in design-gate round 3 — see design.md's Non-Goals for the explicit scope boundary (this task adds only this one check; it does not add `chartType`-enum or any other cross-field validation to import).

## 2. Contracts

- [x] 2.1 Update `schemas/panel.schema.json`'s `ChartConfig.aggregation` description to note it's honored for bar/line/pie and rejected (400) with `chartType: scatter`.
- [x] 2.2 Update `helio-mcp/src/tools/write.ts`'s `create_panel` description: add an `aggregation` bullet under the chart config section (shape + bar/line/pie-only restriction).

### Frontend

## 3. Pie aggregate rendering

- [x] 3.1 In `ChartPanel.tsx`, extend `useAggregate` to `chartType === "bar" || chartType === "line" || chartType === "pie"`.
- [x] 3.2 In `buildAggregateDataOption`, branch on `chartType === "pie"` to emit `{ series: [{ type: "pie", data: categories.map((name, i) => ({ name, value: values[i] })) }] }` instead of the bar/line xAxis/series shape.

## 4. Editor UI

- [x] 4.1 Thread `chartType` into `ChartAggregationFields` (or gate its render call in `BindingEditor.tsx`) so the Aggregation section is hidden when the live chart type is `scatter`, replaced with a short inline note explaining why.
- [x] 4.2 When the user switches the live chart-type selector to `scatter` while aggregation fields are populated in the open editor, clear the three aggregation fields client-side so Save never submits the rejected combination.

### Tests

## 5. Coverage

- [x] 5.1 Update `ChartPanel.test.tsx`'s "ignores chartAggregate for a pie chart" test to assert the opposite (pie now honors `chartAggregate`, producing `{name,value}` slices); keep the scatter-ignores-chartAggregate test as-is (still correct post-change).
- [x] 5.2 Add `ChartPanel.test.tsx` coverage for the new pie aggregate data shape (categories/values → `{name,value}[]`) and for donut/percent-label chart options still applying on top of an aggregated pie.
- [x] 5.3 Add/extend a `BindingEditor` test asserting the Aggregation section is absent (or shows the note) when chart type is scatter, and present for pie/bar/line.
- [x] 5.4 Add `PanelSpec`/`ChartPanel`-level Scala tests for `rejectsAggregation`/`validateConfig`: scatter+aggregation rejected, scatter+no-aggregation fine, pie+aggregation fine, bar/line+aggregation fine.
- [x] 5.5 Add `PanelServiceSpec`/equivalent tests: create rejects scatter+aggregation; update rejects chartType-only PATCH to scatter against an existing aggregation; update rejects aggregation-only PATCH against an existing scatter chartType; batchUpdate rejects one conflicting item without partial writes; a non-chart panel PATCH carrying an incidental `appearance.chart.chartType` is unaffected (type-narrowing guard).
- [x] 5.6 Add `DashboardProposalServiceSpec`/`DashboardContentsServiceSpec` tests: (a) a scatter+aggregation chart panel using the flat `aggregation` field, and (b) a scatter+aggregation chart panel supplying `aggregation` via the generic `config` passthrough instead of the flat field (mirroring `DashboardApplyProposalConfigSpec`'s existing `chartOptions`-passthrough test pattern) — both in an apply-proposal request and in a replace-contents request — 400 the ENTIRE call with zero panels/dashboard created.
- [x] 5.7 Manually verify `schemas/panel.schema.json` and `create_panel`'s description both mention the bar/line/pie-only restriction (no automated schema-drift test exists for prose descriptions).
- [x] 5.8 Add a `DashboardServiceValidationSpec`/`DashboardSnapshotRepositorySpec`-level test: importing a snapshot payload with a chart panel entry combining `appearance.chart.chartType: "scatter"` and a populated `config.aggregation` 400s the entire import with zero dashboard/panel rows created; a snapshot with a valid (non-conflicting) chart entry still imports successfully (no regression to existing import behavior).

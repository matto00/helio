## Backend — validation rule + contracts (recovered prior work)

- `backend/src/main/scala/com/helio/domain/panels/ChartPanel.scala` — `ChartPanel.rejectsAggregation` pure predicate (companion object) + `ChartPanel.validateConfig` wired to it.
- `backend/src/main/scala/com/helio/services/PanelService.scala` — `buildForCreate` calls `panel.validateConfig`; `update`/`batchUpdate` call the new `PanelServiceHelpers` guards before any write.
- `backend/src/main/scala/com/helio/services/PanelServiceHelpers.scala` — `aggregationPresenceFromConfigPatch`, `validateScatterAggregationConflict` (single update, `ChartPanel` type-narrowing guard), `validateBatchAggregationConflict` (batch update).
- `backend/src/main/scala/com/helio/services/ProposalPanelSupport.scala` — `validatePanel` extended with `mergedAggregationPresent` (checks the `buildCreateRequest`-resolved config, not the flat field alone, closing the HEL-316 config-passthrough bypass) — covers apply-proposal and replace-contents.
- `backend/src/main/scala/com/helio/services/DashboardServiceValidation.scala` — `validatePanelEntries` extended for the 5th enforcement site, dashboard-snapshot import.
- `schemas/panel.schema.json` — `ChartConfig.aggregation` description updated with the bar/line/pie-only restriction.
- `helio-mcp/src/tools/write.ts` — `create_panel` description's chart config bullet updated with the `aggregation` shape + restriction.

## Backend — tests

- `backend/src/test/scala/com/helio/domain/PanelSpec.scala` — `ChartPanel.rejectsAggregation`/`validateConfig` unit tests (task 5.4): scatter+aggregation rejected; scatter-alone/pie/bar/line all accepted.
- `backend/src/test/scala/com/helio/services/PanelServiceScatterAggregationSpec.scala` — new. Create (rejects, zero writes) and batchUpdate (one conflicting item 400s the whole batch, no partial write) via the full `PanelService` with mocked repositories; single-update rule via direct `PanelServiceHelpers.validateScatterAggregationConflict` unit tests (chartType-only PATCH to scatter, aggregation-only PATCH against an existing scatter, and the `ChartPanel` type-narrowing guard on a non-chart panel) — the helper-level approach sidesteps a Mockito/Scala `AnyVal` interaction where `any()`/`eq()` matchers for a `PanelId` parameter NPE before the mock ever runs.
- `backend/src/test/scala/com/helio/api/DashboardApplyProposalAggregationSpec.scala` — new. `POST /api/dashboards/apply-proposal` rejects scatter+aggregation via the flat field and via the generic `config` passthrough; regression check for scatter with no aggregation.
- `backend/src/test/scala/com/helio/api/DashboardContentsReplaceAggregationSpec.scala` — new. Same coverage for `PUT /api/dashboards/:id/contents` (replace-contents).
- `backend/src/test/scala/com/helio/services/DashboardSnapshotValidationSpec.scala` — added `DashboardService.validateSnapshotPayload` unit coverage for the import-time scatter+aggregation rule (reject; scatter-with-no-aggregation and bar-with-aggregation regressions).
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — added `POST /api/dashboards/import` route-level tests: scatter+aggregation chart entry 400s with zero dashboard rows created; a valid chart entry still imports (regression).

## Frontend — pie aggregate rendering + editor UI

- `frontend/src/features/panels/ui/ChartPanel.tsx` — `useAggregate` extended to `bar || line || pie`; `buildAggregateDataOption` branches on `chartType === "pie"` to emit `{name,value}` slices from the aggregate's categories/values instead of falling back to the per-row `rawRows` path.
- `frontend/src/features/panels/ui/ChartPanel.test.tsx` — updated the pre-existing "ignores chartAggregate for a pie chart" test to assert the new pie-honors-aggregate behavior (task 5.1); added coverage for the aggregate pie data shape and for donut/percent-label `chartOptions` still applying on top of an aggregated pie (task 5.2).
- `frontend/src/features/panels/ui/editors/BindingEditor.tsx` — hides the Aggregation section for a scatter-typed chart (replaced with an inline note); clears populated aggregation fields (adjusted during render, mirroring `TableRenderer`'s existing width-reseed pattern) when the live chart-type selector switches to scatter, so Save never submits the rejected combination.
- `frontend/src/features/panels/ui/editors/BindingEditor.aggregation.test.tsx` — new. Asserts the Aggregation section is present for bar/line/pie and replaced by the scatter note; asserts populated aggregation fields clear (and Save omits them) on a live switch to scatter.

## OpenSpec change artifacts

- `openspec/changes/pie-scatter-chart-aggregation/tasks.md` — all items checked off as implemented/verified.
- `openspec/changes/pie-scatter-chart-aggregation/workflow-state.md` — recovery + execution history (see this file for the full incident account).
- `openspec/changes/pie-scatter-chart-aggregation/{proposal,design,ticket}.md`, `skeptic-design-{1,2,3,4}.md`, `specs/**/spec.md`, `.openspec.yaml` — planning artifacts from the design-gate phase (unchanged by this execution cycle beyond what's noted above).

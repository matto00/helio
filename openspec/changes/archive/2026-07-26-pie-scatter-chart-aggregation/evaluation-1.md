## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All four ticket ACs addressed: (1) pie now honors `aggregation` (grouped `{name,value}` slices); scatter
  fails visibly with a 400 naming the conflict — no silent reinterpretation. (2) Scatter's decision (reject)
  is applied consistently and the rationale ("no coordinate-level meaning for a categorical groupBy
  aggregate") is recorded in design.md D2 and echoed in the shared error message. (3) Discoverable without
  reading `ChartPanel.tsx`: `schemas/panel.schema.json`'s `ChartConfig.aggregation` description and
  `helio-mcp/src/tools/write.ts`'s `create_panel` description both updated. (4) Test coverage exists for
  both the support path (pie) and the reject path (scatter, all five sites).
- All 21 tasks.md items verified against the actual diff, not just trusted as checked — each maps to a real
  code change (see Phase 2).
- Verified all FIVE D2 enforcement sites are wired, not a subset:
  1. Direct create/batch-create/`create_bound_panel` — `PanelService.buildForCreate` calls
     `panel.validateConfig` (`PanelService.scala:157-175`), which delegates to
     `ChartPanel.validateConfig` → `ChartPanel.rejectsAggregation`.
  2. `ProposalPanelSupport.validatePanel` (apply-proposal + replace-contents) — extended with
     `mergedAggregationPresent`, checked against the `buildCreateRequest`-resolved config (not the flat
     field alone), closing the round-2 HEL-316 config-passthrough bypass
     (`ProposalPanelSupport.scala:46-65`).
  3. `PanelService.update` (single) — `validateScatterAggregationConflict` runs before `patchApplier.apply`,
     type-narrows to `ChartPanel`, computes the merged effective chartType/aggregation-present
     (`PanelService.scala:387-407`, `PanelServiceHelpers.scala:225-247`).
  4. `PanelService.batchUpdate` — `validateBatchAggregationConflict` added to the existing pre-write
     `for`-comprehension alongside `validateBatchTypeMatch`/`validateBatchChartTypes`
     (`PanelService.scala:279-282`, `PanelServiceHelpers.scala:249-263`).
  5. `DashboardServiceValidation.validatePanelEntries` (`POST /api/dashboards/import`) — the 5th site added
     per round-3's design-gate finding, using already-typed `entry.appearance.chart.chartType` and
     `ChartCreate(c).aggregation` (no raw-JSON peek needed) (`DashboardServiceValidation.scala:53-72`).
  All five delegate to the single `ChartPanel.rejectsAggregation` predicate — confirmed no independent
  reimplementations of the rule exist.
- Pie-aggregate-slice scenario verified: `buildAggregateDataOption` branches on `chartType === "pie"` to
  emit `{name,value}` slices from the same categories/values aggregate bar/line already compute
  (`ChartPanel.tsx:158-169`), matching design.md D1 and the `echarts-chart-panel` spec delta scenario "Pie
  chart groups and aggregates rows into slices."
- No scope creep — every modified file is accounted for in the proposal's Impact section; no unrelated
  refactors found in the diff.
- Backward compatibility (D3) verified both structurally and by test: `useAggregate`'s guard stays a
  three-way `bar|line|pie` allowlist (not a `!== "scatter"` denylist), so a legacy stored scatter+aggregation
  panel still falls through to raw-row rendering — the pre-existing "ignores chartAggregate for a scatter
  chart" Jest test was left unchanged and still passes.
- Schema/MCP contract updates present and consistent with the implemented behavior (`schemas/panel.schema.json`,
  `helio-mcp/src/tools/write.ts`).
- Planning artifacts (proposal/design/spec deltas) accurately reflect the final implementation — no drift
  found between design.md's D1–D5 decisions and the code.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **CONTRIBUTING.md compliance**: `npm run check:scala-quality` passes clean (no inline-FQN violations
  introduced). File-size soft-budget warnings exist for `ChartPanel.scala` (350 lines), `PanelService.scala`
  (444 lines), and `PanelServiceHelpers.scala` (271 lines) — all three were already over the 250-line soft
  budget before this ticket and grew modestly; per CONTRIBUTING.md these are explicitly "informational
  only," not a gate failure. Noted as a non-blocking suggestion below.
- **Single source of truth verified**: `ChartPanel.rejectsAggregation(chartType, aggregationPresent)` is a
  pure predicate in the companion object (`ChartPanel.scala:341-353`); all five sites call it (directly or
  via `ChartPanel.validateConfig`) rather than reimplementing the condition — confirmed by reading each
  call site, not just trusting the doc comments.
- **DESIGN.md / UI-state pattern compliance**: `BindingEditor.tsx`'s scatter note reuses the existing
  `panel-detail-modal__data-section`/`__data-label`/`__type-hint` classes already used by
  `DataTypePicker.tsx`'s empty-state notes — no new ad-hoc styling introduced. The "adjust state during
  render on a prop transition" pattern for clearing aggregation fields on switch-to-scatter
  (`BindingEditor.tsx:199-215`) is a genuine, verified match to `TableRenderer.tsx`'s pre-existing
  width-reseed pattern (`TableRenderer.tsx:88-100`), not just a comment claiming precedent.
- **DRY**: No duplicated validation logic; the raw-JSON-peek helper (`aggregationPresenceFromConfigPatch`)
  is intentionally parallel to the existing `chartTypeFromAppearanceJson`/`dataTypeIdFromConfigPatch`
  helpers per the file's established style (an explicit, justified trade-off in design.md's Risks section,
  not an unexplained duplication).
- **Type safety**: No untyped escape hatches (`any`/`asInstanceOf` beyond the pre-existing pattern in
  `ChartPanel.CompanionSupport.writeConfigToWire`, unrelated to this change).
- **Error handling**: All five sites reject before any write (verified via `never()`/zero-row-count
  assertions in tests, not just 400-status assertions) — no partial-write or silent-swallow paths
  introduced.
- **Tests meaningful**: Reviewed test bodies, not just names/counts. Backend: `PanelSpec.scala` (predicate +
  validateConfig unit tests), `PanelServiceScatterAggregationSpec.scala` (create/update/batch, including the
  `ChartPanel` type-narrowing guard on a non-chart panel), `DashboardApplyProposalAggregationSpec.scala` /
  `DashboardContentsReplaceAggregationSpec.scala` (both the flat-field AND the HEL-316 config-passthrough
  bypass attempt — exercises the exact round-2 design-gate finding), `DashboardSnapshotValidationSpec.scala`
  / `ApiRoutesSpec.scala` (5th site, both unit and full-route level, zero-write assertions). Frontend:
  `ChartPanel.test.tsx` (pie aggregate data shape, xAxis/yAxis absence, donut/percent-label composition on
  top of an aggregated pie), `BindingEditor.aggregation.test.tsx` (section visibility per chart type, field
  clearing on live switch to scatter, and a Save-omits-aggregation round-trip assertion). These are genuine
  regression-catching tests, not just coverage padding.
- **No dead code**: No leftover TODOs/FIXMEs introduced; `ChartPanel.validateConfig`'s prior "not yet a hard
  gate" TODO is the one this ticket resolves, and the doc comment was updated accordingly.
- **No over-engineering**: The five-site design is exactly as scoped by the (extensively skeptic-reviewed)
  design gate — no speculative generalization beyond the scatter+aggregation rule.
- **Behavior-preserving where expected**: The `PanelService.update` diff restructures the `Right`/`Left`
  nesting order (validate-then-rejectCompanionBinding-then-apply) but does not change any other existing
  behavior — confirmed by the full green backend suite (see gates below).

### Phase 3: UI Review — PASS
Issues: none.

Dev servers started via the canonical script and asserted healthy:
```
scripts/concertino/start-servers.sh ... → READY backend / READY frontend
scripts/concertino/assert-phase.sh servers ... → PASS servers
```

Live smoke test performed (not just re-trusting the executor's report):
- Created a new Pie chart panel bound to a real DataType (Netflix Data), set Aggregation
  (groupBy=ratinglevel, valueField=rating, fn=Count) via the editor UI, saved — PATCH returned 200.
  Reopening the editor showed the aggregation persisted correctly.
- Switched the same panel's live chart-type selector to Scatter — the Aggregation section was immediately
  replaced with the inline note "Aggregation isn't available for scatter — each point plots a raw row,"
  exactly matching design.md D4. Saved — PATCH returned 200 (aggregation cleared client-side before
  submission, per task 4.2).
- Zero console errors throughout the entire flow (panel create → bind → set aggregation → save → switch to
  scatter → save → delete cleanup).
- Resized to 768px — no layout breakage in the panel editor.
- Test panel deleted afterward to leave the shared dev DB clean.
- Note: the dev DB's "Netflix Data" DataType currently has 0 rows (upstream pipeline not re-run in this
  worktree), so a literal rendered-pie-with-visible-slices screenshot wasn't obtainable live; the pie
  aggregate *data shape* (categories/values → `{name,value}[]`, xAxis/yAxis omitted, donut/percent-label
  composition) is instead verified deterministically and thoroughly by the fresh-run Jest suite
  (`ChartPanel.test.tsx`), which is the more precise check for this specific behavior anyway.

Fresh gate re-run (independent of the executor's/orchestrator's prior reports):
- `npm run lint` — clean (0 warnings)
- `npm run format:check` — clean
- `npm run check:scala-quality` — clean (informational file-size warnings only, see Phase 2)
- `npm run check:schemas` — in sync (31 schemas / 27 protocol files, 7 panel-type-enum surfaces)
- `npm test` — 138 suites / 1433 tests passed
- `sbt test` (backend) — 2206 tests / 0 failures
- `npm run check:openspec` — expected "complete but not archived" note only (archiving is a later Delivery
  step, not a Cycle-1 evaluator gate)

### Overall: PASS

### Non-blocking Suggestions
- `ChartPanel.scala` (350 lines), `PanelService.scala` (444 lines), and `PanelServiceHelpers.scala` (271
  lines) are all over CONTRIBUTING.md's informational 250-line soft budget and grew slightly further in
  this ticket. Not a gate failure (informational only per CONTRIBUTING.md), but worth a proactive split
  consideration in a future ticket if either file gets touched again.

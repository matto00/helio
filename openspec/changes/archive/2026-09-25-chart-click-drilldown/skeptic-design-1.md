## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas
  (`specs/chart-drilldown-inspect/spec.md`, `specs/panel-body-click/spec.md`).
- Read the actual `buildDataOption` implementation in
  `frontend/src/features/panels/ui/ChartPanel.tsx` (lines 56-209) line by
  line against design.md Decision D3's per-chart-type mapping claims.
- Traced how a chart Output's `fieldMapping.xAxis`/`.yAxis`/`.series` actually
  get populated in the live tree: `OutputEditorSheet.tsx`/`OutputKindFields.tsx`
  (`frontend/src/features/pipelines/ui/outputEditor/`) never expose an editor
  for these keys (`chartFieldMapping` is read-only, only the `annotation` key
  is ever added); `backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala`
  (`requiredSlots = Vector("xAxis", "yAxis")` for `chart`) and
  `OutputService.scala`'s `validateFieldMapping` (HEL-892) confirm the server
  rejects any chart Output config whose `fieldMapping` is missing `xAxis`/
  `yAxis`. This means `buildDataOption`'s `yCol === -1` "auto-detect multiple
  numeric columns" bar/line fallback (lines 192-209) is unreachable for any
  persisted chart Output — which validates D3's "single series:
  `series = fieldMapping.yAxis` (there is exactly one)" claim as accurate,
  not the gap I initially suspected.
- Verified D2's `stopPropagation` mechanism against the real click handler:
  `DesktopPanelGrid.tsx` line 216-222 (`handleCardClick`) and
  `PanelCard.tsx` line 318-322 (`<article onClick={handleClick}>`) confirm a
  plain React-delegated bubble-phase `onClick` on an ancestor of
  `ChartPanel`'s `<ReactECharts>` canvas — calling `stopPropagation()` on the
  native event inside ECharts' own (descendant-level, bubble-phase) click
  listener correctly prevents the event from ever reaching React's root
  delegated listener. Mechanism is sound.
- Verified D6's cursor-affordance survives the full option-assembly pipeline:
  `appearanceToEChartsOption` (`frontend/src/utils/chartAppearance.ts` lines
  121-183) never sets an `option.series` key at all, so
  `{...dataOption, ...appearanceOption}` cannot clobber `dataOption.series`;
  `applyAxisTriggerTooltip`/`applyHoverEmphasis` (same file) and
  `applyChartTypeOptions` (`chartTypeOptions.ts`) all spread `...s` when
  rebuilding series entries, so a `cursor: "pointer"` added in `buildDataOption`
  survives to the final option regardless of `appearance?.chart`. D6 is sound
  — HEL-1178 is genuinely closed by this approach, not just asserted.
- Verified D5's native-`<dialog>` Escape-stacking claim against
  `frontend/src/shared/ui/Modal.tsx`: Escape is handled per-dialog via the
  native `cancel` event (lines 122-131), and native modal `<dialog>` stacking
  (topmost `showModal()`'d dialog receives Escape) is standard browser
  behavior — the claim is well-founded, and task 4.3 still gates it on a live
  Playwright check before merge, which is the right level of rigor for a
  browser-behavior claim.
- Verified D1's factual premise against `panelsSlice.ts`: `resetPanelPagination`
  (lines 94-96) has **zero dispatch call sites anywhere in the app**
  (`grep -rn resetPanelPagination frontend/src` finds only its own
  definition/export), and neither `fetchPanels.pending` (line 118) nor
  `deletePanel.fulfilled` (line 151) currently clears `paginationState` at
  all — `paginationState` is only ever written, never reset, in the current
  codebase.

### Verdict: REFUTE

### Change Requests

1. **`SelectionDescriptor.value` is a required field with zero defined
   semantics anywhere in this change.** `ticket.md` (line 24), `spec.md`'s
   "Clicking a chart element selects its category/series" requirement, and
   design.md D1's reducer signature (`selectDataPoint({panelId, dimension,
   value, series})`) all declare the descriptor as `{panelId, dimension,
   value, series}` — four fields. But design.md D3 (the per-chart-type
   click→column mapping, the change's central decision) only ever discusses
   `dimension` and `series` for all four chart-type branches (bar/line
   single-series, bar/line multi-series, pie, scatter) — `value` is never
   mentioned once. D4 (the row-filter decision) filters purely on
   `row[xCol] === dimension && row[seriesCol] === series` — again no `value`.
   No scenario in `specs/chart-drilldown-inspect/spec.md` asserts what
   `value` should contain either (all four scenarios under "Clicking a chart
   element selects its category/series" test only `dimension`/`series`).
   Task 2.2-2.4 ("Implement `mapChartClickToSelection`...") give the
   implementer no way to know what to return for this field, for any chart
   type. Worse, the field's *name* invites a plausible but different reading
   than what D3 actually does: a natural parse of `{dimension, value}` is
   "which column, and what value was clicked in it" (i.e. `dimension` =
   column/field identity, `value` = the clicked category), but D3 sets
   `dimension = params.name` directly (the clicked *value*, e.g. `"Q1"`),
   leaving no defined role for `value` at all. This must be resolved before
   execution — either design.md states precisely what `value` holds per
   chart type (plus a spec scenario asserting it) or the type/reducer/spec
   are corrected to drop the field, but it cannot ship unaddressed as is.

2. **spec.md's "switches to a different panel's inspect view" clearing
   trigger is unimplemented, untested, and plausibly contradicts D1's own
   stated rationale.** `specs/chart-drilldown-inspect/spec.md`'s
   "The selection descriptor is view state, cleared on panel/dashboard
   switch" requirement states the descriptor "SHALL be cleared ... when the
   user switches to a different panel's inspect view" — but (a) neither of
   the requirement's two listed scenarios ("Switching dashboards clears the
   selection", "Reloading the page clears the selection") tests this clause,
   and no third scenario exists for it; (b) design.md D1 lists exactly two
   clear points (`deletePanel.fulfilled`, `fetchPanels.pending`) and neither
   implements "opening a different panel's inspect view clears the other
   panel's selection"; (c) this clause is not present in `ticket.md`'s own
   AC text at all ("cleared on panel/dashboard switch" only) — it appears to
   have been invented during spec-writing; and (d) if actually implemented
   literally, it would work against D1's own stated reason for putting
   `interactionState` in Redux rather than component-local state — "HEL-588
   needs to read a panel's selection from outside that panel's own subtree"
   — since clearing panel A's selection the moment panel B's inspect view
   opens would make cross-panel reads unreliable exactly when HEL-588 needs
   them. Resolve by either adding the missing design.md implementation + a
   spec scenario, or removing the clause from spec.md as an unintended
   requirement not grounded in the ticket.

### Non-blocking notes

- design.md's Planner Notes justifies reusing `panelsSlice`'s per-panel-map
  pattern by claiming it "keep[s] dashboard-switch and panel-delete cleanup
  on the same well-tested `extraReducers` hooks already governing
  pagination." This is factually inaccurate against the current
  `panelsSlice.ts` — `paginationState` is not currently cleared on either
  trigger, and `resetPanelPagination` is dead code (defined, exported, never
  dispatched). The planned work itself (task 1.3's new clear-cases for
  `interactionState`) is still correct and sufficiently specified on its own
  terms, so this doesn't block execution, but the executor should not go
  looking for an existing "mirrored" pagination-clearing mechanism to model
  against — there isn't one; task 1.3 is originating new behavior, not
  reusing established behavior.

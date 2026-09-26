## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — FAIL

Issues:

1. **AC not met for Table-kind sibling panels ("Selecting a data point in one panel filters
   sibling panels sharing that dimension to the matching subset").** Live verification (see
   Phase 3) shows a Table-kind panel's rendered rows do NOT narrow when a cross-filter is active,
   even though the filter math is correctly computed (the panel's own truncation disclosure
   correctly reports "50 of 200 loaded rows match", proving `rawRows` was filtered upstream). The
   DataGrid's actually-displayed rows remain the full, unfiltered set. This directly contradicts
   spec.md's "Requirement: An active cross-filter narrows sibling panels..." and its own
   table-specific clause ("For a table panel, 'field mapping references a column' means the
   column is part of the table's effective displayed-column set") — implying tables are in scope,
   and nothing in spec.md exempts them. See Phase 3 for the full repro and root cause.
2. Tasks 7.1–7.3 (live verification) were left unchecked by the executor and deferred to this
   evaluation, as documented; this evaluation performed them and found the Phase 3 issue above.
   tasks.md item 6.5 ("a sibling panel's rendered rows narrow... table via `columnOrder`") is
   marked done and its own component test passes, but that test's mocked `usePanelData` never
   populates `paginationState[panelId]`, so it never exercises the code path that breaks live
   (see Phase 2/3). The task is marked complete on the strength of a test that does not
   reflect real component wiring.

Other Phase 1 checks pass:
- Chart-click behavior is byte-for-byte unchanged (`useChartClickHandler.ts` has zero diff;
  `PanelCard.handleDataPointSelect` body unchanged) — matches the owner's "Action in Inspect"
  ruling and D1's "no modified capability."
- `PanelInspectView`'s new footer action, `panelsSlice`'s `crossFilter` state/reducers, the
  numeric-safe row filter, and the field-mapping-based filterable-panel criterion all match
  design.md D2–D4 and spec.md's scenarios exactly (verified against source, not just tests —
  see Phase 2).
- No scope creep found outside the ticket; `PanelContent.tsx`'s `if`-chain → `if/else`-chain
  restructuring is behavior-preserving refactor needed to append the D7 disclosure once, not a
  drive-by change.
- `workflow-state.md`'s CONSTRAINTS (C1–C6) are honored: no new migration taken (C1), all
  artifacts inside the worktree (C2), `files-modified.md` lists every touched file including test
  fixtures (C3), etc.
- Planning artifacts (design.md/tasks.md) accurately reflect the implemented behavior for every
  item EXCEPT the Table-narrowing claim above.

### Phase 2: Code Review — FAIL

Gates (run fresh in `WORKTREE_PATH`, frontend-only diff):
- `npm run lint` — PASS (zero warnings)
- `npm run format:check` — PASS
- `npm test` — PASS (354 suites / 3858 tests, full run including helio-mcp)
- `npm --prefix frontend run build` — PASS

Issues:

1. **Design defect: D4's "single call site... every downstream consumer sees the same filtered
   rows automatically" is false for Table-kind panels**, because `PanelCardBody` (shared by both
   the desktop grid `PanelCard` and the mobile `MobileStackPanelBody` — `PanelCard.tsx:120`) reads
   `state.panels.paginationState[panel.id]` directly via its own `useAppSelector`, independently
   of the `rawRows`/`headers` props `useCrossFilteredPanelData` produces, and forwards
   `paginationRows={paginationEntry?.rows ?? null}` to `PanelContent` unfiltered
   (`PanelCard.tsx:172`). `TableRenderer.tsx:258-259` then prefers `paginationRows` over `rawRows`
   whenever `paginationRows` is non-empty (`usingPagination = Boolean(paginationRows &&
   paginationRows.length > 0)`), and `usePanelData.ts:101` unconditionally dispatches
   `fetchPanelPage({ page: 0 })` on mount — so `paginationState[panelId].rows` is populated for
   essentially every Output-bound panel with data, before a user ever clicks "Load more". The net
   effect: cross-filtering a Table panel changes what its truncation disclosure reports, but never
   changes what the grid actually displays. This is a genuine, reproducible functional defect
   (`frontend/src/features/panels/ui/PanelCard.tsx:172`, `frontend/src/features/panels/ui/renderers/TableRenderer.tsx:258-259`),
   not a documentation nit.
2. **Test-suite gap that let (1) ship.** `PanelCard.crossFilter.test.tsx` mocks `usePanelData`
   entirely (`jest.mock("../hooks/usePanelData", ...)`) and never seeds
   `panels.paginationState[panelId]` in its `renderWithStore` preloaded state (see
   `renderPanelCard`, lines ~68-98). With `paginationState` absent, `paginationEntry` is
   `undefined`, `paginationRows` is `null`, `usingPagination` is `false`, and `TableRenderer`
   falls through to the (correctly-filtered) `rawRows` branch — the ONE branch that exists in the
   real app only until the first `fetchPanelPage` resolves, which is immediate. The "narrows a
   sibling table panel to the matching subset" test therefore proves the util/hook logic is
   correct in isolation but does not prove the live component tree narrows a table panel, and the
   gap is invisible from the test output alone.

Standards compliance (CONTRIBUTING.md/DESIGN.md, mechanical rules):
- No inline FQN violations (Scala rule; N/A — this diff is frontend-only).
- File-size soft budget: `PanelCard.tsx` is already 620 lines pre-diff (only +34/-8 lines from
  this change) — over the ~400-line "propose a split" threshold, but this is pre-existing debt,
  not introduced by this diff; flagged as a non-blocking suggestion, not a blocker.
- `CrossFilterIndicator.css` uses only `--app-*`/`--space-*`/`--text-*` tokens (`--app-accent-mid`,
  `--app-accent-dim`, `--app-radius-md`, `--space-2/3/4`, `--text-sm`, `--weight-medium`) — no
  hardcoded colors, no box-shadow/border-radius literals; the `elevationTokenGuard`/
  `motionTokenGuard` file-count bumps (119→120) are correctly justified and verified green.
- DRY: reuses `LoadedScopeDisclosure` (HEL-448/451) rather than a new component for D7, exactly
  as design.md specifies; reuses the existing `chartClickSelection.ts` numeric-match precedent for
  D4's `cellMatchesValue`.
- Type safety: no `any`/untyped escape hatches introduced.
- Dead code: none found; no leftover TODO/FIXME.
- Over-engineering: none — `crossFilterRows.ts` and `useCrossFilteredPanelData.ts` are both small,
  single-purpose, well-documented units.

Independently verified against source (per the orchestrator's specific requests):
- **Click handler untouched**: confirmed — `useChartClickHandler.ts` has an EMPTY diff against the
  base, and `PanelCard.tsx`'s `handleDataPointSelect` body is unchanged (still only
  `dispatch(selectDataPoint(...))` + `setIsInspectOpen(true)`).
- **Numeric-safe matching / field-mapping-based filterable criterion**: `crossFilterRows.ts`'s
  `cellMatchesValue` and `isPanelFilterableByDimension` do exactly what design.md D4 and the
  "Filterable-panel criterion" section claim — verified against `outputConfigTypes.ts`'s
  `readTableConfig`/`readChartConfig`/etc. and confirmed live (see Phase 3: a scatter-style
  numeric selection and a table's `columnOrder`-based check both behaved as documented).
- **Metric-recompute root-cause characterization**: accurate for the unit-test failure itself —
  `OutputPanelContent`'s `Object.values(cfg.fieldMapping)[0]` line is byte-identical before/after
  this diff (only reindented from an early `return` into an `if/else` chain), so the fix genuinely
  was fixture-only for that one test. However, live testing (Phase 3) shows this PRE-EXISTING
  code has a real, reproducible production fragility beyond that one test: the backend does not
  preserve `fieldMapping` key insertion order on round-trip (a metric Output created with
  `{value, label}` came back from `GET`/pipeline-run responses as `{label, value}`), so
  `Object.values(...)[0]` silently resolves to the wrong column whenever a metric's `fieldMapping`
  has more than one key. This is out of scope for THIS diff (pre-existing, unrelated file), so it
  is not a change request against this ticket, but it undermines confidence in AC "aggregated
  panels recompute correctly over the subset" for any metric whose `fieldMapping` needs a second
  key (e.g. to satisfy the new filterable-panel criterion) — flagged as a follow-up below.

### Phase 3: UI Review — FAIL

Dev servers verified serving THIS worktree before use:
`readlink /proc/<pid>/cwd` for both the frontend (port 6020) and backend (port 8927) listeners
resolved to `.../worktrees/feature/cross-filter-panels/HEL-588/{frontend,backend}`.

Test setup (via the app's own APIs, session-cookie-authenticated from the browser): a dashboard
with 6 Output panels — a 260-row Table (`columnOrder: [quarter, region, revenue]`), a 260-row line
Chart (`fieldMapping: {xAxis: quarter, yAxis: revenue}`), a Metric (`fieldMapping: {value: revenue,
label: quarter}`), a Collection with NO `quarter` reference (`fieldMapping: {value: category}` —
the "one that doesn't [share the column]" control), and a small 4-row bar-configured Chart (no
stored `appearance.chart`, exercising HEL-1178) used to drive a real click.

Checks:
- [x] **Happy path (chart-click → Inspect → Filter action → indicator) works end-to-end.**
  A real synthetic click on the small chart's canvas (precisely located via pixel-scanning, not
  guessed coordinates) opened Inspect showing "Showing rows for quarter: Q1 / revenue" with the
  correct row, and the footer showed BOTH "Filter dashboard by quarter = Q1" (new) and "Clear
  selection" (existing), exactly per D3. Clicking "Filter dashboard by quarter = Q1" closed
  Inspect and set the dashboard-level indicator ("Filtered by quarter = Q1", with a working ×
  clear-all control that correctly restored every panel to unfiltered).
- [x] Chart-kind sibling panel narrowing: PASS — the 260-row line Chart correctly narrowed to
  exactly 50 Q1-only points (x-axis literally repeats "Q1" 50 times) after the filter was set.
- [x] Non-matching panel unaffected: PASS — the Collection panel (`fieldMapping` has no `quarter`)
  showed unchanged Widgets/Gadgets content throughout.
- [ ] **FAIL — Table-kind sibling panel does NOT narrow.** The Table panel's grid continued to
  show `Q1, Q2, Q3, Q4, Q1, Q2, ...` (fully unfiltered) while its own D7 disclosure simultaneously
  read "50 of 200 loaded rows match." — a live, user-visible contradiction between what the panel
  claims and what it shows. Root cause and code citations in Phase 2 above. See persisted
  screenshots `crossfilter-indicator.png` (shows the contradiction directly under the Table panel)
  and `big-chart-after-filter-2.png` (shows the Chart panel correctly narrowed, for contrast, in
  the same state).
- [~] Metric-kind sibling panel recompute: mechanically wired correctly (disclosure read "50 of
  200 loaded rows match" both before and after, i.e. the filtered row count reached the metric
  renderer) but the DISPLAYED value was "0" in both the filtered and unfiltered state, due to the
  pre-existing, out-of-scope `fieldMapping` key-order fragility described in Phase 2. Not a defect
  in this diff, but it means live verification of "a metric panel recomputes over the filtered
  subset" (tasks.md 6.6 / spec.md's metric scenario) could not be positively confirmed end-to-end
  for a metric whose `fieldMapping` needs a second key — see follow-up recommendation below.
- [x] Cross-filtering works on a chart panel with no stored `appearance.chart` (HEL-1178's known
  hazard, tasks.md 7.3): CONFIRMED — the small chart used for the whole live test above had no
  `appearance.chart` set (created via the API directly) and rendered as a default line chart;
  click-to-inspect-to-filter worked identically to the appearance-configured big Chart panel.
- [x] No console errors attributable to the cross-filter feature itself. Console did show repeated
  `502` errors for `GET .../pipelines/<id>/run-events` (an SSE run-status subscription unrelated
  to this ticket) — these come from `usePanelRunRefresh`'s existing fan-out subscription for
  ad hoc pipelines this evaluation created via direct API calls outside the normal
  create-pipeline UI flow, not from any code this diff touches; not counted against this ticket.
- [x] Clear-all control: PASS — restored every panel's unfiltered data.
- [ ] Breakpoint sweep (1440/1100/768/0) and light/dark toggle-without-navigating: NOT completed
  due to time spent isolating the Table-panel defect above; the D6/D7 CSS was already confirmed
  token-only (light/dark-safe by construction) in Phase 2. This is a gap in this evaluation's own
  coverage, not a pass — flag for the next cycle's evaluator if this is fixed and re-submitted.

Evidence persisted (screenshots referenced above) at, e.g.:
`/home/matt/Development/helio/.concertino/runs/HEL-588/evidence/crossfilter-indicator.png`,
`/home/matt/Development/helio/.concertino/runs/HEL-588/evidence/big-chart-after-filter-2.png`,
`/home/matt/Development/helio/.concertino/runs/HEL-588/evidence/after-clear-filter.png`.

### Overall: FAIL

### Change Requests

1. Fix Table-kind cross-filtering so the panel actually narrows in the live app, not just in its
   truncation disclosure. `PanelCardBody` (`frontend/src/features/panels/ui/PanelCard.tsx:120,172`)
   reads `state.panels.paginationState[panel.id]` independently of the cross-filtered
   `rawRows`/`headers` it also receives as props, and forwards the RAW `paginationEntry.rows` to
   `PanelContent`'s `paginationRows` prop. `TableRenderer.tsx:258-259` prefers `paginationRows`
   whenever non-empty, which is essentially always (`usePanelData.ts:101` fetches page 0
   unconditionally on mount). Either (a) also apply `filterRowsByDimension`/
   `isPanelFilterableByDimension` to `paginationEntry.rows` (converting to/from its
   `Record<string,unknown>[]` shape) before it reaches `TableRenderer`, or (b) have
   `useCrossFilteredPanelData`/`PanelCardBody` filter whichever of the two row shapes
   `TableRenderer` will actually select, so the two never diverge again. Add a regression test
   that seeds `panels.paginationState[panelId]` with non-empty rows (mirroring what
   `usePanelData`'s real `fetchPanelPage(page: 0)` dispatch produces) in
   `PanelCard.crossFilter.test.tsx`'s "narrows a sibling table panel" case — the current test
   passes only because it never populates that state, silently masking this exact defect.
2. Re-verify the fix live (Playwright) against a Table panel specifically, the way this evaluation
   did, before re-submitting — a mocked/unit-level pass is not sufficient evidence here, per
   `verification-before-completion.md`, given change request 1 exists specifically because a
   green mocked test previously certified the opposite of live behavior.
3. Complete the breakpoint sweep (1440/1100/768/0) and a light/dark toggle-without-navigating
   check for the new `CrossFilterIndicator` and the D7 disclosure text, which this evaluation did
   not reach.

### Non-blocking Suggestions

- `PanelCard.tsx` is 620 lines (pre-existing, this diff added ~34 net lines) — over
  CONTRIBUTING.md's ~400-line "propose a split" threshold. Not blocking for this ticket, but worth
  a decomposition pass given HEL-1180 (the immediately preceding merged PR) was itself a
  single-concern split of a different oversized file.
- The pre-existing `Object.values(fieldMapping)[0]` convention in `OutputPanelContent`'s metric
  branch (`PanelContent.tsx`) is fragile against backend `fieldMapping` key-order round-tripping
  (confirmed non-deterministic live: a metric Output created with `{value, label}` came back
  `{label, value}`). This is out of scope for HEL-588, but since HEL-588's own
  filterable-panel criterion can legitimately push a metric's `fieldMapping` to need a second key
  (e.g. `label` bound to the cross-filter's dimension column, as this evaluation's own test setup
  needed), it is worth a follow-up ticket so "metric panel recomputes over the filtered subset" is
  actually verifiable end-to-end for that combination.

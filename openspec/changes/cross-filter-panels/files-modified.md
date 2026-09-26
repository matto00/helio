# Files modified — HEL-588 cross-filter-panels

Cumulative across cycle 1 (initial implementation), cycle 2 (evaluation-1.md
change requests + a live-verification-discovered follow-up fix), cycle 3
(skeptic-final-1.md REFUTE — a genuine regression the cycle-2 refactor
introduced at one call site), and cycle 4 (evaluation-3.md's C6/CON-228
re-check — a SECOND, narrower regression the cycle-3 fix introduced one call
site further down, same bug class). `MobilePanelStack.test.tsx` remains
byte-identical to base (cycle-1 addition fully reverted in cycle 2) — see the
architecture notes below for why.

## Cycle 4 (evaluation-3.md CR1-CR4 — nested Inspect ignored the cross-filter inside Fullscreen)

- `frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx` — **the fix**:
  added a SECOND, separate prop pair (`inspectRawRows`/`inspectHeaders`) for
  the nested `<PanelInspectView>` specifically, decoupled from `rawRows`/
  `headers` (which stay raw, feeding this overlay's own `<PanelContent>`, per
  cycle 3's fix). Falls back to `rawRows`/`headers` when omitted (defensive
  only — `PanelCard` always passes it explicitly).
- `frontend/src/features/panels/ui/PanelCard.tsx` — passes
  `inspectRawRows={crossFilteredRawRows}` / `inspectHeaders={crossFilteredHeaders}`
  (the SAME already-filtered values already threaded to the grid-context
  `PanelInspectView`) into the new prop pair. Doc comments rewritten to
  describe the two-consumer split accurately (previous comments, written
  during cycle 3, described the now-fixed side effect as "deliberate,
  accepted" — that framing is now stale and removed).
- `frontend/src/features/panels/ui/PanelCard.crossFilter.test.tsx` — new
  regression test (evaluation-3.md CR2): a chart plotted by "region" but
  filterable by "quarter" (a genuine dimension mismatch — required per CR3's
  own repro rationale, since a same-dimension panel masks this exact bug).
  Clicks the SAME "West" point in both the grid-context chart and the
  Fullscreen-nested chart, and asserts both Inspect mounts show the identical
  single narrowed row. Red-first proven: reverted the fix, confirmed the
  Fullscreen Inspect leaks an extra quarter's row (`<td>205</td>` visible when
  it shouldn't be), restored, confirmed both mounts agree.
- `e2e/hel588-cross-filter-panels.spec.ts` — new live test (evaluation-3.md
  CR3): two panels — one plotting by quarter (used to set the cross-filter),
  one plotting by region but filterable by quarter (the dimension-mismatch
  panel under test). Clicks a region in both the grid card and Fullscreen,
  asserting both Inspect mounts show exactly 1 row (not both quarters' rows
  for that region). Live-verified against the real dev server; screenshot at
  `.concertino/runs/HEL-588/evidence/fullscreen-inspect-dimension-mismatch-fixed.png`
  shows Fullscreen's Inspect correctly narrowed to the single Q1/West row.
- `openspec/changes/cross-filter-panels/design.md` — CR4 (documentation
  hygiene): D4 was stale since cycle 1 (described filtering as happening
  "once, at the `usePanelData(panel)` call site in `PanelCard`" — cycle 2
  moved the main-content filtering into `OutputPanelContent` and this text
  was never updated). Replaced with an accurate description of the current
  two-consumer architecture (main content filtered inside
  `OutputPanelContent`; every `PanelInspectView` mount, including the one
  nested in `PanelFullscreenOverlay`, fed the already-filtered values
  directly), per MISTAKES.md's "corrections replace decision text; they never
  accumulate beneath it."

### Root cause / probe record (cycle 4)

**Symptom (evaluation-3.md, live-reproduced):** with a cross-filter narrowing
a chart plotted by "region" (filterable by "quarter"), clicking "West" from
the grid card's Inspect correctly showed 1 row; clicking the identical point
from inside that same panel's Fullscreen overlay showed 4 rows (all
quarters), even though the Fullscreen chart itself visibly plotted only the
cross-filtered subset.

**Root cause:** `PanelFullscreenOverlay` has only ONE `rawRows`/`headers`
prop pair internally, shared by its own `<PanelContent>` (which correctly
needs the RAW values, per cycle 3's fix, for D7 truncation-count correctness)
AND its nested `<PanelInspectView>` (which needs the OPPOSITE — the ALREADY
cross-filtered values, since Inspect renders its own `DataGrid` directly
rather than going through `OutputPanelContent`). Cycle 3's fix correctly
switched that ONE shared pair to raw, which fixed the truncation-count bug
but broke the nested Inspect, which had been (accidentally) correct before
cycle 3 specifically because BOTH its needs were served by the same
(cross-filtered) value at the time.

**Probe:** built a dimension-mismatch fixture (chart plotted by "region",
filterable by "quarter" via an unrelated fieldMapping key) in both a Jest
regression test and a live Playwright spec — a same-dimension fixture (like
cycle 2/3's own tests) cannot surface this bug, since the cross-filter's own
narrowing and the click-selection's narrowing would coincide either way.
Reverted the fix, confirmed the Jest test fails with an extra row (`205`)
visible in the Fullscreen Inspect that shouldn't be there; confirmed live via
Playwright with the actual dev server (screenshot evidence above).

**Fix:** gave `PanelFullscreenOverlay` a second, separate prop pair
(`inspectRawRows`/`inspectHeaders`) sourced from `PanelCard`'s existing
`crossFilteredRawRows`/`crossFilteredHeaders` (no new fetch, no new hook —
the same value already threaded to the grid-context `PanelInspectView`), so
its two internal consumers each get what they need without one shared value
serving both.

### Sanity sweep for the same bug class (orchestrator's explicit request)

Re-audited every `rawRows`/`headers`/`crossFilteredRawRows` wiring site across
the panels feature after this fix:
- `PanelCard.tsx`: `PanelCardBody` gets raw; grid-context `PanelInspectView`
  gets filtered; `PanelFullscreenOverlay` gets raw (`PanelContent`) +
  filtered (`inspectRawRows`/`inspectHeaders`, nested Inspect). All four
  correct.
- `MobilePanelStack.tsx`: `MobileStackPanelBody` passes `usePanelData`'s raw
  rows straight through to `PanelCardBody` — no Inspect/Fullscreen mount
  exists on mobile at all, so there is no second consumer to mismatch.
- `PanelDetailModal.tsx` (the "Customize" editor): uses its OWN independent
  `usePanelData` call, never reads `crossFilter`/`crossFilteredRawRows` at
  all — legitimately out of scope (never named in tasks.md 3.3's consumer
  list; editing a panel's config is deliberately unaffected by a transient
  dashboard view-state filter).
- `OutputPanelContent` (`PanelContent.tsx`) itself: unchanged this cycle:
  filters whatever `rawRows`/`paginationRows` it's given, using its own
  `output` + `crossFilter` + `panelId` — correct regardless of caller
  identity, and not a "two consumers sharing one prop" shape at all.

No further instances of this bug class found.

## Cycle 3 (skeptic-final-1.md REFUTE)

- `frontend/src/features/panels/ui/PanelCard.tsx` — **the fix**: the
  `<PanelFullscreenOverlay>` call was wrongly passing `crossFilteredRawRows`/
  `crossFilteredHeaders` (the ALREADY cross-filtered values) instead of
  `panelData.rawRows`/`panelData.headers` (raw), contradicting this file's
  own doc comment three lines above stating the intended architecture.
  Changed to pass the raw values, matching `PanelCardBody`'s own call.
  `crossFilteredRawRows`/`crossFilteredHeaders` now feed ONLY the
  grid-context `PanelInspectView` mount, as originally intended. Doc comment
  expanded to record the root cause and the one accepted consequence: the
  Fullscreen overlay's OWN nested `PanelInspectView` now also receives raw
  (not cross-filtered) rows for its click-selection — see "Known follow-up"
  below.
- `frontend/src/features/panels/ui/PanelCard.crossFilter.test.tsx` — new
  regression test (skeptic-final-1.md CR2): seeds `rowsTruncated: true` on a
  sibling panel, opens its Fullscreen overlay, and asserts the disclosure
  reads the SAME "2 of 3 loaded rows match." the grid card shows — not "2 of
  2" (the bug). Red-first proven: reverted the fix, confirmed this exact test
  fails with "2 of 2" rendered, restored the fix, confirmed green.
- `e2e/hel588-cross-filter-panels.spec.ts` — extended the >200-row truncation
  test (skeptic-final-1.md CR3) to also open that Table panel's Fullscreen
  overlay and assert its disclosure reads "150 of 200 loaded rows match."
  (matching the grid card), never "150 of 150". Live-verified: screenshot at
  `.concertino/runs/HEL-588/evidence/fullscreen-truncation-disclosure-matches-grid.png`.

### Root cause / probe record (cycle 3)

**Symptom (skeptic-final-1.md, live-reproduced):** the grid-context Table
disclosure correctly read "50 of 200 loaded rows match." while that SAME
panel's Fullscreen overlay read "50 of 50 loaded rows match." — the
denominator collapsed to the post-filter match count.

**Root cause:** `PanelCard.tsx`'s `<PanelFullscreenOverlay>` call passed
`crossFilteredRawRows`/`crossFilteredHeaders` (cycle 2's Inspect-only
derived value) instead of the raw `panelData.rawRows`/`panelData.headers`.
`OutputPanelContent` (reached via `PanelFullscreenOverlay`'s own
`<PanelContent>`) then filtered an ALREADY-filtered array a second time —
idempotent for the rendered rows (same subset either way), but
`crossFilterLoadedRowCount = rawRows?.length` inside `OutputPanelContent`
read the pre-filtered prop's length (the match count), not the panel's true
total loaded row count.

**Probe:** read `PanelCard.tsx`'s `PanelFullscreenOverlay` call site against
its own doc comment three lines above (which already stated the correct
architecture); reproduced with the new `PanelCard.crossFilter.test.tsx` test
seeded with `rowsTruncated: true` — failed with "2 of 2 loaded rows match."
before the fix, passed with "2 of 3" after. Re-verified live via Playwright
(`e2e/hel588-cross-filter-panels.spec.ts`'s truncation test), matching the
skeptic's own 150/200 numbers.

**Fix:** pass `panelData.rawRows`/`panelData.headers` into
`<PanelFullscreenOverlay>` instead, matching `PanelCardBody`'s own call and
the pre-existing doc comment's stated intent.

### Known follow-up (not fixed here, flagged transparently)

Fixing CR1 exactly as specified means `PanelFullscreenOverlay`'s OWN nested
`PanelInspectView` (opened by clicking a chart element while already inside
Fullscreen) now also receives the RAW, unfiltered rows for its own
click-selection filtering, rather than the dashboard cross-filter's narrowed
subset the grid-context Inspect uses — because `PanelFullscreenOverlay`
threads ONE `rawRows`/`headers` prop pair to both its own `<PanelContent>`
and its nested `<PanelInspectView>` internally, and CR1 requires that shared
pair to be raw. This is a narrower, previously-latent inconsistency (a
cross-filtered sibling chart panel's own Inspect-in-Fullscreen view no longer
matches the grid-context Inspect's scope) that neither the skeptic's report
nor this fix addresses head-on; flagged here as a follow-up candidate rather
than resolved unilaterally, since the skeptic's own CR1 instruction is
explicit and literal about wiring `PanelFullscreenOverlay`'s ONE prop pair to
the raw values.

## Core implementation

- `frontend/src/features/panels/state/panelsSlice.ts` — new `crossFilter: SelectionDescriptor | null` state, `setCrossFilter`/`clearCrossFilter` reducers (idempotent re-set via reference-preserving no-op), clear-on-dashboard-switch (`fetchPanels.pending`) and clear-on-origin-delete (`deletePanel.fulfilled`) cases.
- `frontend/src/utils/crossFilterRows.ts` — pure utils: `cellMatchesValue` (exported, numeric-safe match — cycle 2), `filterRowsByDimension` (positional `string[][]` shape), `filterRecordRowsByDimension` (keyed `Record<string,unknown>[]` shape — cycle 2, added for CR1), `isPanelFilterableByDimension` (per-output-kind filterable-panel check).
- `frontend/src/features/panels/hooks/useCrossFilteredPanelData.ts` — cycle 2: narrowed to a single consumer (`PanelCard`, for `PanelInspectView`'s own filtered rawRows/headers) after the architecture change below; the hook itself (numeric-safe filter + origin exemption + per-kind filterable check) is unchanged.
- `frontend/src/features/panels/ui/PanelContent.tsx` — **cycle 2 architecture change (evaluation-1.md CR1/CR2):** `OutputPanelContent` now applies the cross-filter itself (new `panelId` prop, reads `crossFilter` from Redux, uses the `output` it already resolves for kind-dispatch) to BOTH `rawRows` (chart/metric/collection/timeline) and `paginationRows` (table), and computes `isCrossFiltered`/the D7 `LoadedScopeDisclosure` internally — no longer caller-supplied props. This is what fixes CR1 (a Table-kind panel's `paginationRows`-preferred rendering branch was never filtered) and does so without introducing any new `useOutputMeta` fetch (closing the race described below).
- `frontend/src/features/panels/ui/PanelCard.tsx` — cycle 1 added `useCrossFilteredPanelData`; cycle 2 narrowed its use to ONLY `PanelInspectView`'s rawRows/headers (Inspect renders its own `DataGrid` directly, not through `OutputPanelContent`) — `PanelCardBody`'s own `<PanelContent>` call and its `paginationRows` prop now pass the RAW, unfiltered values (`OutputPanelContent` filters them). Chart click handler (`handleDataPointSelect`) untouched throughout, per the owner ruling.
- `frontend/src/features/panels/ui/grid/MobilePanelStack.tsx` — cycle 1 added a NEW `useOutputMeta`+`useCrossFilteredPanelData` call in `MobileStackPanelBody` (mobile had no prior Output fetch); **cycle 2 reverts this entirely** — that second, independent fetch of the same Output was the confirmed root cause of a live, reproducible defect (see below). Mobile now passes `usePanelData`'s raw `rawRows`/`headers` straight through, relying entirely on `OutputPanelContent`'s own filtering.
- `frontend/src/features/panels/ui/PanelInspectView.tsx` — new footer action ("Filter dashboard by {dimension} = {value}", `.mono` value), rendered only alongside a real selection; dispatches `setCrossFilter(selection)` then calls the existing `onClose`.
- `frontend/src/features/panels/ui/CrossFilterIndicator.tsx`,
  `frontend/src/features/panels/ui/CrossFilterIndicator.css` — dashboard-level "Filtered by {dimension} = {value}" indicator, `role="status"`/`aria-live="polite"`, accent-dim wash + accent-mid border (DESIGN.md §3 selection-state tokens). Self-gates on `crossFilter !== null`.
- `frontend/src/features/panels/ui/PanelList.tsx` — mounts `<CrossFilterIndicator />` above the panel grid.

## Test files

- `frontend/src/features/panels/state/panelsSlice.test.ts` — `crossFilter` describe block (set/replace/idempotent re-set/clear/dashboard-switch/origin-delete); `crossFilter: null` added to three pre-existing strictly-typed `preloadedState` literals.
- `frontend/src/utils/crossFilterRows.test.ts` — unit tests for all four exported functions, including `filterRecordRowsByDimension` (cycle 2, evaluation-1.md CR1).
- `frontend/src/features/panels/hooks/useCrossFilteredPanelData.ts`,
  `frontend/src/features/panels/hooks/useCrossFilteredPanelData.test.ts` — hook tests (no-op inactive, narrows sibling, exempts origin/non-matching output, re-derives on a fresh `rawRows` reference, tolerates `output: null`).
- `frontend/src/features/panels/ui/PanelInspectView.test.tsx` — filter-action tests: hidden in empty state, dispatches + closes (not `onClear`), replaces on a different selection, native focusable button.
- `frontend/src/features/panels/ui/CrossFilterIndicator.test.tsx` — renders/clears/announces via the live region.
- `frontend/src/features/panels/ui/PanelCard.crossFilter.test.tsx` — sibling narrows / origin exempt / non-matching unaffected / metric recompute; **cycle 2** adds `seedPaginationRows` support to `renderPanelCard` and seeds it in all three table tests (evaluation-1.md CR1's explicit regression-test request) — without the seed, `TableRenderer`'s real `paginationRows`-preferred branch was never exercised, which is exactly how the live defect shipped un-caught in cycle 1.
- `frontend/src/features/panels/ui/PanelContent.test.tsx` — cycle 2: 10 tests that reach `OutputPanelContent`'s real per-kind rendering switched from bare `render(...)` to `renderWithStore(...)`, since `OutputPanelContent` now calls `useAppSelector` and needs a Redux `Provider`.
- `frontend/src/test/renderWithStore.tsx` — `TestState.panels` gained optional `crossFilter` and `paginationState` fields (both default to the slice's own initial-state values).
- `frontend/src/features/patchSets/ui/PatchSetReviewPage.test.tsx` — `crossFilter: null` added to its own strictly-typed `preloadedPanelsState` helper.
- `frontend/src/theme/elevationTokenGuard.css.test.ts` / `motionTokenGuard.css.test.ts` — pinned CSS-file-count guard bumped 119 → 120 for the new `CrossFilterIndicator.css` (zero box-shadow/border-radius-literal/motion hits — its `border-radius` uses a token — so no new pin entries needed).
- `e2e/hel588-cross-filter-panels.spec.ts` — new live-browser spec (cycle 2, evaluation-1.md CR2/CR3/tasks.md 7.1-7.3): a Table-kind sibling panel's ACTUAL rendered rows narrow (not just its disclosure), the breakpoint sweep (1440/1100/768/430) + light/dark toggle-without-navigating for `CrossFilterIndicator`, and a >200-row Table panel where the D7 truncation disclosure and the rendered grid now agree. Screenshots under `.concertino/runs/HEL-588/evidence/`.
- `openspec/changes/cross-filter-panels/tasks.md` — all tasks (1.1-7.3) marked complete.

## evaluation-1.md's own artifact

- `openspec/changes/cross-filter-panels/evaluation-1.md` — the cycle-1 evaluator's report (pre-existing, not authored by the executor; listed here only because `git diff` reports it as new relative to the base commit).

## Root cause / probe records (systematic-debugging law)

### CR1 — Table-kind sibling panel never narrowed in the live app

**Symptom (evaluation-1.md Phase 3):** a Table panel's D7 truncation disclosure correctly read "50 of 200 loaded rows match" while its rendered grid kept showing all unfiltered rows.

**Root cause:** `PanelCardBody` (`PanelCard.tsx`) read `state.panels.paginationState[panel.id]` via its own `useAppSelector`, independently of the cross-filtered `rawRows`/`headers` it also received as props, and forwarded the RAW `paginationEntry.rows` to `PanelContent`'s `paginationRows` prop. `TableRenderer.tsx` prefers `paginationRows` over `rawRows` whenever `paginationRows` is non-empty, which is essentially always (`usePanelData.ts` unconditionally fetches page 0 on mount).

**Probe:** read `PanelCardBody`'s `paginationRows={paginationEntry?.rows ?? null}` line and `TableRenderer`'s `usingPagination = Boolean(paginationRows && paginationRows.length > 0)` gate side by side; reproduced with a `PanelCard.crossFilter.test.tsx` regression test seeded with `paginationState[panelId]` populated (mirroring a real `fetchPanelPage(page: 0)` dispatch) — the test failed (`Q2` row visible) against the pre-fix code and passed after.

**Fix (first pass, later superseded by the architecture change below):** filter `paginationEntry.rows` in `PanelCardBody` too, via a new `filterRecordRowsByDimension` util. **Final fix:** moved the entire cross-filter application (`rawRows` AND `paginationRows`) into `OutputPanelContent`, which already resolves the `output` needed for kind-dispatch — see the next entry for why.

### A new race discovered during CR2's own live re-verification

**Symptom:** live-verified via Playwright (`page.evaluate` reading rendered `<td>` text immediately after `page.setViewportSize` at the 768px desktop-grid→mobile-stack breakpoint) — a Table-kind sibling panel's rows rendered fully UNFILTERED for a transient window right after the remount, self-correcting within ~300-500ms.

**Root cause:** the first-pass fix (above) applied cross-filtering in `PanelCard`/`MobileStackPanelBody`, which required `MobileStackPanelBody` to add a NEW `useOutputMeta(outputId)` call (mobile had no prior Output fetch) purely to resolve `output` for `useCrossFilteredPanelData`. This created a SECOND, independent fetch of the same Output racing against `OutputPanelContent`'s own pre-existing, independent `useOutputMeta` call — the two can resolve at different times, and until BOTH have resolved, the mobile-stack tree renders with `isCrossFiltered: false` (unfiltered) even though the dashboard's cross-filter is active and the indicator is already visible.

**Probe:** three isolated Playwright probes (not committed — throwaway diagnostics) confirmed the differentiating variable: (1) a 2-panel dashboard with cross-filter active + theme toggle rendered correctly; (2) the SAME 3-panel dashboard as the real spec, cross-filter active, checking `document.querySelectorAll('td')` immediately after `setViewportSize(768)` vs. after a 300ms wait, showed 4 (unfiltered) cells immediately and 2 (correctly filtered) cells after the wait — isolating the bug to a fetch-timing race tied specifically to the NEW mobile-stack `useOutputMeta` call this ticket introduced.

**Fix:** reverted `MobileStackPanelBody`'s new fetch entirely; moved cross-filter application into `OutputPanelContent` (used by both desktop and mobile, and already resolving `output` for kind-dispatch with no new fetch). Re-verified live: the exact 768px repro (`cr3-breakpoint-768-dark.png`, screenshotted immediately after `setViewportSize`, no wait) now shows the correctly-narrowed 2-row table.

### A separate, out-of-scope defect found (not fixed) — flagged as a follow-up

While live-verifying the light/dark theme toggle (evaluation-1.md CR3), a pie CHART panel's rendering broke (thin needle-like slices instead of a proper pie) specifically when: a dashboard has 3+ Output panels (one being a pie chart) AND the dashboard's cross-filter is active (so `CrossFilterIndicator` is mounted) AND the viewport is resized or the theme is toggled. Isolated via three additional throwaway probes:
- 2-panel dashboard + cross-filter + theme toggle: chart renders correctly.
- 3-panel dashboard + NO cross-filter (no indicator) + theme toggle: chart renders correctly.
- 3-panel dashboard + cross-filter (indicator mounted) + theme toggle: chart breaks.

This is a resize/redraw race in ECharts' own rendering (`ChartPanel.tsx`/`ChartRenderer.tsx`/echarts resize wiring) — code this ticket never touches. The `CrossFilterIndicator` merely happens to be the specific banner-mount trigger that exposes it (adding an element above the grid changes total page height, which can introduce/remove a scrollbar — a width-changing resize — at the same moment as a theme-driven series-color update). It does not affect the CORRECTNESS of anything HEL-588 owns (the filtered DATA is correct throughout; only the pie's own geometry glitches transiently), and reproducing it requires a specific combination this ticket's own spec never mandates. Recommending a follow-up ticket against chart-rendering/resize handling rather than fixing it here, given the risk of an unbounded, unrelated change to shared ECharts wiring under this ticket's own time box.

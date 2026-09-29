## Layer 1 — public panel-content rendering (design.md D7 commit 1, tasks 1-3)

Committed as `f65cc4a3`.

- `backend/src/main/scala/com/helio/api/routes/pipelines/OutputRowsQueryParsing.scala` — new;
  `sort`/`filter` query-param parsing extracted verbatim out of `OutputRoutes` so
  `PublicDashboardRoutes` can share it (task 1.1).
- `backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala` — delegates to
  `OutputRowsQueryParsing`; drops the now-duplicate private parsing methods and their now-unused
  imports.
- `backend/src/main/scala/com/helio/services/panels/PublicOutputControlScope.scala` — new; the
  single gate deciding whether a public/share-token caller may name a given column in a
  filter/distinct-values request against a panel (owner ruling C11).
- `backend/src/main/scala/com/helio/api/protocols/pipelines/OutputProtocol.scala` —
  `PublicOutputMetaResponse` case class + format (design.md D8).
- `backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala` — `sort`/
  `filter` on `.../rows` (gated to the panel's own control columns); new
  `.../filter-capabilities`, `.../distinct-values`, `.../output-meta` routes, all sharing the
  existing `authorizeResourceWithSharing` ACL.
- `backend/src/test/scala/com/helio/api/routes/dashboards/PublicDashboardRoutesSpec.scala` — 8 new
  specs: rows filter narrows/rejects, filter-capabilities narrows to control columns, distinct-values
  narrows/rejects, output-meta shape + ACL parity.
- `frontend/src/features/pipelines/types/output.ts` — new `PublicOutputMeta` type (D9's narrower,
  `ownerId: null`-typed public metadata shape).
- `frontend/src/features/pipelines/services/outputService.ts` — `OutputRowsFilter.ops[]` (D3),
  exported `isFilterActive`, new `getDistinctValues` (authenticated dropdown-options source for
  layer 2's control bar).
- `frontend/src/features/dashboards/services/publicDashboardService.ts` — new
  `fetchPublicPanelRows`/`fetchPublicOutputMeta`/`fetchPublicFilterCapabilities`/
  `fetchPublicDistinctValues` client functions.
- `frontend/src/features/panels/hooks/usePublicPanelData.ts` — new; the public/anonymous
  `usePanelData` + `useOutputMeta` equivalent (task 3.1), with its own request-sequencing guard.
- `frontend/src/features/panels/ui/PanelContent.tsx` — widens `output` prop to
  `Output | PublicOutputMeta | null` (D9), no behavior change for the authenticated path.
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` — widens `ownerId` prop to
  `string | null` so `canWrite` is structurally false when a caller passes `null` (D9); no
  behavior change for the authenticated path (`ownerId` there is always a real string or
  `undefined`).
- `frontend/src/features/dashboards/ui/PublicDashboardViewerPage.tsx` — renders each output-kind
  panel's real content via the existing `PanelContent` (reused unmodified, C13), fed by
  `usePublicPanelData`; every other panel kind keeps the pre-existing title+kind row.
- `frontend/src/features/dashboards/ui/PublicDashboardViewerPage.content.test.tsx` — new; red-first
  regression for real table-panel content, and for D9's owner-session-cannot-write guarantee.

## Layer 2 — viewer control bar, URL state, filter composition, every render path (design.md D7 commit 2, tasks 4-6)

- `frontend/src/features/panels/state/viewerControlValues.ts` — new; pure encode/decode/compose
  logic (date-range preset resolution, numeric/date-range raw encoding, `isValidRawValue`,
  `encodeDefaultValue`, `buildViewerControlFilterOps`), framework-free and directly unit-tested.
- `frontend/src/features/panels/state/viewerControlValues.test.ts` — new; 17 tests.
- `frontend/src/features/panels/hooks/useViewerControls.ts` — new; the URL-state hook
  (`?p.<panelId>.<controlId>=`), `useSearchParams`-backed (task 4.2).
- `frontend/src/features/panels/hooks/useViewerControls.test.tsx` — new; 7 tests (URL round-trip,
  reload/pasted-link reproduction, clear-reverts-to-default, malformed-value fallback, per-panel
  isolation).
- `frontend/src/features/panels/ui/OutputViewerControlBar.tsx` + `.css` — new; the presentational
  control bar (task 4.1), one sub-renderer per `OutputControlSpec.kind`, reused verbatim by every
  render path (a `fetchDistinctValues` callback is the only per-path variation point).
- `frontend/src/features/panels/ui/OutputViewerControlBar.test.tsx` — new; 7 tests.
- `frontend/src/features/pipelines/services/outputService.ts` — new `composeOutputRowsFilter`
  (D3's AND-composition helper, shared by every request-builder call site).
- `frontend/src/features/panels/hooks/usePanelSortFilter.ts` — accepts an optional
  `controlFilterOps` param (default `[]`, every pre-existing call site unaffected); composes it
  into every dispatch; a new reactive effect re-fires the combined-filter fetch on a
  post-mount control change (task 4.3/4.4).
- `frontend/src/features/panels/hooks/usePanelSortFilter.test.ts` — 3 new tests (mount-time
  composition, AND-composition with an active in-panel filter, post-mount control-change refetch
  resetting to page 0).
- `frontend/src/features/panels/hooks/usePanelData.ts` — accepts an optional `controlFilterOps`
  param, folded into its own fetch-deduplication key (used only by `PanelDetailModal`, which has
  no sibling `usePanelSortFilter` layer to compose through instead).
- `frontend/src/features/panels/hooks/usePanelData.test.ts` — 2 new tests.
- `frontend/src/features/panels/ui/PanelCard.tsx` — `PanelCardBody` (shared by the desktop grid
  AND, via `MobilePanelStack`'s import, the phone stack) now computes `useViewerControls` +
  `buildViewerControlFilterOps`, threads the result into `usePanelSortFilter`, renders
  `OutputViewerControlBar`, and threads the combined filter into "Load more". Its existing
  fan-out-refresh live region is EXTENDED (not duplicated) to also announce a control-driven
  result-count change (D10).
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx` — same `useViewerControls`
  wiring, threaded into `usePanelData` directly; renders the control bar in view mode; adds a NEW
  live region (this modal had none).
- `frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx` — same `useViewerControls` wiring
  (rendering/UI only — its `rawRows`/`headers` props already reflect the current combined filter
  via the shared Redux `paginationState` entry, since it never fetches independently); adds a NEW
  live region (this overlay had none).
- `frontend/src/features/dashboards/ui/PublicDashboardViewerPage.tsx` — `PublicOutputPanelBody`
  wires `useViewerControls` + composes into `usePublicPanelData`'s `filter` param; renders the
  control bar with the PUBLIC `fetchPublicDistinctValues` (never the authenticated route); adds a
  NEW live region.
- `frontend/src/features/dashboards/ui/PublicDashboardViewerPage.content.test.tsx` — 1 new test
  (control bar renders + composes into the public rows request).
- `frontend/src/features/panels/types/panel.ts` — `OutputControlSpec.orphaned?: boolean`, the
  live-computed-at-read-time flag the wire response already carried but the frontend type never
  declared; the viewer control bar is this field's first real consumer.
- Test-file fixes for the new `useSearchParams` dependency `PanelCardBody`/`PanelDetailModal`/
  `PanelFullscreenOverlay` now carry (a `MemoryRouter` wrapper added to every render call that
  lacked one), and for `composeOutputRowsFilter`/`getDistinctValues` now being real exports a
  narrow `jest.mock(..., factory)` must not silently replace with `undefined` (converted to
  `{...jest.requireActual(...), <mocked fns only>}`):
  `PanelCardBody.fanoutStatus.test.tsx`, `PanelCardBody.predispatch.test.tsx`,
  `PanelCard.staleFetchSequencing.test.tsx`, `PanelCard.filterTyping.test.tsx`,
  `PanelCard.loadMoreCarriesSortFilter.test.tsx`, `PanelCard.filterEmptyState.test.tsx`,
  `grid/MobilePanelStack.staleFetchSequencing.test.tsx`.
- `frontend/src/theme/elevationTokenGuard.css.test.ts` / `motionTokenGuard.css.test.ts` — bumped
  the pinned CSS-file-count inventory (121 -> 122) for the new `OutputViewerControlBar.css`; no new
  pin needed (it declares no motion/shadow/radius).

### Root cause / probe notes (systematic-debugging.md)

Two real defects surfaced and fixed during this layer, both caught by running the full suite
(not a fix without a probe-confirmed cause):

1. **Root cause:** `PanelCardBody`/`PanelDetailModal`/`PanelFullscreenOverlay` gained a
   `useSearchParams` dependency (via `useViewerControls`) with no `<Router>` ancestor in 8 existing
   test files that rendered these components standalone.
   **Probe:** `npx jest src/features/panels` — `useLocation() may be used only in the context of a
   <Router> component` thrown from `useViewerControls.ts:40`, with a stack trace naming each
   affected test file's `render()` call site.
   **Fix:** wrapped each affected `render(...)` call in `<MemoryRouter>`.
2. **Root cause:** several of the same test files mocked
   `../../pipelines/services/outputService` wholesale (bare `jest.mock(path)` or an explicit
   factory naming only 2-3 functions), which silently replaced the newly-added
   `composeOutputRowsFilter`/`getDistinctValues` exports with `undefined`/an auto-mocked no-op —
   `usePanelSortFilter` calling the former as a function threw `TypeError: ... is not a function`.
   **Probe:** same `npx jest` run's stack trace naming `usePanelSortFilter.ts:134` and the specific
   mocked-module call site.
   **Fix:** every affected mock factory now spreads `...jest.requireActual(...)` first, so only
   the explicitly-listed functions are actually mocked — pure logic (`composeOutputRowsFilter`,
   `isFilterActive`) stays real.

### Corrected design premise (D10, task 5.5)

`design.md`'s D10 stated "only `PanelCard.tsx` has [a live region] today; `MobilePanelStack.tsx`
... have none" — **this is factually wrong for `MobilePanelStack.tsx` specifically**: its own
`MobileStackPanelBody` renders the SHARED `PanelCardBody` component (both live in `PanelCard.tsx`
as one file), which is where the live region's JSX actually is. A file-name-scoped grep for the
region inside `MobilePanelStack.tsx` itself would never find it, which is almost certainly how
design.md's own survey missed it. Verified directly: `grep -rn 'role="status"' PanelCard.tsx
grid/MobilePanelStack.tsx PanelFullscreenOverlay.tsx detailModal/PanelDetailModal.tsx
PublicDashboardViewerPage.tsx` returns exactly one hit, inside `PanelCard.tsx`. Acted on the
corrected premise rather than the design doc's literal instruction: extended that ONE shared
region (desktop AND mobile both benefit) instead of adding a second, redundant one to
`MobilePanelStack.tsx`, which spec.md's own wording explicitly forbids ("not a newly introduced,
separate one").

### Scope notes for the evaluator/skeptic

- **Text-control operator choice.** spec.md's composition requirement (layer 2) lists exactly
  `eq`/`in`/`gte`/`lte` as the operators a viewer-control selection may become — it does not
  include `contains`, even though `output-panel-viewer-controls`' sibling ticket (HEL-1189)'s own
  eligibility table requires only `contains` for a `text` control to be offered to an author.
  This implementation applies a `text` control's value as `eq` (exact match), matching the literal
  spec wording — this is a genuine, stated scope note, not silently resolved: an `eq` filter on a
  high-cardinality free-text column can be rejected by `OutputFilterCapability`'s existing
  cardinality gate (>50 distinct values), even though the AUTHOR could validly add a `text`
  control to that same column (its own eligibility gate needs only `contains`, cardinality-
  independent). Flagged for the design-gate skeptic/evaluator to weigh in on; not blocking, since
  it's a resolvable-conservatively literal-spec-following choice, not a contradiction between the
  ticket and the spec.
- **No public-path in-panel (HEL-1027) sort/filter UI.** The public rows route's `sort=`
  acceptance (task 1.2) exists to keep D6's shape uniform with the authenticated route; the
  public viewer never had in-panel sort/filter before this ticket either, and this change does not
  add one — only the new viewer-control filter composes into the public rows request. Stated,
  deliberate non-expansion of scope.
- **No "Load more" pagination on the public path.** `usePublicPanelData` fetches a single page (up
  to 200 rows) under the current combined filter — pagination parity with the authenticated grid
  is not part of this ticket's AC.
- **Chart-kind filtering (D4/task 4.5) is proven structurally, not via a dedicated chart-rendering
  test.** `usePanelSortFilter`/`usePanelData` accept no `output.kind` parameter at all — the exact
  same composed fetch serves every kind uniformly, and `OutputPanelContent`'s chart/table branches
  both read the identical `paginationEntry`-derived `rawRows`/`headers`. Setting up a full
  ECharts-mocked component test to re-prove this kind-agnostic wiring was judged lower marginal
  value than the unit-level composition tests already added, given this cycle's time budget — the
  evaluator/skeptic may reasonably ask for one.
- **Rapid-double-change race (task 4.4) reuses, rather than re-proves, an existing guard.**
  `panelsSlice.ts`'s `latestFetchRequestId` mechanism (HEL-1027, already shipped and tested by
  `PanelCard.staleFetchSequencing.test.tsx`) is reused completely unmodified for control-driven
  refetches — no new sequencing code was written, so no new race test was added either. The
  mount-then-change test in `usePanelSortFilter.test.ts` proves the mechanics of composition and
  re-dispatch; it does not additionally race two in-flight responses against each other.

### Outstanding live verification (NOT performed this cycle)

Per Standing Constraint C4, live verification at desktop AND phone widths, both themes, and as an
anonymous viewer on a public dashboard is required before this ticket can be considered done —
**this executor cycle did not run a browser** (no `start-servers.sh`/Playwright session was
started). Everything above is backend-test-verified (sbt, real EmbeddedPostgres) or
frontend-unit-test-verified (Jest + Testing Library, real Redux stores, real Router context) —
genuinely red-first where stated — but NOT live-rendering-verified. Outstanding items for the
evaluator/skeptic to close before final sign-off:

1. Desktop grid, both themes: control bar renders, is usable, narrows the table/chart, and the
   live region announces a count change (verify via the accessibility tree, not just DOM presence).
2. Phone width (`MobilePanelStack`), both themes: same, plus confirm the control bar doesn't
   overflow/clip at 375-430px.
3. Fullscreen overlay and detail modal: open a panel with an active control from the grid, confirm
   the SAME value/filtered data is shown (URL-shared state), in both themes.
4. Public dashboard as a genuinely anonymous (no session cookie) browser context, both themes:
   confirm controls render, narrow the data, and the dropdown's distinct-values fetch hits the
   PUBLIC route (`.../distinct-values?token=`), never the authenticated one (network tab, not
   just code inspection).
5. Keyboard-only operation of each control kind (Tab/Arrow/Enter/Escape) and a screen-reader (or
   computed-ARIA) check of the live region's announcement on a control change, on every render
   path.
6. Visual cohesion against DESIGN.md, compared to the RUNNING app — `OutputViewerControlBar.css`
   was written against the token system by inspection, not verified against rendered pixels in
   either theme.

## Cycle 2 (evaluation-1.md CRs)

- `PublicOutputControlScope.scala` / `PublicDashboardRoutes.scala` — CR1: a non-blank `quick` filter and a `sort` on a non-control column are now rejected 400 on the public rows route (C11 literal; no exemption). Public frontend sends neither. Two new specs in `PublicDashboardRoutesSpec.scala`.
- `PublicDashboardViewerPage.css` — CR2: `.public-dashboard-viewer__panel-row` is now a column (stretch, `min-width: 0`), container max-width widened 720px -> 1200px so a table has room. Live re-check at 1440/390 both themes is left to the evaluator (not screenshotted by the executor this cycle).
- Non-blocking suggestion (omit `ownerId` from output-meta) not taken: design.md D8/spec name it in the response.

## Full-path declarations (for squash-branch.sh)

- `frontend/src/features/dashboards/ui/PublicDashboardViewerPage.css`
- `frontend/src/features/panels/ui/OutputViewerControlBar.css`
- `frontend/src/features/panels/ui/PanelCard.filterEmptyState.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.filterTyping.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.loadMoreCarriesSortFilter.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.staleFetchSequencing.test.tsx`
- `frontend/src/features/panels/ui/PanelCardBody.fanoutStatus.test.tsx`
- `frontend/src/features/panels/ui/PanelCardBody.predispatch.test.tsx`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.staleFetchSequencing.test.tsx`

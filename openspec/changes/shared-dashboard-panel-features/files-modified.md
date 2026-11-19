# HEL-1780 files modified

## Deviations and honesty notes (read first)

- **C8 red-first was NOT followed for the implementation.** The previous executor (killed mid-run) wrote the frontend implementation
  and the D1 fixture migration before recording any red run. This executor did not hide that: the e2e was written afterwards and
  given a genuine red run on BASE behaviour (`git checkout 62df9ff48 -- frontend/src`, full new spec, restored, tree clean):
  `.concertino/scratch/HEL-1780/e2e-red-base.txt` (copy `e2e-red-base.txt` in this directory): 4 of 5 tests red at the first
  feature assertion, "Team" control combobox not found (feature hidden, the right reason); the 5th (switch step) passes on base,
  which is expected (base routed by role of the selected dashboard, which the switch exercises correctly) so m7's red proof is jest.
  The new jest suites (`TableRenderer.panelScope`, `usePanelSortFilter.panelScope`, `PanelCard.panelScopeRefresh`,
  `filterCapabilitiesStore.panel`, `panelThunks.crossFilterKey`, `publicDashboardService.grantee`) were also written after the
  implementation; their red proof is the mutations below, each red at its own assertion (never "module not found").
- **D1 fixture migration used a shim, not per-file `seedOwnedDashboard` calls.** Owner-path tests got the owned dashboard through
  (a) `test/configureOwnedStore.ts` (a drop-in `configureStore` that adds the `dashboards` slice with a hard-coded id list owned),
  (b) `ownDashboardsInThisFile(...)` (file-scoped declaration read by `renderWithStore`), (c) explicit `seedOwnedDashboard` calls.
  `renderWithStore` does not seed on its own; a file that declares nothing stays fail-closed. Diffs in migrated tests are seeding
  only (import swap / declaration / seed call); one dead `dashboardsReducer` import was removed in 19 files after lint flagged it.
  The `configureStore` shim's hard-coded ids ("dash-1", "dashboard-1", "d1", "dash-a", "a") are a test-only convenience and a
  slightly weaker form of the design's "explicit seeding per file". Reported rather than reworked.
- `dashboardAccess.ts` (HEL-1773) treats a dashboard item with NEITHER `accessRole` NOR `ownerId` as owner (hand-built fixtures
  only; never off the wire). Left as is.
- MobilePanelStack has no per-card header Refresh button (only pull-to-refresh), so the design's D7 `MobilePanelStack` Refresh
  case has nothing to hide; `PanelCard` is covered (jest + e2e). Provenance beside the title is covered (`PanelProvenance`).
- Insight card footer "Updated <date>": not shown in panel scope (`insightChromeStore` is owner-fed); the body shows no render time
  today (the public insight body renders none); no new copy added.
- D4 client part: `useTableRows` keeps the table's own filter state (always applied client side, idempotent over server-filtered
  rows) and uses `clientOps` for the sort bypass and the disclosure (same observable behaviour as design D4(a)-(c)).
- DB: lane DB `helio_hel1780` (empty at start; Flyway ran on first backend start). `DATABASE_URL` was set explicitly in the shell
  to `jdbc:postgresql://localhost:5432/helio_hel1780` and `DB_USER=matt` (local trust auth over TCP, verified with psql `select
  current_user` against the lane DB only); no .env file was read at any point. `ANTHROPIC_API_KEY=` empty for every backend.
- sbt: `testFull` takes no class argument; the spec was run with `sbt -J-Xmx3g "testOnly com.helio.api.routes.dashboards.DashboardGranteePanelRoutesSpec"`.
  The whole `testFull` was not run (backend production code is unchanged; only one new spec file).

## Cycle 2 (evaluation-1.md change requests)

- CR1: `hooks/useCrossFilterServerOps.panelScope.test.tsx` -- two panels on ONE Output (controls `team` / `region`), shared dashboard
  as viewer; asserts per-panel `fetchPublicFilterCapabilities(dashboardId, panelId)` once per panel with no token, A `server`, B
  `client-fallback`, `getFilterCapabilities` never called. Red with `const key = outputId;` in `useOutputFilterCapabilities.ts`:
  `mutations/jest-d5-hook-key.txt` (the diff is at the top of the transcript).
- CR2: e2e step 3b (Filters toggle): quick "East" (disclosure, no West cells), no-match term ("No loaded rows match..."), non-control
  `amount` filter, each asserting zero new per-panel rows requests. Red with `quick` sent to the server in `splitForPanelScope.ts`:
  `mutations/e2e-quick-to-server.txt` (fails at "a client-side filter sends no request", 7 vs 8 requests).
- Evidence hygiene: zero-test `jest-m9.txt` deleted; every mutation transcript (`mutations/*.txt`) now starts with the applied
  `git diff`; m6 and m9 now fail on explicit assertions (provenance button visible; "per-panel distinct-values route answered 200").
  m9 now mutates `distinctValuesFetcher` (the fork moved there).
- D1 shim: the hard-coded `OWNED_BY_DEFAULT` list is gone. `configureStoreOwning(...ids)` in `test/configureOwnedStore.ts`; each of
  the 19 files states its own ids. `renderWithStore` seeds declared dashboards with explicit `accessRole: "owner"`.
- DRY: `distinctValuesFetcher(scope, panelId, outputId)` in `state/panelReadScope.ts` replaces the fork in `PanelCardBody`,
  `PanelFullscreenOverlay`, `usePanelDetailData`. Dead `filterOutput` alias removed. `splitForPanelScope` clash guard (cross-filter
  `eq` never joins a control `eq` on the same column) added with a comment.
- Gates after cycle 2: lint 0 errors, format:check ok, typecheck ok, build exit 0, jest 858 suites / 10169 tests passed
  (`jest-full-cycle2.txt`), e2e hel1780+hel1773 13 passed (`e2e-green-cycle2.txt`), backend spec re-run after the import move
  5 passed (`backend-spec-cycle2.txt`).

## Evidence (all under `.concertino/scratch/HEL-1780/`)

- red on base: `e2e-red-base.txt`; green: `e2e-green-final.txt` (hel1780 5 tests + hel1773 8 tests = 13 passed), `e2e-1773.txt`
- backend spec: `backend-spec-2.txt` (5 passed); RLS transcript `rls-helio-app.txt` (also persisted as `rls-helio-app.txt` in this change dir)
- jest: `jest-full-final.txt` (857 suites, 10168 tests passed); lint, format:check, typecheck, `npm --prefix frontend run build` all exit 0
- mutations (`mutations/`), each applied to the committed tree, run, then `git checkout -- frontend/src`:
  - m1 controls re-zeroed for non-owners: e2e red at the "Team" control visible assertion (`e2e-m1.txt`)
  - m2 split sends non-control sort to the server: e2e red at the sort disclosure assertion (`e2e-m2.txt`); jest red `jest-m2.txt` (splitForPanelScope "keeps a non-control sort in the browser", nonOwner rows request)
  - m3 cross-filter forced server for a non-control dimension: e2e red at "other region cells count 0" (`e2e-m3.txt`)
  - m4 history source omitted for the metric in panel scope: e2e red at the C11 invariant (request to /api/outputs/ because dev is BYPASSRLS, the sparkline still renders through the wrong route) (`e2e-m4.txt`)
  - m5 insight placeholder restored: e2e red at the insight body assertion (`e2e-m5.txt`)
  - m6 provenance hidden: e2e red at the provenance click (`e2e-m6.txt`)
  - m7 role read from the selected dashboard: e2e switch step cannot show it red; jest red (`jest-m7.txt`: usePanelReadScope "follows the panel's own dashboard", "the reverse", fetchPanelPage "the role of the PANEL's dashboard decides")
  - m8 insight Refresh shown for non-owners: e2e red at "Refresh <insight> count 0" (`e2e-m8.txt`) and jest red `jest-m8.txt`
  - m9 grantee distinct values routed through the Output route: e2e red, the per-panel distinct-values request never happens (`e2e-m9.txt`)
  - m10 D4(e) always dispatch: jest red x3 (`mut-m10.txt`, i/ii/iii)
  - extra: D5 per-panel capabilities key mutated to the Output key: jest red (`jest-d5-key.txt`)

## Skipped / not done

- Task 3.7 (update hel1773 hidden-feature assertions): none exist in `e2e/hel1773-viewer-grantee-dashboard.spec.ts`; it passes unchanged (8/8).
- C10 grep of `e2e/` for altered strings ("Not available on shared dashboards yet", "No rows match your filter", "loaded rows of",
  "Refresh ${title}", "Sorted within", "Filtered within", "No loaded rows"): zero hits outside the new hel1780 spec.
- No backend production change, no migration, no new route. HEL-1776 files untouched (`ProvenanceTrigger.tsx` is a one-line `token ?? ""` removal).

## D1 production mounts

Every production mount of PanelCard / PanelCardBody / MobilePanelStack / PanelFullscreenOverlay / PanelDetailModal / OutputPanelContent
descends from `PanelGrid`, whose only production mount is `PanelList` (routes `/dashboards` and `/dashboards/:id` via `DashboardRoute`).
`PanelList` renders the panels of `selectedDashboardId` out of `state.dashboards.items`, so each panel's dashboard is in the store
(owner -> `output` scope, any other role -> `panel` scope). `PublicDashboardViewerPage` mounts `PanelContent` directly with its own token source (unchanged).
Output-keyed seams: `outputMetaCache.panelScopes` left as HEL-1773 shipped; `filterCapabilitiesStore` changed (per-panel key, D5);
`insightChromeStore` left owner-only; provenance/history caches already keyed per (dashboardId, panelId).

## Production source

- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardGranteePanelRoutesSpec.scala`
- `e2e/hel1780-shared-dashboard-panel-features.spec.ts`
- `frontend/src/features/dashboards/services/publicDashboardService.ts`
- `frontend/src/features/dashboards/state/dashboardAccessContext.tsx`
- `frontend/src/features/panels/history/outputHistoryService.ts`
- `frontend/src/features/panels/history/useOutputHistory.ts`
- `frontend/src/features/panels/hooks/useCrossFilterServerOps.ts`
- `frontend/src/features/panels/hooks/useOutputFilterCapabilities.ts`
- `frontend/src/features/panels/hooks/usePanelCardInspect.ts`
- `frontend/src/features/panels/hooks/usePanelData.ts`
- `frontend/src/features/panels/hooks/usePanelSortFilter.ts`
- `frontend/src/features/panels/insight/CitationChip.tsx`
- `frontend/src/features/panels/insight/InsightPanelBody.tsx`
- `frontend/src/features/panels/insight/insightService.ts`
- `frontend/src/features/panels/insight/useInsight.ts`
- `frontend/src/features/panels/provenance/PanelProvenance.tsx`
- `frontend/src/features/panels/provenance/ProvenanceTrigger.tsx`
- `frontend/src/features/panels/provenance/provenanceService.ts`
- `frontend/src/features/panels/state/filterCapabilitiesStore.ts`
- `frontend/src/features/panels/state/panelControlColumns.ts`
- `frontend/src/features/panels/state/panelReadScope.ts`
- `frontend/src/features/panels/state/panelThunks.ts`
- `frontend/src/features/panels/state/panelsSlice.ts`
- `frontend/src/features/panels/state/splitForPanelScope.ts`
- `frontend/src/features/panels/ui/OutputPanelContent.tsx`
- `frontend/src/features/panels/ui/PanelCard.tsx`
- `frontend/src/features/panels/ui/PanelCardBody.tsx`
- `frontend/src/features/panels/ui/PanelContent.tsx`
- `frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx`
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx`
- `frontend/src/features/panels/ui/detailModal/usePanelDetailData.ts`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.tsx`
- `frontend/src/features/panels/ui/renderers/LoadedScopeDisclosure.tsx`
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx`
- `frontend/src/features/panels/ui/renderers/tableRendererProps.ts`
- `frontend/src/features/panels/ui/renderers/useTableRows.ts`
- `frontend/src/test/configureOwnedStore.ts`
- `frontend/src/test/renderWithStore.tsx`
- `frontend/src/test/seedOwnedDashboard.ts`

## D1 planned fixture migration (seeding only) and new/changed tests

  - `frontend/src/features/panels/hooks/usePanelCardInspect.test.tsx`
  - `frontend/src/features/panels/hooks/usePanelData.crossFilter.test.tsx`
  - `frontend/src/features/panels/hooks/usePanelData.insight.test.tsx`
  - `frontend/src/features/panels/hooks/usePanelData.queueRefresh.test.tsx`
  - `frontend/src/features/panels/hooks/usePanelData.remountReuse.test.tsx`
  - `frontend/src/features/panels/hooks/usePanelData.test.ts`
  - `frontend/src/features/panels/hooks/usePanelSortFilter.test.ts`
  - `frontend/src/features/panels/state/columnOrder.test.ts`
  - `frontend/src/features/panels/state/panelThunks.fetchPanelPage.crossFilter.test.ts`
  - `frontend/src/features/panels/state/panelThunks.generationStamp.test.ts`
  - `frontend/src/features/panels/state/panelsSlice.reuseFields.test.ts`
  - `frontend/src/features/panels/state/panelsSlice.test.ts`
  - `frontend/src/features/panels/state/panelsSlice.warm.test.ts`
  - `frontend/src/features/panels/ui/PanelCard.aggregateChart.test.tsx`
  - `frontend/src/features/panels/ui/PanelCard.aggregatePieChart.test.tsx`
  - `frontend/src/features/panels/ui/PanelCard.crossFilter.test.tsx`
  - `frontend/src/features/panels/ui/PanelCard.crossFilterServer.test.tsx`
  - `frontend/src/features/panels/ui/PanelCard.filterEmptyState.test.tsx`
  - `frontend/src/features/panels/ui/PanelCard.filterTyping.test.tsx`
  - `frontend/src/features/panels/ui/PanelCard.filteredMetric.test.tsx`
  - `frontend/src/features/panels/ui/PanelCard.inspect.test.tsx`
  - `frontend/src/features/panels/ui/PanelCard.loadMoreCarriesSortFilter.test.tsx`
  - `frontend/src/features/panels/ui/PanelCard.provenance.test.tsx`
  - `frontend/src/features/panels/ui/PanelCard.staleFetchSequencing.test.tsx`
  - `frontend/src/features/panels/ui/PanelCardBody.fanoutStatus.test.tsx`
  - `frontend/src/features/panels/ui/PanelCardBody.mountRenders.test.tsx`
  - `frontend/src/features/panels/ui/PanelCardBody.predispatch.test.tsx`
  - `frontend/src/features/panels/ui/PanelCardBody.test.tsx`
  - `frontend/src/features/panels/ui/PanelCardHeader.refreshFullscreen.test.tsx`
  - `frontend/src/features/panels/ui/PanelCardHeader.test.tsx`
  - `frontend/src/features/panels/ui/PanelContent.columnOrder.test.tsx`
  - `frontend/src/features/panels/ui/PanelFullscreenOverlay.provenance.test.tsx`
  - `frontend/src/features/panels/ui/detailModal/PanelDetailModal.crossFilter.test.tsx`
  - `frontend/src/features/panels/ui/detailModal/PanelDetailModal.errorRetry.test.tsx`
  - `frontend/src/features/panels/ui/detailModal/PanelDetailModal.provenance.test.tsx`
  - `frontend/src/features/panels/ui/detailModal/PanelDetailModal.test.tsx`
  - `frontend/src/features/panels/ui/grid/MobilePanelStack.crossFilter.test.tsx`
  - `frontend/src/features/panels/ui/grid/MobilePanelStack.detailOrigin.test.tsx`
  - `frontend/src/features/panels/ui/grid/MobilePanelStack.provenance.test.tsx`
  - `frontend/src/features/panels/ui/grid/MobilePanelStack.remountReuse.test.tsx`
  - `frontend/src/features/panels/ui/grid/MobilePanelStack.sortFailure.test.tsx`
  - `frontend/src/features/panels/ui/grid/MobilePanelStack.staleFetchSequencing.test.tsx`
  - `frontend/src/features/panels/ui/grid/PanelGrid.remountReuse.test.tsx`

New suites: TableRenderer.panelScope, usePanelSortFilter.panelScope, PanelCard.panelScopeRefresh, filterCapabilitiesStore.panel, panelThunks.crossFilterKey, publicDashboardService.grantee, splitForPanelScope, panelReadScope; reworked: *.roles.test.tsx, panelThunks.nonOwner.test.ts (HEL-1773 hidden-feature assertions updated to the new behaviour).

## Complete touched-file declaration (diff vs merge-base 27b4a7402, added by the orchestrator at Delivery for squash-branch.sh)

- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardGranteePanelRoutesSpec.scala`
- `e2e/hel1780-shared-dashboard-panel-features.spec.ts`
- `frontend/src/features/dashboards/services/publicDashboardService.grantee.test.ts`
- `frontend/src/features/dashboards/services/publicDashboardService.ts`
- `frontend/src/features/dashboards/state/dashboardAccessContext.tsx`
- `frontend/src/features/panels/history/outputHistoryService.ts`
- `frontend/src/features/panels/history/useOutputHistory.roles.test.tsx`
- `frontend/src/features/panels/history/useOutputHistory.ts`
- `frontend/src/features/panels/hooks/useCrossFilterServerOps.panelScope.test.tsx`
- `frontend/src/features/panels/hooks/useCrossFilterServerOps.ts`
- `frontend/src/features/panels/hooks/useOutputFilterCapabilities.ts`
- `frontend/src/features/panels/hooks/usePanelCardInspect.test.tsx`
- `frontend/src/features/panels/hooks/usePanelCardInspect.ts`
- `frontend/src/features/panels/hooks/usePanelData.crossFilter.test.tsx`
- `frontend/src/features/panels/hooks/usePanelData.insight.test.tsx`
- `frontend/src/features/panels/hooks/usePanelData.queueRefresh.test.tsx`
- `frontend/src/features/panels/hooks/usePanelData.remountReuse.test.tsx`
- `frontend/src/features/panels/hooks/usePanelData.test.ts`
- `frontend/src/features/panels/hooks/usePanelData.ts`
- `frontend/src/features/panels/hooks/usePanelSortFilter.panelScope.test.ts`
- `frontend/src/features/panels/hooks/usePanelSortFilter.test.ts`
- `frontend/src/features/panels/hooks/usePanelSortFilter.ts`
- `frontend/src/features/panels/insight/CitationChip.tsx`
- `frontend/src/features/panels/insight/InsightPanelBody.roles.test.tsx`
- `frontend/src/features/panels/insight/InsightPanelBody.tsx`
- `frontend/src/features/panels/insight/insightService.ts`
- `frontend/src/features/panels/insight/useInsight.ts`
- `frontend/src/features/panels/provenance/PanelProvenance.tsx`
- `frontend/src/features/panels/provenance/ProvenanceTrigger.tsx`
- `frontend/src/features/panels/provenance/provenanceService.ts`
- `frontend/src/features/panels/state/columnOrder.test.ts`
- `frontend/src/features/panels/state/filterCapabilitiesStore.panel.test.ts`
- `frontend/src/features/panels/state/filterCapabilitiesStore.ts`
- `frontend/src/features/panels/state/panelControlColumns.ts`
- `frontend/src/features/panels/state/panelReadScope.test.tsx`
- `frontend/src/features/panels/state/panelReadScope.ts`
- `frontend/src/features/panels/state/panelThunks.crossFilterKey.test.ts`
- `frontend/src/features/panels/state/panelThunks.fetchPanelPage.crossFilter.test.ts`
- `frontend/src/features/panels/state/panelThunks.generationStamp.test.ts`
- `frontend/src/features/panels/state/panelThunks.nonOwner.test.ts`
- `frontend/src/features/panels/state/panelThunks.ts`
- `frontend/src/features/panels/state/panelsSlice.reuseFields.test.ts`
- `frontend/src/features/panels/state/panelsSlice.test.ts`
- `frontend/src/features/panels/state/panelsSlice.ts`
- `frontend/src/features/panels/state/panelsSlice.warm.test.ts`
- `frontend/src/features/panels/state/splitForPanelScope.test.ts`
- `frontend/src/features/panels/state/splitForPanelScope.ts`
- `frontend/src/features/panels/ui/OutputPanelContent.tsx`
- `frontend/src/features/panels/ui/PanelCard.aggregateChart.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.aggregatePieChart.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.crossFilter.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.crossFilterServer.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.filterEmptyState.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.filterTyping.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.filteredMetric.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.inspect.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.loadMoreCarriesSortFilter.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.panelScopeRefresh.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.provenance.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.staleFetchSequencing.test.tsx`
- `frontend/src/features/panels/ui/PanelCard.tsx`
- `frontend/src/features/panels/ui/PanelCardBody.fanoutStatus.test.tsx`
- `frontend/src/features/panels/ui/PanelCardBody.mountRenders.test.tsx`
- `frontend/src/features/panels/ui/PanelCardBody.predispatch.test.tsx`
- `frontend/src/features/panels/ui/PanelCardBody.roles.test.tsx`
- `frontend/src/features/panels/ui/PanelCardBody.test.tsx`
- `frontend/src/features/panels/ui/PanelCardBody.tsx`
- `frontend/src/features/panels/ui/PanelCardHeader.refreshFullscreen.test.tsx`
- `frontend/src/features/panels/ui/PanelCardHeader.test.tsx`
- `frontend/src/features/panels/ui/PanelContent.columnOrder.test.tsx`
- `frontend/src/features/panels/ui/PanelContent.tsx`
- `frontend/src/features/panels/ui/PanelFullscreenOverlay.provenance.test.tsx`
- `frontend/src/features/panels/ui/PanelFullscreenOverlay.tsx`
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.crossFilter.test.tsx`
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.errorRetry.test.tsx`
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.provenance.test.tsx`
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.roles.test.tsx`
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.test.tsx`
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx`
- `frontend/src/features/panels/ui/detailModal/usePanelDetailData.ts`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.crossFilter.test.tsx`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.detailOrigin.test.tsx`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.provenance.test.tsx`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.remountReuse.test.tsx`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.sortFailure.test.tsx`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.staleFetchSequencing.test.tsx`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.tsx`
- `frontend/src/features/panels/ui/grid/PanelGrid.remountReuse.test.tsx`
- `frontend/src/features/panels/ui/renderers/LoadedScopeDisclosure.tsx`
- `frontend/src/features/panels/ui/renderers/TableRenderer.panelScope.test.tsx`
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx`
- `frontend/src/features/panels/ui/renderers/tableRendererProps.ts`
- `frontend/src/features/panels/ui/renderers/useTableRows.ts`
- `frontend/src/test/configureOwnedStore.ts`
- `frontend/src/test/renderWithStore.tsx`
- `frontend/src/test/seedOwnedDashboard.ts`

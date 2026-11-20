# HEL-1783 files modified

Base dfb65eebb (rebased from d8cdfb460). Commits (post-rebase hashes, `git log` for the final): 0dce5f73b (red, `--no-verify` on purpose, transcripts in `evidence/`), 6c2430414 (implementation), 1d44d9e24 (card-test fidelity), f8d3da4ee (docs); cycle 2: d054ec831 (red CR1 cases, `--no-verify`), c83425103 (CR1-CR3 fix + nits), then the docs commit. Lane DB: `createdb helio_hel1783`, `DATABASE_URL=jdbc:postgresql://localhost:5432/helio_hel1783`,
`DB_USER=matt`, empty `DB_PASSWORD`, `ANTHROPIC_API_KEY` empty (dropped at the end). No .env file read. No migration. No dashboardsSlice change; no HEL-1784/1778/1782/1775 file touched.

## Backend
- `backend/.../dashboards/DashboardChangesRepository.scala` — content query in user context, data query in `withSystemContext` for the readable ids only, `AND p.kind = 'output'`; class doc + inline bypass justification.
- `backend/.../DashboardChangesRoutesSpec.scala` — the old "dashboard-only grantee gets no data time" case INVERTED (intended: it asserted the defect); new: grantee data times/ids subset of its panel-list, editor/dual grant/stranger, public-grant stranger. Extended the existing spec (not a new RLS spec): it already runs over the NOBYPASSRLS `helio_app_test` pool.

## Frontend, mechanisms
- Restore-marker mechanism: `panels/state/restoreMarkers.ts` (new; per-panel serial; cleared on expire, logout, another dashboard's restore/fetch). Consumed (a) when the first mount fetches (`usePanelData` dispatch, `usePanelSortFilter.dispatchFetch`), (b) on card unmount via a 0 ms timer cancelled by the effect re-run, so **StrictMode's simulated unmount does not consume** (cleanup + immediate re-run; the timer also spends only the serial it saw). Only hosts passing `mountOwnership` read it.
- **CR1 mechanism (named): option A.** Under a marker, `usePanelData`'s first-mount non-refresh branch builds its query from the window's FULL `lastQuery` (`replayableQuery(..., full = fullReplay || restoredMount)`), used for the reuse check AND the dispatch. No marker: byte-identical. The deferral alternative was not used (so no wedge analysis needed); the scoped meta stub is NOT persisted.
- `panels/state/panelRowsReuse.ts` — scoped Output (`getOutputPanelScope` defined): reusable iff marker + the usual settled/query/retained/generation; owner branch unchanged. `isReusable` gained an optional `panelId`.
- `panels/state/applyPanelReadScopes.ts` (new) — factored out of `fetchPanels`; also used by the restore.
- `panels/state/panelThunks.ts` — uses it; `clearRestoreMarkersExcept` on fetch.
- `panels/state/panelStatusStore.ts` — `seedPanelStatusBaseline`, pending advances (per entry), seeds map independent of entries, cleared by `clearAll`.
- `dashboards/tabs/warm/warmScope.ts` (new), `warmStore.ts` (`readScope` in type, `WARM_ENTRY_KEYS`, `sanitizeEntry`), `warmCache.ts` (list `readScope`, `recordFetchResult(…, readScope)`, marker clearing), `warmListeners.ts` (passes the scope), `warmCapture.ts` (no skip; panel scope = empty meta/baseline), `warmRestore.ts` (`scope` argument REQUIRED; mismatch/unknown refuses before seeding; panel copy never seeds meta/baseline), `showDashboardPanels.ts` (scope check, `applyPanelReadScopes`, markers + status seeds for KEPT windows, both stored-copy callers), `hydrateTabs.ts` (passes scope).
- Unknown scope = dashboard absent from the store => cold.

## Intended assertion changes in existing tests
- `warmNonOwner.test.ts`: shared dashboard now restores with no request; editor dashboard now captured (HEL-1773's inverse).
- `boundedWarmStore.test.ts`: key-set assertion gains `readScope` (fixture sets it).
- `warmRestore.test.ts`, `warmReloadStaleCopy.test.ts`: `applyWarmEntry` calls pass `scope: "output"` (new required argument).
- `panelRowsReuse.test.ts`: its `outputMetaCache` mock gains `getOutputPanelScope`.

## New tests
`warmSharedDashboard.test.ts`, `usePanelData.restoreMarker.test.tsx` (card host mirrors PanelCard/PanelCardBody effect order), `panelStatusStore.seed.test.ts`, `e2e/hel1783-shared-dashboard-tabs.spec.ts` (its Output has a persisted default `columnSort`; refresh via `visibilitychange` after waiting out `SIGNALS_VISIBLE_MIN_GAP_MS`; (d) uses `page.goto` to DB because a plain reload deep-links DA from the URL).

## Evidence (`evidence/`)
red-backend/red-jest/red-e2e; green-e2e; rls-helio-app.txt (labelled, role NOBYPASSRLS, grantee 0 rows on outputs and history, new query 12 Outputs x 600 points 0.08 ms); mutations-backend (m1, m2), mutations-frontend (m3, m4, m5a/b/c, m6, m6b, m7, m8, m9, m10a, m10b, m11, m12), mutations-e2e (m3, m7, m8), siblings-1/2.

## Cycle 2 (final-gate skeptic CR1-CR3)
- `usePanelSortFilter.ts`: a restored card (marker held) with NO terms now compares its own query with the window and calls `dispatchFetch` on a difference (control-column term: one per-panel request; client-only term: HEL-1780 skip, query recorded). `mountOwnership` is set only once a difference is found (or the card has terms), so a reusable window leaves the parent's reuse decision alone.
- `restoreMarkers.ts`: new `useConsumeRestoreMarkerOnUnmount` (the StrictMode-safe unmount timer moved out of `usePanelData.ts`, 547 -> 527 lines; base was 504, still over the ~400-line guideline: PR description should note a split proposal, e.g. moving the wait/queue machinery into its own hook).
- Tests: `usePanelData.restoreMarker.test.tsx` cases (i) control-column interactive filter, sort, and "persisted default removed" (stored path), (ii) non-control column (no request, recorded query), (iii) memory path (metadata held at mount); an `afterEach` asserts the Output rows and Output metadata services are never called. Mutation m13 (the no-terms branch off) turns all 8 red (`evidence/mutations-m13.txt`).
- `DashboardChangesRoutesSpec`: `share` takes a role; the editor case now creates a real `editor` grant (plus a viewer grant and a stranger-before-grant check).
- `design.md` D5: m3/m8 map corrected (e2e (d), not (a)) with the reason.
- Gates: full jest in the hook (868 suites, 10267 tests); e2e hel1783 + hel1773 + hel1780 + hel1786 (17 passed) and hel1575 x3 (28 passed) against lane servers and the lane DB (dropped); sbt `DashboardChangesRoutesSpec` 13/13.

## Declared paths

- `backend/src/main/scala/com/helio/infrastructure/persistence/dashboards/DashboardChangesRepository.scala`
- `backend/src/test/scala/com/helio/api/routes/dashboards/DashboardChangesRoutesSpec.scala`
- `e2e/hel1783-shared-dashboard-tabs.spec.ts`
- `frontend/src/features/dashboards/tabs/hydrateTabs.ts`
- `frontend/src/features/dashboards/tabs/warm/boundedWarmStore.test.ts`
- `frontend/src/features/dashboards/tabs/warm/showDashboardPanels.ts`
- `frontend/src/features/dashboards/tabs/warm/warmCache.ts`
- `frontend/src/features/dashboards/tabs/warm/warmCapture.ts`
- `frontend/src/features/dashboards/tabs/warm/warmListeners.ts`
- `frontend/src/features/dashboards/tabs/warm/warmNonOwner.test.ts`
- `frontend/src/features/dashboards/tabs/warm/warmReloadStaleCopy.test.ts`
- `frontend/src/features/dashboards/tabs/warm/warmRestore.test.ts`
- `frontend/src/features/dashboards/tabs/warm/warmRestore.ts`
- `frontend/src/features/dashboards/tabs/warm/warmScope.ts`
- `frontend/src/features/dashboards/tabs/warm/warmSharedDashboard.test.ts`
- `frontend/src/features/dashboards/tabs/warm/warmStore.ts`
- `frontend/src/features/panels/hooks/usePanelData.restoreMarker.test.tsx`
- `frontend/src/features/panels/hooks/usePanelData.ts`
- `frontend/src/features/panels/hooks/usePanelSortFilter.ts`
- `frontend/src/features/panels/state/applyPanelReadScopes.ts`
- `frontend/src/features/panels/state/panelRowsReuse.test.ts`
- `frontend/src/features/panels/state/panelRowsReuse.ts`
- `frontend/src/features/panels/state/panelStatusStore.seed.test.ts`
- `frontend/src/features/panels/state/panelStatusStore.ts`
- `frontend/src/features/panels/state/panelThunks.ts`
- `frontend/src/features/panels/state/restoreMarkers.ts`

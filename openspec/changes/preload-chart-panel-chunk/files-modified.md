- `frontend/src/features/panels/ui/renderers/chartPanelModule.ts` — new shared chart-chunk loader (memoised, clear-on-reject) and never-rejecting preload
- `frontend/src/features/panels/ui/renderers/chartPanelModule.test.ts` — unit: single memoised import, retry after failed import, preload swallows rejection
- `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx` — lazy() now built from loadChartPanel (same chunk)
- `frontend/src/features/panels/state/outputMetaCache.ts` — noteKind helper (knownKinds.set + chart preload) used by fetchOutputMeta and seedOutputMeta
- `frontend/src/features/panels/state/outputMetaCache.preload.test.ts` — unit: chart preloads (fetch + warm seed), table/metric/markdown do not
- `frontend/src/features/dashboards/services/publicDashboardService.ts` — fetchPublicOutputMeta preloads for kind chart
- `frontend/src/features/dashboards/services/publicDashboardService.preload.test.ts` — unit: public chart preloads, others do not
- `openspec/changes/preload-chart-panel-chunk/tasks.md` — tasks ticked
- `openspec/changes/preload-chart-panel-chunk/files-modified.md` — this file

Overlap with concurrent lanes HEL-1744/HEL-1746/HEL-1757: none known. No panel-rendering component, hook, e2e spec or timeout is touched. outputMetaCache.ts was last edited by HEL-1744 (already on main, knownKinds); only a small noteKind helper is added here, so a merge conflict with any lane editing the same two lines is possible but not expected.

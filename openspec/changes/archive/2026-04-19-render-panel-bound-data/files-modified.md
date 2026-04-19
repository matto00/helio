# Files Modified — render-panel-bound-data

- `frontend/src/services/dataSourceService.ts` — added `fetchCsvPreview` and `fetchRestPreview` functions and their response interfaces
- `frontend/src/types/models.ts` — added `MappedPanelData` type alias (`Record<string, string>`)
- `frontend/src/hooks/usePanelData.ts` — new hook: resolves DataType/DataSource, dispatches fetchSources if idle, fetches CSV or REST preview, applies fieldMapping, returns `{ data, rawRows, headers, isLoading, error, noData }`
- `frontend/src/hooks/usePanelData.test.ts` — unit tests: CSV path, REST path, unbound panel, empty rows, fetch error, fetchSources dispatch
- `frontend/src/components/PanelContent.tsx` — extended `PanelContentProps` with `data`, `rawRows`, `headers`, `isLoading`, `error`, `noData`; added loading spinner, error, no-data states; updated MetricContent/TextContent/ChartContent/TableContent to render live data
- `frontend/src/components/PanelContent.test.tsx` — updated and extended with snapshot/render tests for loading, error, no-data, live metric, and live table states
- `frontend/src/components/PanelContent.css` — added CSS for spinner animation, state overlay, error styling, live text, and chart data badge
- `frontend/src/components/PanelGrid.tsx` — extracted `PanelCardBody` inner component that calls `usePanelData` per panel and passes data props to `PanelContent`; added `useAppSelector` import for `dataTypes` and `sources`

## 1. Frontend — Service Layer

- [x] 1.1 Add `fetchCsvPreview(sourceId: string)` to `dataSourceService.ts` calling `GET /api/data-sources/:id/preview`
- [x] 1.2 Add `fetchRestPreview(sourceId: string)` to `dataSourceService.ts` calling `GET /api/sources/:id/preview`

## 2. Frontend — Hook

- [x] 2.1 Create `frontend/src/hooks/usePanelData.ts` with `usePanelData(panel, dataTypes, sources)` hook
- [x] 2.2 Hook resolves `panel.typeId → DataType → DataType.sourceId → DataSource.sourceType`
- [x] 2.3 Hook dispatches `fetchSources` if `sources.status === "idle"` and `panel.typeId` is set
- [x] 2.4 Hook fetches via the correct preview endpoint based on `sourceType`
- [x] 2.5 Hook applies `panel.fieldMapping` to the first row to produce `Record<string, string>` (slot → value)
- [x] 2.6 Hook handles empty rows by setting a `noData` flag
- [x] 2.7 Hook returns `{ data, isLoading, error, noData }`
- [x] 2.8 Hook re-runs when `panel.typeId` or `panel.fieldMapping` changes

## 3. Frontend — PanelContent Component

- [x] 3.1 Add `MappedPanelData` type alias (`Record<string, string>`) to `types/models.ts`
- [x] 3.2 Extend `PanelContentProps` with `data?: MappedPanelData | null`, `isLoading?: boolean`, `error?: string | null`, `noData?: boolean`
- [x] 3.3 Add loading spinner markup/CSS to `PanelContent` (shown when `isLoading`)
- [x] 3.4 Add error state markup/CSS to `PanelContent` (shown when `error` is set)
- [x] 3.5 Add "No data available" markup to `PanelContent` (shown when `noData` and no error)
- [x] 3.6 Update `MetricContent` to accept and display `data.value` and `data.label` when provided
- [x] 3.7 Update `TextContent` to display `data.content` when provided
- [x] 3.8 Update `ChartContent` to show a "Data loaded" badge when `data` is present
- [x] 3.9 Update `TableContent` to render live rows from `data` when provided (use raw preview rows)

## 4. Frontend — PanelList Integration

- [x] 4.1 In `PanelList.tsx`, call `usePanelData` for each panel and pass result props to `PanelContent`
- [x] 4.2 Ensure `dataTypes` and `sources` selectors are available in `PanelList`

## 5. Tests

- [x] 5.1 Unit test `usePanelData`: covers CSV path, REST path, unbound panel (no fetch), empty rows, and fetch error
- [x] 5.2 Unit test `PanelContent`: snapshot/render tests for loading, error, no-data, and live-data states for metric and table types
- [x] 5.3 Update existing `PanelContent.test.tsx` to pass required props to prevent regressions

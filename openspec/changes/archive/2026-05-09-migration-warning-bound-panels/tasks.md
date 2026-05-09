## 1. Frontend

- [x] 1.1 Create `useLegacyBoundPanel(panel: Panel): boolean` hook in `frontend/src/hooks/` that reads `dataTypesSlice.items` and returns true when `panel.typeId` resolves to a DataType with `sourceId !== null`
- [x] 1.2 Create `PanelLegacyWarning` component (or inline banner) in `frontend/src/components/` that renders an amber warning banner with migration instruction text
- [x] 1.3 Integrate `useLegacyBoundPanel` and the warning banner into `PanelCardBody` in `PanelGrid.tsx`, rendering the banner above `PanelContent` when `isLegacyBound` is true
- [x] 1.4 Add CSS for the warning banner in `PanelGrid.css` (amber background, appropriate padding/typography)

## 2. Tests

- [x] 2.1 Write unit tests for `useLegacyBoundPanel` covering: legacy DataType (sourceId set), pipeline DataType (sourceId null), unbound panel (typeId null), and empty dataTypes state
- [x] 2.2 Write tests for `PanelCardBody` (or `PanelGrid`) asserting banner renders for legacy-bound panel and is absent for pipeline-bound and unbound panels

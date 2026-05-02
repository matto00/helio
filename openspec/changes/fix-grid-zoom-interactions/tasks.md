## 1. Frontend

- [x] 1.1 Add `zoomLevel: number` prop (default `1.0`) to `PanelGridProps` in `PanelGrid.tsx`
- [x] 1.2 Pass `zoomLevel` to `PanelGrid` which uses `createScaledStrategy()` to set the `positionStrategy` prop on `<Responsive>` in `PanelGrid.tsx`
- [x] 1.3 Pass `zoomLevel={zoomLevel}` from `PanelList` to `<PanelGrid>` in `PanelList.tsx`

## 2. Tests

- [x] 2.1 Add a `PanelGrid.test.tsx` test asserting `positionStrategy` (created by `createScaledStrategy()`) is forwarded to `<Responsive>` with correct scale value
- [x] 2.2 Add a `PanelList.test.tsx` test asserting `PanelGrid` receives the correct `zoomLevel` prop when zoom is changed

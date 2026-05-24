## 1. Frontend — usePanelData stabilization

- [x] 1.1 Memoize `headers` derivation in `usePanelData.ts` with `useMemo` keyed on `rows` reference
- [x] 1.2 Memoize `rawRows` derivation in `usePanelData.ts` with `useMemo` keyed on `rows` reference
- [x] 1.3 Memoize `data` (field-mapped first-row object) with `useMemo` keyed on `rows` + `fieldMappingKey`

## 2. Frontend — PanelGrid memoization and drag-freeze

- [x] 2.1 Extract a `PanelCard` component from the inline `.map()` body in `PanelGrid.tsx`; wrap it in `React.memo`
- [x] 2.2 Move `getPanelCardStyle` call inside `PanelCard`; memoize with `useMemo` on `panel.appearance` + `theme`
- [x] 2.3 Stabilize all handler callbacks inside `PanelCard` with `useCallback` (delete, duplicate, rename, detail, click)
- [x] 2.4 Wrap `PanelCardBody` in `React.memo`
- [x] 2.5 Add `isDragging` state to `PanelGrid`; set `true` in `onDragStart`, `false` in `onDragStop`
- [x] 2.6 Pass `isDragging` as `frozen` prop to `PanelCardBody`; short-circuit render when `frozen === true`
- [x] 2.7 Ensure `onDragStart` and `onDragStop` callbacks are stable (`useCallback`) so they don't cause extra renders

## 3. Tests

- [x] 3.1 Add/update Jest tests for `usePanelData` to assert that `headers`, `rawRows`, and `data` references are stable across re-renders when rows are unchanged
- [x] 3.2 Add Jest/RTL test for `PanelGrid` asserting that `PanelCardBody` does not re-render during a simulated drag (mock `isDragging` prop toggle)
- [x] 3.3 Run full test suite and confirm no regressions (`npm test`)
- [x] 3.4 Run lint and format checks (`npm run lint`, `npm run format:check`)

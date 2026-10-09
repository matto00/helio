## Standing Constraints

- [C1] Production diff limited to `buildInitialChart` in PanelDetailModal.tsx (no new exports, no defaultChartAppearance change, no stored-row/DB changes) — keeps clear of HEL-1398/HEL-1399 and the HEL-1379 ruling.

### Frontend

- [x] 1.1 In `buildInitialChart`, spread `defaultChartAppearance` without its `chartType` and remove the `?? "line"` line so a stored `chartType` passes through and an absent one stays absent

### Tests

- [x] 2.1 New `PanelDetailModal.chartTypeDefault.test.tsx`: mock `../editors/AppearanceEditor` to capture `chartAppearance`; panel with no stored chartType bound to a `bar` Output → captured state has no `chartType` property
- [x] 2.2 Same file: stored `chartType: "pie"` → captured state has `chartType: "pie"`
- [x] 2.3 Same file: edit title + save → dispatched update / pending store update contains no `appearance.chart` and no `chartType` (regression guard, labelled)
- [x] 2.4 Record red proof: tests 2.1 fails on unfixed code; and fails with only `?? "line"` removed (no destructure); passes after full fix
- [x] 2.5 Run `npm run lint`, `npm run typecheck`, `npm test -- --testPathPatterns=PanelDetailModal` and the pre-commit hooks

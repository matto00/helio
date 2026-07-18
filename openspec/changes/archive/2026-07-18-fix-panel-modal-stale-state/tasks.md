# Tasks — fix-panel-modal-stale-state (HEL-307)

## 1. Probe (systematic-debugging Iron Law)

- [x] 1.1 Reproduce the stale-title bug against unfixed code (live app via Playwright or a component test switching the `panel` prop without a key) and capture the evidence
- [x] 1.2 Probe-confirm the root cause: instance reuse across `detailPanelId` changes leaves `useState` seeds stale; confirm `handleEditSubmit` would dispatch A's staged appearance against B's `panel.id` (the corruption path)

## 2. Frontend

- [x] 2.1 Add `key={panel.id}` to the `PanelDetailModal` render in `frontend/src/features/panels/ui/DesktopPanelGrid.tsx`
- [x] 2.2 Add `key={detailPanel.id}` to the `PanelDetailModal` render in `frontend/src/features/panels/ui/MobilePanelStack.tsx`
- [x] 2.3 Audit every modal form field (title, background/color/transparency, chart appearance, binding/dataTypeId, field mapping, refresh interval, aggregation, markdown/text/image/divider/collection sections, BoundOrLiteral + chart/table display hooks) and confirm all state is component-local under the keyed subtree — no module-level or Redux-cached form state survives remount; fix and note any exception found

## 3. Tests

- [x] 3.1 Regression test (direct-switch path): render the modal the way the call sites do, switch panel identity A→B without closing, assert every audited field group shows B's persisted values
- [x] 3.2 Regression test (corruption path): after a direct switch A→B, submit the form unedited and assert no dispatched update carries A's staged values against B's id
- [x] 3.3 Re-run the task-1.1 probe against fixed code and confirm the stale title no longer reproduces; run frontend gates (`npm test`, `npm run lint`, `npm run format:check`, `npm run build`)

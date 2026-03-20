## 1. Backend — PanelRepository

- [x] 1.1 Add `duplicate(id: PanelId): Future[Option[Panel]]` — reads source, copies with new UUID and current timestamps, inserts and returns the new panel; returns `None` if source not found

## 2. Backend — ApiRoutes

- [x] 2.1 Add `POST /api/panels/:id/duplicate` route — calls `panelRepo.duplicate`, returns 201 with new panel body on success, 404 if source not found

## 3. Backend — Tests

- [x] 3.1 Add test: duplicate returns 201 with new panel copied from source
- [x] 3.2 Add test: duplicate of non-existent panel returns 404
- [x] 3.3 Add test: duplicate does not modify the source panel

## 4. Frontend — panelService

- [x] 4.1 Add `duplicatePanel(panelId: string): Promise<Panel>` — `POST /api/panels/:id/duplicate`

## 5. Frontend — panelsSlice

- [x] 5.1 Add `duplicatePanel` async thunk — calls `duplicatePanel` service, then dispatches `markDashboardPanelsStale` and `fetchPanels` (same pattern as `createPanel`)
- [x] 5.2 Handle `duplicatePanel.rejected` — set error state

## 6. Frontend — PanelGrid

- [x] 6.1 Wire Duplicate menu item in existing ActionsMenu on each panel card
- [x] 6.2 Wire button to dispatch `duplicatePanel({ panelId, dashboardId })`

## 7. Verification

- [x] 7.1 Run `sbt test` — all backend tests pass (30/30)
- [x] 7.2 Run `npm test` — all frontend tests pass (35/35)
- [x] 7.3 Run `npm run lint` and `npm run format:check` — clean
- [x] 7.4 Visual check: Duplicate menu item active, fires correct request

## 1. Backend — PanelRepository

- [ ] 1.1 Add `duplicate(id: PanelId): Future[Option[Panel]]` — reads source, copies with new UUID and current timestamps, inserts and returns the new panel; returns `None` if source not found

## 2. Backend — ApiRoutes

- [ ] 2.1 Add `POST /api/panels/:id/duplicate` route — calls `panelRepo.duplicate`, returns 201 with new panel body on success, 404 if source not found

## 3. Backend — Tests

- [ ] 3.1 Add test: duplicate returns 201 with new panel copied from source
- [ ] 3.2 Add test: duplicate of non-existent panel returns 404
- [ ] 3.3 Add test: duplicate does not modify the source panel

## 4. Frontend — panelService

- [ ] 4.1 Add `duplicatePanel(panelId: string): Promise<Panel>` — `POST /api/panels/:id/duplicate`

## 5. Frontend — panelsSlice

- [ ] 5.1 Add `duplicatePanel` async thunk — calls `duplicatePanel` service, then dispatches `markDashboardPanelsStale` and `fetchPanels` (same pattern as `createPanel`)
- [ ] 5.2 Handle `duplicatePanel.rejected` — set error state

## 6. Frontend — PanelGrid

- [ ] 6.1 Add duplicate button to each panel card in `.panel-grid-card__actions`
- [ ] 6.2 Wire button to dispatch `duplicatePanel({ panelId, dashboardId })`
- [ ] 6.3 Add CSS for duplicate button (reuse `.panel-grid-card__handle` shape)

## 7. Verification

- [ ] 7.1 Run `sbt test` — all backend tests pass
- [ ] 7.2 Run `npm test` — all frontend tests pass
- [ ] 7.3 Run `npm run lint` and `npm run format:check` — clean
- [ ] 7.4 Visual check: duplicate button appears on each panel; clicking it adds a copy to the grid

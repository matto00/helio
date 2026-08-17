# Tasks: assistant-conversation-rename-ui

## 1. Frontend — state

- [x] 1.1 Add `renameConversation` thunk to `assistantConversationsSlice.ts` (design.md D6): args `{ id, title }`, calls `updateConversation(id, { title })`, rejects via `extractErrorMessage(err, "Failed to rename conversation.")`
- [x] 1.2 Add `renameConversation.fulfilled` reducer: replace matching summary in `items` (mirror `togglePinned.fulfilled`) and, when `activeConversation.data?.id` matches, update `activeConversation.data.title`

## 2. Frontend — SidebarItemList inline edit state

- [x] 2.1 Add opt-in `onRename?: (item: SidebarItem, name: string) => Promise<void>` prop and internal `renamingId`/`renameValue`/`renameStatus`/`renameError` state (design.md D2)
- [x] 2.2 Widen `renderRowAction` to `(item, helpers: { startRename: () => void }) => ReactNode` (additive second param; existing callers unchanged)
- [x] 2.3 Render the edit-mode row swap: `TextField` pre-filled with current name, auto-focus + select-all, `aria-label` "Rename <name>"; hide the row's select button/NavLink and row actions while editing (design.md D3)
- [x] 2.4 Implement commit/cancel semantics (design.md D4): Enter commits trimmed value; Escape and blur cancel; blank-after-trim sets `aria-invalid` and stays editing; unchanged-after-trim cancels without calling `onRename`
- [x] 2.5 Implement in-flight/error handling (design.md D5): disable input while the `onRename` promise is pending; on resolve exit edit mode; on reject stay editing and render a `role="alert"` error line below the row
- [x] 2.6 Add the edit-row CSS to `DashboardList.css` (compose with existing row styles; input metrics match the filter input; DESIGN.md tokens only; add a `gap` to `.dashboard-list__row-action` so the two row-action buttons don't render flush)

## 3. Frontend — SidebarBody wiring

- [x] 3.1 In the chat section, add the pencil rename button (lucide `Pencil`, size 14, `dashboard-list__row-action-btn`, aria-label "Rename <name>") as a sibling before the pin toggle inside `renderRowAction`, calling `helpers.startRename()` (design.md D1)
- [x] 3.2 Pass `onRename` for the chat section: `await dispatch(renameConversation({ id, title })).unwrap()` (design.md D5)

## 4. Tests

- [x] 4.1 `assistantConversationsSlice.test.ts`: `renameConversation.fulfilled` updates the matching item in `items`; updates `activeConversation.data.title` when ids match; leaves a non-matching `activeConversation` untouched
- [x] 4.2 `SidebarBody.test.tsx`: renaming a conversation sends `PATCH { title }` and shows the new title (Enter commit path, mock service per existing pin conventions)
- [x] 4.3 `SidebarBody.test.tsx`: Escape cancels with no PATCH; blank-after-trim commits nothing and marks the input invalid; unchanged title exits edit mode with no PATCH
- [x] 4.4 `SidebarBody.test.tsx`: a failed rename keeps the row editable and shows a `role="alert"` error
- [x] 4.5 `SidebarBody.test.tsx`: clicking the rename action does not select the conversation (mirror the existing pin-doesn't-select test)
- [x] 4.6 Run the frontend gates: `npm test`, `npm run lint`, `npm run format:check` — all clean

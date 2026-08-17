# Proposal: assistant-conversation-rename-ui

## Why

The backend fully supports renaming an assistant conversation (`PATCH /api/assistant-conversations/:id`
accepts `title`; `AssistantConversationService.rename`/`update` implement it; the frontend service layer's
`updateConversation(id, { title })` already exists), but no UI calls it with a title — users are stuck with
derived/default titles like "New conversation". There is no inline-rename pattern anywhere else in the app to
reuse, so this needs a small, self-contained UI design of its own.

## What Changes

- Add a `renameConversation` thunk to `assistantConversationsSlice.ts`, mirroring `togglePinned`'s existing
  shape (calls `updateConversation(id, { title })`; `fulfilled` replaces the matching summary in `items`).
- Add an inline-rename affordance to the chat sidebar's conversation list: an edit (pencil) row action next
  to the existing pin toggle in `SidebarBody.tsx`'s chat `renderRowAction`.
- Extend `SidebarItemList` with an opt-in per-row inline edit state: the row's name swaps to a text input
  pre-filled with the current title; Enter saves, Escape cancels, blank-after-trim input never saves
  (client-side is the only guard — the backend writes any string it receives).
- Handle in-flight and error state for the PATCH (disabled input while saving; visible error on failure,
  per DESIGN.md §7).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `assistant-chat-nav`: adds a requirement that a conversation can be renamed inline from the conversation
  list (trigger affordance, editable row state, keyboard handling, blank-title rejection, loading/error
  state). Existing pin/ordering/no-delete requirements are unchanged.

## Impact

- Frontend only: `SidebarItemList.tsx` (+ `DashboardList.css`), `SidebarBody.tsx`,
  `assistantConversationsSlice.ts`, and their tests (`SidebarBody.test.tsx` pin/unpin conventions,
  `assistantConversationsSlice.test.ts`).
- No backend, schema, or migration changes. No new dependencies.

## Non-goals

- No rename UI for dashboards/pipelines/sources/metrics (no generalization beyond the chat section this
  ticket asks for, though the `SidebarItemList` mechanism is deliberately reusable).
- No backend validation changes (blank-title rejection stays client-side).
- No renaming from the active-conversation panel/header — list-row rename only.

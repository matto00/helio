# HEL-693: Add a rename UI for assistant conversations

## Description

The backend already fully supports renaming an assistant conversation — `PATCH /api/assistant-conversations/:id` accepts `title`, `AssistantConversationService.rename`/`update` implement it, and the frontend service layer's `updateConversation(id, { title })` already exists (used today only for pinning, via `{ pinned }`). But there's no UI anywhere that calls it with a title.

This isn't a thin wiring gap the way it first looked: there's no existing inline-rename pattern *anywhere else in the app* to reuse (dashboards/pipelines/etc. don't have one either), so this needs a small UI design of its own — how renaming is triggered (an edit affordance next to the existing pin button in `SidebarBody.tsx`'s chat `renderRowAction`?), how the row swaps into an editable state, keyboard handling (Enter to save, Escape to cancel), empty-title validation, and loading/error state during the PATCH.

## Scope

* Add a `renameConversation` thunk (mirrors `togglePinned`'s existing shape in `assistantConversationsSlice.ts`).
* Design and implement an inline-rename affordance in the chat sidebar's conversation list.

## Acceptance criteria

- [ ] A user can rename an existing conversation from the chat sidebar.
- [ ] Follows DESIGN.md; covered by tests matching the existing pin/unpin test conventions in `SidebarBody.test.tsx`.

## Metadata

- Ticket: HEL-693 (https://linear.app/helioapp/issue/HEL-693/add-a-rename-ui-for-assistant-conversations)
- Priority: Low (user explicitly requested delivery now)
- Team: Helio Platform
- Project: Helio v1.6 — Agentic Workflows & Pipelines

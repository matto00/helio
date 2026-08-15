## Why

HEL-663 shipped a real conversation persistence API with nowhere to call it from. HEL-659's
top-level assistant needs a first-class `/chat` nav destination — today chat only exists as a
drawer bolted onto the Dashboards section (`AuthoringChatDrawer`).

## What Changes

- Add a `Chat` entry to `navDestinations.ts` (`/chat`) — automatically covers the desktop sidebar
  and `BottomNav`'s top-level tab, per their existing shared-array design.
- Add explicit `"chat"` arms to the mobile section-picker's hand-maintained switch statements
  (`SidebarBody.tsx`'s `sectionFromPathname`, `App.tsx`'s `mobileSheetItems`/
  `mobileSheetEmptyMessage`/`handleMobileSheetSelect`/`breadcrumbLabel`) — required for AC1's
  "MobileNavSheet stays in sync," not automatic from the `navDestinations.ts` entry alone.
- New `ChatPage` + `/chat` route (React Router), following the existing "Redux-selection" pattern
  (Type Registry/Sources): a single route, `selectedConversationId` in a new
  `assistantConversationsSlice`, sidebar list drives selection, detail pane derives the effective
  selection with fallback to the first item.
- New `assistantConversationsService.ts` + `assistantConversationsSlice.ts` calling HEL-663's
  `/api/assistant-conversations` endpoints (list/create/get/update/append), mirroring
  `dataSourceService.ts`/`sourcesSlice.ts`'s existing shape.
- Sidebar list: one `SidebarItemList` instance in `SidebarBody.tsx`'s new `chat` branch, fed the
  server's already-ordered (`pinned DESC, updatedAt DESC`) list, a pin badge per item
  (`renderBadge`), `onSelect` for selection, **no `onDelete`** (HEL-663 has no delete endpoint by
  design). Pin/unpin needs a small, additive `renderRowAction` prop added to `SidebarItemList`
  itself (a genuine sibling row-action slot — neither of the component's existing extension points
  can render a clickable pin toggle without a nested-button bug; see design.md D3).
- Minimal placeholder `ActiveConversationPanel`: on selection, fetches the full conversation (title
  + transcript) and renders enough to verify the right data loaded — not the chat-bubble
  message-rendering UI (HEL-665's job), no message composer/send affordance.

## Capabilities

### New Capabilities

- `assistant-chat-nav`: the `/chat` route, sidebar nav link, conversation list + selection wiring,
  and the placeholder active-conversation panel.

### Modified Capabilities

- `mobile-bottom-nav`: the tab-bar destination-count requirement is corrected from **four** (its
  actual current, already-stale text — Metrics was added to `navDestinations.ts` by HEL-553 but
  never reflected in this spec) to **six** (Metrics + this ticket's Chat). This ticket folds in that
  pre-existing spec-sync repair while already rewriting the same requirement block to add Chat —
  self-approved, disclosed explicitly (see design.md D8), not a silent unrelated-refactor. A new
  requirement covers `MobileNavSheet`'s section-picker parity for the chat section.

## Impact

- `frontend/src/shared/chrome/navDestinations.ts`, `SidebarBody.tsx`, `App.tsx` (mobile
  section-picker switch statements), `SidebarItemList.tsx` (new additive `renderRowAction` prop,
  backward-compatible — see design.md D3) — modified.
- `frontend/src/features/assistant/` (new): `ui/ChatPage.tsx`, `ui/ActiveConversationPanel.tsx`,
  `state/assistantConversationsSlice.ts`, `services/assistantConversationsService.ts`,
  `types.ts` (TypeScript mirrors of HEL-663's wire shapes).
- `frontend/src/store/store.ts` — register the new slice's reducer (modified).
- No backend changes — this ticket is a pure frontend consumer of HEL-663's already-shipped API.
- `AuthoringChatDrawer`/`useDashboardAuthoringStream`/`DashboardList.tsx` untouched — retiring the
  drawer is HEL-666's job.

## Non-goals

- No chat message-rendering/bubble UI (HEL-665).
- No message composer / send-a-message action (`AssistantService.converse` has no live route yet).
- No retirement of `AuthoringChatDrawer` (HEL-666).

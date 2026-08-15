# Files Modified — HEL-664

## New

- `frontend/src/features/assistant/types.ts` — TypeScript mirrors of HEL-663's wire shapes
  (`AssistantConversationSummary`/`Detail`, `ClaudeToolMessageDto`/`ClaudeContentBlockDto`).
- `frontend/src/features/assistant/services/assistantConversationsService.ts` — one function per
  HEL-663 endpoint (list/create/get/append/update), mirroring `dataSourceService.ts`.
- `frontend/src/features/assistant/services/assistantConversationsService.test.ts` — one test per
  exported function, axios mocked.
- `frontend/src/features/assistant/state/assistantConversationsSlice.ts` — `items`/`status`/
  `error`/`selectedConversationId`/`activeConversation` state, thunks (`fetchConversations`,
  `selectConversation`, `togglePinned`), `setSelectedConversationId` reducer.
- `frontend/src/features/assistant/state/assistantConversationsSlice.test.ts` — per-thunk reducer +
  thunk sub-suites, including the "second selection replaces the first cleanly" regression case.
- `frontend/src/features/assistant/ui/ChatPage.tsx` + `.css` — `/chat`'s routed page; fetches
  conversations on mount, renders `ActiveConversationPanel`.
- `frontend/src/features/assistant/ui/ChatPage.test.tsx` — page shell + empty-state rendering.
- `frontend/src/features/assistant/ui/ActiveConversationPanel.tsx` + `.css` — minimal placeholder
  (title + `data-testid="active-conversation-message-count"`), the 3 DESIGN.md §7 UI states.
- `frontend/src/features/assistant/ui/ActiveConversationPanel.test.tsx` — selection-fetch, stale-mix
  guard on re-selection, empty state, error state.

## Modified

- `frontend/src/shared/chrome/navDestinations.ts` — new `Chat` (`/chat`, `MessageSquare`) entry
  (design.md D1); automatically covers the desktop sidebar and `BottomNav`.
- `frontend/src/shared/chrome/navDestinations.test.ts` — updated to six destinations.
- `frontend/src/shared/chrome/BottomNav.test.tsx` — updated inactive-tab list to include "Chat".
- `frontend/src/shared/chrome/SidebarItemList.tsx` — new additive, backward-compatible
  `renderRowAction?: (item: SidebarItem) => ReactNode` prop, rendered as a sibling of the row's own
  button (design-gate round 1 fix, design.md D3).
- `frontend/src/shared/chrome/SidebarItemList.test.tsx` — tests for the new prop (sibling rendering,
  no `onSelect` bleed-through, omitted when unset).
- `frontend/src/shared/chrome/SidebarBody.tsx` — `sectionFromPathname` gains `"chat"`; new `chat`
  branch renders one `SidebarItemList` in server order with a pin `renderBadge` and a pin/unpin
  `renderRowAction`, no `onDelete`.
- `frontend/src/shared/chrome/SidebarBody.test.tsx` — reducer registration + new chat-section tests
  (order/no-resort, pin badge, no delete affordance, pin PATCH, row-action/selection isolation).
- `frontend/src/app/App.tsx` — `breadcrumbLabel`, `mobileSheetItems`, `mobileSheetEmptyMessage`,
  `handleMobileSheetSelect` gain explicit `"chat"`/`/chat` arms (design.md D2); `/chat` route
  registered alongside the other 5 sections. **Cycle 2 (skeptic-final-1.md CR1):**
  `breadcrumbItemName` also gains a `"chat"` arm resolving the effective selected conversation's
  title — this function was missing from design.md D2's original enumeration, so the desktop
  breadcrumb and the mobile pill's "current:" label never reflected the selected conversation,
  unlike the sibling `sources`/`registry` Redux-selection sections.
- `frontend/src/app/App.test.tsx` — reducer/service mock registration + new tests (Chat nav link,
  `/chat` route, breadcrumb, MobileNavSheet selection parity, MobileNavSheet empty message).
  **Cycle 2:** new tests asserting the breadcrumb reflects the fallback-to-first-item conversation
  title and updates after an explicit selection (both the desktop sidebar row click and the
  `MobileNavSheet` selection path).
- `frontend/src/features/dashboards/ui/DashboardList.css` — new `.dashboard-list__row-action`(-btn)
  (generic, `SidebarItemList`-owned) and `.dashboard-list__pin-badge` (chat-specific) rules.
- `frontend/src/store/store.ts` — registers `assistantConversationsReducer`.
- `frontend/src/test/renderWithStore.tsx` — shared test helper gains `assistantConversations`
  reducer registration + `TestState` support (required so every existing consumer of this helper —
  and every test rendering `SidebarBody`/`App` — keeps working with the new slice in `RootState`).
- `openspec/changes/chat-nav-destination/tasks.md` — checked off completed tasks.

## Non-goals honored (per ticket.md / design.md)

- No chat message-rendering/bubble UI (`ActiveConversationPanel` is a deliberate placeholder).
- No message composer / send-a-message UI.
- `AuthoringChatDrawer`/`useDashboardAuthoringStream`/`DashboardList.tsx` untouched.

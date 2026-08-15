## 1. Frontend: Types + service + slice

- [x] 1.1 Add `frontend/src/features/assistant/types.ts`: `AssistantConversationSummary
      {id, title, pinned, updatedAt}`, `AssistantConversationDetail extends
      AssistantConversationSummary {transcript: ClaudeToolMessageDto[]}`,
      `ClaudeToolMessageDto {role, content: ClaudeContentBlockDto[]}`, `ClaudeContentBlockDto`
      discriminated on `blockType: "text" | "tool_use" | "tool_result"` — mirroring HEL-663's
      confirmed wire shapes exactly
- [x] 1.2 Add `frontend/src/features/assistant/services/assistantConversationsService.ts`:
      `listConversations()`, `createConversation(req)`, `getConversation(id)`,
      `appendTurns(id, turns)`, `updateConversation(id, {pinned?, title?})` — one function per
      HEL-663 endpoint, mirroring `dataSourceService.ts`'s shape (design.md D5)
- [x] 1.3 Add `frontend/src/features/assistant/state/assistantConversationsSlice.ts`:
      `{items, status, error, selectedConversationId, activeConversation: {data, status, error}}`,
      `createAsyncThunk`s (`fetchConversations`, `selectConversation` — fetches detail on select,
      `togglePinned`), plain reducer `setSelectedConversationId` — mirroring `sourcesSlice.ts`'s
      shape (design.md D4)
- [x] 1.4 Register `assistantConversationsReducer` in `frontend/src/store/store.ts`'s `reducer` map
      (mirrors every other feature slice's registration — required for the slice to actually be
      wired into the store, not just defined)

## 2. Frontend: Nav wiring

- [x] 2.1 Add a `Chat` entry (`/chat`, `MessageSquare` icon) to `navDestinations.ts` (design.md D1)
- [x] 2.2 Add `"chat"` to `SidebarBody.tsx`'s `sectionFromPathname` return-type union and its
      `pathname.startsWith("/chat")` branch (design.md D2)
- [x] 2.3 Add `case "chat":` arms to `App.tsx`'s `mobileSheetItems`, `mobileSheetEmptyMessage`
      (a `Record` over the full union — TypeScript will force this key), `handleMobileSheetSelect`
      (dispatches the same `setSelectedConversationId` action the desktop sidebar's `onSelect`
      does), and `breadcrumbLabel`'s `/chat` branch (design.md D2)

## 3. Frontend: Pages + components

- [x] 3.1 Add `frontend/src/features/assistant/ui/ChatPage.tsx`: fetches conversations on mount
      (mirrors `TypeRegistryPage.tsx`), renders the chat section's sidebar list + active
      conversation panel
- [x] 3.1a Add a new optional `renderRowAction?: (item: SidebarItem) => ReactNode` prop to
      `frontend/src/shared/chrome/SidebarItemList.tsx`, rendered as a sibling of the row's own
      selectable button (mirroring exactly where `ActionsMenu` already renders) — additive,
      backward-compatible, no existing caller (sources/pipelines/registry/metrics) is affected
      unless it opts in (design.md D3 design-gate fix)
- [x] 3.2 Add a `chat` branch in `SidebarBody.tsx`: one `SidebarItemList` fed
      `conversations.items` in API order (no client re-sort), `renderBadge` showing a pin icon for
      `pinned: true` items, `onSelect` dispatching `setSelectedConversationId`, `renderRowAction`
      rendering a pin/unpin icon-button (own click handler, genuinely sibling to the row button —
      no `stopPropagation()` hack needed since it's not nested) dispatching `togglePinned`, **no
      `onDelete` prop** (design.md D3)
- [x] 3.3 Register `/chat` → `ChatPage` in `App.tsx`'s route list, alongside the other 5 sections,
      same `<ProtectedRoute>`/`<AppShell>` nesting (design.md D4)
- [x] 3.4 Add `frontend/src/features/assistant/ui/ActiveConversationPanel.tsx`: derives the
      selected conversation with fallback to the first item (mirrors `SourcesPage.tsx`/
      `TypeRegistryBrowser.tsx`'s pattern), renders title + a `data-testid=
      "active-conversation-message-count"` element showing `transcript.length`; implements
      DESIGN.md §7's 3 required UI states — loading spinner while `activeConversation.status ===
      "loading"`, `EmptyState variant="main"` when nothing is selected, visible intent-error
      styling on a failed fetch (design.md D6)

## Tests

- [x] 4.1 Test: `/chat` route renders `ChatPage`
- [x] 4.2 Test: the desktop sidebar shows a Chat `NavLink` to `/chat`
- [x] 4.2a Test: `breadcrumbLabel` returns the correct label for the `/chat` pathname (non-blocking
      completeness item from the design gate)
- [x] 4.3 Test: the conversation list renders in the exact order the (mocked) API returns it, with
      a pin indicator on `pinned: true` items — no client-side re-sort
- [x] 4.4 Test: pinning a conversation from the list sends `PATCH {pinned: true}` and the item
      subsequently shows the pinned indicator
- [x] 4.4a Test: clicking the pin/unpin row action does NOT also dispatch conversation selection
      (proves `renderRowAction`'s sibling placement — not a nested button — genuinely isolates the
      two click handlers; design-gate round 1 fix)
- [x] 4.5 Test: the conversation list renders no delete affordance
- [x] 4.6 Test: selecting a conversation issues a `GET` for its detail and the active conversation
      panel reflects that conversation's title and transcript length once resolved
- [x] 4.7 Test: selecting a second conversation while a first is loaded replaces the active
      conversation cleanly (no stale mix)
- [x] 4.8 Test: zero conversations renders `EmptyState`, not a blank panel
- [x] 4.9 Test: a failed detail fetch renders a visible error, not a silent failure
- [x] 4.10 Test: `MobileNavSheet`'s chat-section selection dispatches the identical
      `setSelectedConversationId` action the desktop sidebar's `onSelect` would for the same
      conversation (design.md D2's parity guarantee)
- [x] 4.11 Test: `MobileNavSheet`'s chat section shows a section-specific empty message when there
      are no conversations
- [x] 4.12 Regression test: the existing Dashboards/Sources/Pipelines/Registry/Metrics nav
      sections, routes, and `BottomNav` tab count/labels are unaffected (AC3)
- [x] 4.13 `npm test` fully green; `npm run lint`/`npm run format:check` clean

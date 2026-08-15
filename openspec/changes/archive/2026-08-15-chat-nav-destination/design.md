## Context

`navDestinations.ts` (`NavDestination[]`) drives both the desktop sidebar (`App.tsx`) and
`BottomNav`'s top-level tab bar directly — adding one entry there is automatically sufficient for
both. `MobileNavSheet`, in contrast, is a generic item-picker with no knowledge of sections; the
mobile "which item in this section" flow is hand-wired per-section in `SidebarBody.tsx`
(`sectionFromPathname`) and `App.tsx` (`mobileSheetItems`/`mobileSheetEmptyMessage`/
`handleMobileSheetSelect`/`breadcrumbLabel`) — every existing section (sources/pipelines/registry/
metrics) has its own arm in each. `SidebarItemList` is a plain, unordered, presentational list
(`{id, name, subtitle?}`) with optional `onDelete`/`renderBadge`/`toHref`-or-`onSelect` — no
pinned/sort concept exists anywhere in this codebase yet; HEL-663's backend already returns
`pinned DESC, updatedAt DESC` order. Type Registry/Sources follow a "Redux-selection" page pattern
(one route, `selectedXId` in the slice, detail pane derives-with-fallback-to-first-item) — the
pattern to mirror, not Pipelines/Metrics' route-per-item pattern (the epic spec describes a single
`/chat` route, not `/chat/:id`).

## Goals / Non-Goals

**Goals:**
- `/chat` reachable from desktop nav + `BottomNav`, with `MobileNavSheet`'s section-picker in real
  parity (not just the top-level tab).
- Conversation list (pin-aware presentation, no delete UI — HEL-663 has no delete endpoint).
- Selecting a conversation loads its real transcript into a minimal placeholder panel.

**Non-Goals:**
- No chat message-rendering/bubble UI (HEL-665).
- No message composer / send action.
- No `AuthoringChatDrawer` retirement (HEL-666).

## Decisions

**D1 — `navDestinations.ts` gets one new entry; `BottomNav`/desktop sidebar need no other change.**
`{ to: "/chat", label: "Chat", icon: MessageSquare }` (Lucide, matching the existing icon-per-entry
convention) appended to the array — both consumers (`App.tsx`'s sidebar loop, `BottomNav.tsx`) pick
it up with zero additional edits, confirmed by reading both consumers directly.

**D2 — `MobileNavSheet` section-picker parity requires explicit parallel edits, not automatic.**
Add `"chat"` to `sectionFromPathname`'s return-type union and its `pathname.startsWith("/chat")`
branch (`SidebarBody.tsx`), and a `case "chat":` arm to each of `App.tsx`'s `mobileSheetItems`
(mapping conversations to `MobileNavSheetItem`), `mobileSheetEmptyMessage` (a `Record` over the
full union — TypeScript forces this key or the file won't compile, so it can't be silently missed),
`handleMobileSheetSelect` (dispatches the same `setSelectedConversationId` the desktop sidebar's
`onSelect` does — one selection action, two entry points, never two divergent ones), and
`breadcrumbLabel`'s `/chat` branch. This is the concrete mechanism behind AC1's "no forked state" —
both surfaces end up calling the identical Redux action, not two parallel ones that could drift.

**D3 — Sidebar list: one `SidebarItemList`, server order respected, pin badge, no delete, a new
sibling row-action slot for pin/unpin (design-gate round 1 fix).** A new `chat` branch in
`SidebarBody.tsx` renders a single `SidebarItemList` fed `conversations.items` **in the order the
API already returns** (`pinned DESC, updatedAt DESC` — no client-side re-sort/re-group, avoiding a
second, potentially-drifting ordering implementation) with a small pin-icon `renderBadge` on pinned
items (visually distinguishes them in place, since no two-section "Pinned / Recent" list component
exists to build against — see ticket.md's research finding). `onSelect` dispatches
`setSelectedConversationId`. **No `onDelete` prop is passed** — `SidebarItemList`'s Delete
affordance is optional and cleanly omits when unset (confirmed by reading the component), and
HEL-663 has no delete endpoint to wire it to.

Pin/unpin genuinely cannot render via either of `SidebarItemList`'s two existing per-row extension
points: `renderBadge` renders *inside* the row's own selectable `<button>` (chat uses `onSelect`,
not `toHref`), so a clickable toggle there would nest `<button>` inside `<button>` (invalid HTML)
and, without `stopPropagation()`, would also fire selection; the sibling `<ActionsMenu>` only
renders when `onDelete` is set, which this design explicitly opts out of. Required fix, not a
workaround: **add a new optional `renderRowAction?: (item: SidebarItem) => ReactNode` prop to
`SidebarItemList`**, rendered as a sibling of the row's own button — mirroring exactly where
`ActionsMenu` already renders today, just gated on its own prop instead of `onDelete`. This is a
small, additive, backward-compatible change (existing callers that don't pass it are unaffected);
the chat section passes a pin/unpin icon button here, dispatching `togglePinned` (`PATCH /:id`),
genuinely a sibling element with its own click handler — no nested button, no bubbling risk.

**D4 — Route/page/slice pattern mirrors Type Registry/Sources exactly ("Redux-selection"
flavor).** One `/chat` route → `ChatPage` (registered in `App.tsx` alongside the other 5, same
`<ProtectedRoute>`/`<AppShell>` nesting). `assistantConversationsSlice`:
`{items, status, error, selectedConversationId, activeConversation:
{data, status, error} }` — `activeConversation` is fetched separately (`GET /:id`, which includes
the transcript; the list's `GET /` intentionally does not, per HEL-663's own summary-vs-detail
split) whenever `selectedConversationId` changes, mirroring the existing "detail pane derives
selection with fallback to first item" convention (`selected = items.find(c => c.id ===
selectedConversationId) ?? items[0] ?? null`, then fetch that id's detail).

**D5 — `assistantConversationsService.ts` mirrors `dataSourceService.ts`'s shape exactly** — one
async function per HEL-663 endpoint (`listConversations()`, `createConversation(req)`,
`getConversation(id)`, `appendTurns(id, turns)`, `updateConversation(id, {pinned?, title?})`),
plain `httpClient` (axios) calls, TypeScript types mirroring the confirmed wire shapes
(`AssistantConversationSummary {id, title, pinned, updatedAt}`,
`AssistantConversationDetail extends AssistantConversationSummary {transcript:
ClaudeToolMessageDto[]}`, `ClaudeToolMessageDto {role, content: ClaudeContentBlockDto[]}`,
discriminated on `blockType: "text"|"tool_use"|"tool_result"`).

**D6 — `ActiveConversationPanel`: minimal, DESIGN.md-compliant placeholder, not chat UI.** Renders
the selected conversation's title + a `data-testid="active-conversation-message-count"` element
showing the loaded transcript's length (verifiable in tests without building message-rendering UI)
plus the 3 required UI states from DESIGN.md §7: **loading** (the established spinner pattern
while `activeConversation.status === "loading"`), **empty** (`EmptyState` `variant="main"` when no
conversation is selected — e.g. an empty conversation list), **error** (visible, intent-error
styled, never swallowed, when the detail fetch fails). This is deliberately the full extent of this
ticket's "message-rendering" surface — HEL-665 replaces the placeholder body with real chat-bubble
UI, reusing the same `activeConversation` slice state this ticket establishes.

**D7 — No new backend/schema work.** Every field this ticket's TypeScript types need is already on
HEL-663's wire contract (confirmed by reading `AssistantConversationProtocol.scala`/
`AssistantConversationRoutes.scala` directly) — this is a pure frontend consumer.

**D8 — `mobile-bottom-nav`'s destination-count requirement is corrected from four to six, not five
to six (design-gate round 1 fix).** The live base spec currently says "exactly the four section
destinations" (`/`, `/sources`, `/pipelines`, `/registry`) — a pre-existing HEL-553 spec-sync gap:
`navDestinations.ts` already has 5 entries today (Metrics was added to the code but never reflected
in this spec). This ticket's `MODIFIED Requirements` delta necessarily rewrites this exact
requirement block to add Chat as the 6th destination — since it's already touching this text,
correcting the pre-existing "four" to accurately include Metrics (making it genuinely six, not a
misleading "five") is folded in here rather than left stale, self-approved per the same standard
applied to D3/D6's own scope calls. This is disclosed explicitly, not silently bundled.

## Risks / Trade-offs

- **Pin badge instead of a two-section "Pinned/Recent" list (D3)** is a narrower interpretation of
  the design spec's "pinned/recent pattern" language than a literal two-heading UI would be →
  acceptable: no existing precedent to build a grouped-list variant against, and the ticket's own
  AC2 wording ("shows the 10 most recent conversations plus any pinned ones") is satisfied by the
  server's own ordering rendered faithfully; a richer visual treatment is a natural HEL-665
  refinement once the panel's actual visual design is being worked, not a gap this ticket leaves
  unaddressed.
- **Hand-maintained mobile switch statements (D2)** are the existing pattern's own risk (a future
  section could still forget an arm) — not introduced by this ticket, and TypeScript's `Record`
  exhaustiveness check on `mobileSheetEmptyMessage` already catches the most likely omission class.

## Planner Notes

- Self-approved: pin badge over a new grouped-list component (D3) — smallest change consistent with
  this ticket's own scope boundary (list + selection wiring, not a new list-presentation pattern);
  a two-section list is a reasonable HEL-665 enhancement once real visual design work is underway.
- Self-approved: `ActiveConversationPanel`'s minimal placeholder scope (D6) — directly precedented
  by the ticket's own explicit "chat panel's own visual design is a separate ticket" carve-out.
- Self-approved (design-gate round 1 fix): a small, additive `renderRowAction` prop on
  `SidebarItemList` (D3) — the only viable way to render a genuine sibling pin/unpin control without
  a nested-button/event-bubbling bug; backward-compatible, no existing caller's behavior changes.
- Self-approved (design-gate round 1 fix): correcting `mobile-bottom-nav`'s pre-existing "four"
  destination-count text to accurately include Metrics, while already rewriting this exact block to
  add Chat (D8) — disclosed explicitly here, not silently bundled.

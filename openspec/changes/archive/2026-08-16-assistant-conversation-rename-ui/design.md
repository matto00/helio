# Design: assistant-conversation-rename-ui

## Context

The chat sidebar (`SidebarBody.tsx`, `section === "chat"`) renders conversations via the shared
`SidebarItemList`, with a pin/unpin toggle supplied through the opt-in `renderRowAction` prop (HEL-664).
`assistantConversationsSlice.ts` already has `togglePinned` (calls `updateConversation(id, { pinned })`;
`fulfilled` replaces the matching item in `items`). The service function `updateConversation(id, { title })`
exists and is untested-in-anger only because nothing calls it with a title. The backend PATCH path performs
no blank-title validation (`AssistantConversationRepository.updateTitle` writes any string), so the client
is the only guard. `ActiveConversationPanel` renders `activeConversation.data.title` as its heading.
There is no inline-rename pattern anywhere else in the app to copy; the closest structural precedent is
`SidebarItemList`'s own inline delete-confirm state (`confirmDeleteId` + a per-row swap).

## Goals / Non-Goals

**Goals:**

- A discoverable rename affordance on each chat conversation row, consistent with the existing pin toggle.
- A self-contained inline edit state in `SidebarItemList` that other sections could later opt into.
- Correct keyboard handling (Enter saves, Escape cancels), blank-title rejection, in-flight and error states.
- The active-conversation panel heading reflects a rename immediately.

**Non-Goals:**

- Rename for other sections (dashboards/pipelines/sources/metrics) — mechanism is reusable but not wired.
- Backend validation changes; optimistic updates (we keep togglePinned's server-confirmed update shape).

## Decisions

**D1 — Trigger: a pencil row-action button next to the pin toggle.** The chat section's `renderRowAction`
returns a fragment of two sibling buttons (pencil `Pencil` from lucide-react, size 14, then the existing
pin/pin-off), both `dashboard-list__row-action-btn`, pencil aria-label `Rename ${item.name}`. lucide-react
is already a dependency (`Pin`/`PinOff` imports in this file). Alternative considered: an ActionsMenu
ellipsis entry — rejected; chat deliberately has no ActionsMenu (no delete, HEL-663 D3) and a menu for one
action is heavier than the established row-action pattern.

**D2 — Edit state lives in `SidebarItemList`, triggered via a new second argument to `renderRowAction`.**
`SidebarItemList` gains an opt-in prop `onRename?: (item: SidebarItem, name: string) => Promise<void>` and
internal state `renamingId`/`renameValue`/`renameStatus`/`renameError`. `renderRowAction`'s signature widens
to `(item, helpers: { startRename: () => void }) => ReactNode` — backward compatible (existing callers take
one parameter; extra args are ignored in TS/JS). The pencil's onClick calls `helpers.startRename()`.
Alternative considered: hoisting edit state into `SidebarBody` — rejected; the row swap happens inside
`SidebarItemList`'s markup, so hoisting would need a parallel render-override prop surface (more API for no
reuse benefit) and would duplicate per-row state management the component already does for delete-confirm.

**D3 — Row swap.** When `renamingId === item.id`, the row's selectable button/NavLink and row actions are
replaced by a `TextField` (shared UI primitive, per DESIGN.md §6) pre-filled with the current name,
auto-focused with contents selected, `aria-label` `` `Rename ${item.name}` ``. (Note: this is a full row
swap — a stronger treatment than the existing delete-confirm state, which keeps the row visible and only
adds a Confirm/Cancel panel below it; the structural precedent is per-row-id state, not identical markup.)
The filter input's markup/classes (`DashboardList.css`) are the styling reference; new CSS stays in
`DashboardList.css` next to the row styles it composes with. `.dashboard-list__row-action` currently has no
`gap` between children — the CSS pass must add one so the pencil + pin buttons don't render flush.

**D4 — Commit/cancel semantics.** Enter commits; Escape cancels and restores the previous title. Commit
trims the value first: blank-after-trim never calls `onRename` — the input gets `aria-invalid` and stays in
edit mode (the user can Escape out). A trimmed value identical to the current name cancels without a PATCH
(no-op rename should not touch `updatedAt`, which drives list ordering). Blur cancels — explicit-commit
matches the component's existing explicit Confirm/Cancel delete pattern and makes an accidental mid-edit
click non-destructive. Documented in the component docstring since blur-saves is the other common idiom.

**D5 — In-flight and error state.** `onRename` returns a promise: while pending (`renameStatus: "saving"`)
the input is disabled; on resolve the row exits edit mode; on reject it stays in edit mode, re-enabled, with
a `role="alert"` error line below the row (rendered like the delete-confirm row's warning). `SidebarBody`
supplies `onRename` as `await dispatch(renameConversation({ id, title })).unwrap()` so a rejected thunk
propagates. Errors thus stay visible and inline per DESIGN.md §7 — no toast, no swallowing.

**D6 — Thunk mirrors `togglePinned` exactly, plus one extra reducer concern.**
`renameConversation = createAsyncThunk<AssistantConversationSummary, { id: string; title: string }>` calling
`updateConversationRequest(id, { title })`, rejecting with `extractErrorMessage(err, "Failed to rename
conversation.")` (rename failures need the server's message when available, unlike togglePinned's constant).
`fulfilled`: replace the matching summary in `items` (identical to `togglePinned.fulfilled`) **and**, when
`activeConversation.data?.id === payload.id`, set `activeConversation.data.title = payload.title` so the
panel heading doesn't go stale.

**D7 — Tests follow the existing pin/unpin conventions.** `SidebarBody.test.tsx`: mock
`assistantConversationsService`, `fireEvent` on the pencil, assert `updateConversation` called with
`("conv-1", { title: "New name" })`, assert Enter/Escape/blank/no-op-title/error paths, and assert the
rename action doesn't select the row (mirror of the existing pin-doesn't-select test).
`assistantConversationsSlice.test.ts`: `renameConversation.fulfilled` updates `items` and the matching
`activeConversation` title, and leaves a non-matching `activeConversation` untouched.

## Risks / Trade-offs

- [Widening `renderRowAction`'s signature touches a shared component] → additive, optional second parameter;
  existing callers (chat is the only one today) compile unchanged. Covered by the existing test suite.
- [Blur-cancels may surprise users expecting blur-saves] → deliberate, documented; Enter is the single
  commit gesture and Escape/blur are both non-destructive. Cheap to revisit.
- [Concurrent pin/rename on the same row] → row actions are hidden while the row is in edit mode (D3 swap),
  so the states cannot interleave.
- [Server-ordered list: rename bumps `updatedAt`, so the list may re-order on next fetch] → accepted;
  we do not refetch on rename (matches togglePinned, which also mutates `updatedAt` server-side without
  refetching — consistency with the shipped behavior wins).

## Planner Notes

- Self-approved: widening the shared `renderRowAction` contract (additive), the blur-cancels choice, and
  skipping a no-op PATCH on unchanged titles. No new dependencies, no API/backend changes, no migrations —
  nothing meets the escalation bar (frontend-only, in-scope UI design the ticket explicitly requests).

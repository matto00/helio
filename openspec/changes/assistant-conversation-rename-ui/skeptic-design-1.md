## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Ticket ACs** (`ticket.md`): (1) "A user can rename an existing conversation from the chat
  sidebar." (2) "Follows DESIGN.md; covered by tests matching the existing pin/unpin test
  conventions in `SidebarBody.test.tsx`." Both are directly addressed by design.md's D1-D7 and
  tasks.md §1-4.

- **Backend rename path is real and out-of-scope as claimed.** Read
  `backend/src/main/scala/com/helio/services/AssistantConversationService.scala:120-156` and
  `backend/src/main/scala/com/helio/infrastructure/AssistantConversationRepository.scala:98-103`.
  `rename`/`updateTitle` perform no blank/empty validation — confirms design.md's Context claim
  ("the client is the only guard") and D4's premise that client-side trim/blank rejection is
  load-bearing, not redundant with a server check.

- **`updateConversation(id, { title })` already exists** — read
  `frontend/src/features/assistant/services/assistantConversationsService.ts:21-24,54-63`.
  `UpdateConversationRequest.title?: string` and the PATCH call are already wired; design correctly
  reuses this rather than inventing a new endpoint call.

- **`togglePinned` shape design mirrors** — read
  `frontend/src/features/assistant/state/assistantConversationsSlice.ts:117-127,173-176`.
  Confirms `createAsyncThunk<Summary, {id, pinned}>` → `updateConversationRequest` →
  `fulfilled` replaces the matching `items` entry by `findIndex`. D6's plan (`renameConversation`
  identical shape + an extra `activeConversation.data.title` sync) is a faithful, minimal extension.
  `activeConversation.data: AssistantConversationDetail | null` (types.ts:22-26) extends
  `AssistantConversationSummary` and has a `title: string` field, so `payload.title` assignment
  type-checks.

- **`ActiveConversationPanel` heading source** — read
  `frontend/src/features/assistant/ui/ActiveConversationPanel.tsx:133`:
  `<h2 ...>{activeConversation.data.title}</h2>`. Confirms D6's claim that syncing
  `activeConversation.data.title` on `renameConversation.fulfilled` is sufficient to satisfy the
  AC "the active-conversation panel heading reflects a rename immediately" — no other code path
  needs touching.

- **`SidebarBody.tsx`'s chat `renderRowAction`** (lines 256-273) — confirmed current signature is
  `(item: SidebarItem) => ReactNode` (one param), and the pin/unpin button already uses
  `dashboard-list__row-action-btn` + `aria-label` keyed off `item.name` (which is
  `conversation.title`, line 223-226). D1's plan (pencil as a sibling button before the pin toggle,
  same class, `aria-label` `Rename ${item.name}`) fits this exactly. D2's claim that widening
  `renderRowAction` to accept an optional second `helpers` param is backward-compatible is
  correct TypeScript/JS behavior (existing one-param callers remain assignable; extra args are
  simply unused at the call site).

- **`SidebarItemList.tsx`** (full read) — confirmed `renderRowAction` is rendered as a genuine
  sibling `<span className="dashboard-list__row-action">` next to the selectable
  button/NavLink, inside `dashboard-list__item-row` — supports D2's "no `stopPropagation()`
  needed" claim and the AC scenario "activating rename does not select the conversation"
  (mirrors the existing, already-tested "pin doesn't select" behavior at
  `SidebarBody.test.tsx:313-330`).

- **One factual inaccuracy in design.md (non-blocking):** D3 claims the edit-mode row swap "mirrors
  how the delete-confirm state swaps row content today." Ground truth
  (`SidebarItemList.tsx:179-269`) shows this is not quite accurate — during `isConfirmingDelete`,
  the row's selectable button/NavLink stays rendered and clickable; only the `ActionsMenu` trigger
  is conditionally hidden, and Confirm/Cancel render as an *additional* row below, not a swap of the
  existing row. Design's actual decision (D3: replace the selectable button/NavLink and row actions
  with a `TextField` while `renamingId === item.id`) is still concretely and unambiguously specified
  independent of this mischaracterized precedent, and tasks.md 2.3 restates it in
  implementation-ready terms ("hide the row's select button/NavLink and row actions while
  editing"). This doesn't block implementation but should be corrected in design.md so future
  readers don't cite a precedent that isn't there.

- **TextField supports every prop D3/D5 need** — read `frontend/src/shared/ui/TextField.tsx`:
  extends `InputHTMLAttributes<HTMLInputElement>`, so `aria-label`, `aria-invalid`, `disabled`,
  `autoFocus`, `onKeyDown`, `onBlur`, `value`/`onChange`, and a forwarded `ref` (needed for
  select-all-on-focus) all pass through natively. No gaps.

- **DESIGN.md compliance** — read §5 (Buttons), §6 (Shared components), §7 (UI state patterns),
  §8 (Accessibility). The existing `.dashboard-list__row-action-btn` CSS
  (`DashboardList.css:266-291`, transparent bg, muted text, hover `--app-surface-raised`) already
  matches §5's Ghost-button recipe, so the pencil button reusing that class needs no new button
  style. §6 lists `TextField` and `SidebarItemList` as canonical primitives — D3 reuses `TextField`
  rather than a raw `<input>`, correct. §7's error pattern (visible, `role="alert"`, never
  swallowed) matches D5 exactly. Confirmed `lucide-react`'s `Pencil` icon exists in
  `node_modules/lucide-react/dist/esm/icons/pencil.mjs` — no new dependency needed, as proposal.md
  claims.

- **Test-plan grounding** — read `SidebarBody.test.tsx` (mocking setup lines 1-38, pin tests
  lines 288-331). Confirms the file mocks `assistantConversationsService` module functions
  directly (`updateConversation` is already mocked) and has an existing "pin doesn't select"
  test that is the direct template for the new "rename doesn't select" test (D7 / tasks.md 4.5).
  D7's plan to assert `updateConversation` called with `("conv-1", { title: "New name" })` follows
  the exact assertion style already used for `{ pinned: true }` (line 300-302). This is a realistic,
  executable test plan, not hand-waving.

- **No placeholders/TBDs/deferred decisions found** in proposal.md, design.md, tasks.md, or
  spec.md. Every task in tasks.md cites a specific design.md decision (D1-D7). All 6 spec.md
  scenarios (rename, Escape-cancel, blank-rejected, no-op, error, doesn't-select) map 1:1 to
  tasks 4.2-4.5 and are independently testable.

- **Scope discipline** — proposal.md's Non-goals explicitly excludes generalizing rename to other
  sections, backend validation changes, and header-based rename — all reasonable exclusions that
  keep the change matched to the ticket's stated scope ("Design and implement an inline-rename
  affordance in the chat sidebar's conversation list").

### Verdict: CONFIRM

The design is sound, internally consistent, and traceable to ground truth on every material claim
except the one delete-confirm "row swap" precedent mischaracterization noted above, which doesn't
affect implementability (the actual decision D3 is still stated unambiguously and tasks.md restates
it independent of the incorrect analogy). Both ACs are covered by concrete, testable scenarios that
follow the codebase's existing conventions (pin/unpin thunk shape, `SidebarItemList` per-row state
pattern, `SidebarBody.test.tsx` mocking style). No placeholders, no unresolved decisions blocking
implementation, no scope drift, no missing contract updates (correctly none needed — backend already
ships the endpoint).

### Non-blocking notes

1. design.md D3's claim "This mirrors how the delete-confirm state swaps row content today" is not
   accurate per `SidebarItemList.tsx:179-269` — the delete-confirm state leaves the row's
   selectable button/NavLink visible and only adds a below-row Confirm/Cancel panel; it does not
   swap out the row's primary content. Suggest fixing this sentence during/after implementation so
   the doc doesn't misrepresent the precedent it cites. Does not change D3's actual (correct)
   decision.
2. `.dashboard-list__row-action` currently has no explicit `gap` between children
   (`DashboardList.css:261-264`, just `display: inline-flex`). When the pencil button is added as a
   second sibling inside this span (D1's "fragment of two sibling buttons"), the two 24×24 buttons
   will render flush against each other unless task 2.6's CSS work adds a small gap. Worth calling
   out explicitly in the CSS task so it isn't missed, though it's a one-line fix either way.

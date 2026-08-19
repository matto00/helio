## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Read all five planning artifacts in full: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/mobile-bottom-nav/spec.md`. Cross-checked every factual claim in `design.md`/`proposal.md`
against the actual code, not just the prose:

- **Missing-affordance premise**: confirmed `SidebarItemList.tsx` renders the "+" `IconButton`
  (`icon="+"`, `variant="secondary"`, `size="xs"`, `aria-label={addLabel}`) only when `onAdd` is
  passed, and `SidebarBody.tsx:314-315` wires the chat section's instance with
  `onAdd={() => dispatch(startNewConversation())}` / `addLabel="New chat"`. `.app-sidebar` is
  `display: none` at `max-width: 768px` — confirmed via `App.css`'s existing mobile block. No
  equivalent dispatch site exists in `BottomNav.tsx` (plain `NavLink`s, no secondary-action slot —
  confirmed by reading the full component) or `MobileNavSheet.tsx` (portalled picker list, `onSelect`
  only, no add/create affordance — confirmed by reading the full component). This matches the
  ticket's and proposal's framing exactly.
- **D1 (CommandBar placement) reasoning**: verified against the actual alternatives. `BottomNav.tsx`
  genuinely has no secondary-action slot (just `NavLink` per destination). `MobileNavSheet.tsx` is
  genuinely picker-only (`onSelect`/`onClose`, no add/CRUD prop anywhere in its interface) — and the
  proposal's/design's claim that a CRUD affordance there would violate the existing
  `mobile-dashboard-sheet` spec is correct: `openspec/specs/mobile-dashboard-sheet/spec.md`'s
  "Picker only — no CRUD" requirement explicitly states "The sheet SHALL contain no
  create/rename/delete/duplicate affordances." D1's chosen placement — a sibling `IconButton` next
  to the existing `.app-command-bar__mobile-title` control in `CommandBar.tsx`, gated on
  `pickerId === "chat"` — reuses machinery that is real and already shipped: `pickerIdForPathname`
  (`sections.ts`) returns a `"chat"` `PickerId` for `/chat*` routes, `mobileTitleVisible` in
  `CommandBar.tsx` already gates on `pickerId !== "other"` (true for `"chat"`), and the
  `@media (max-width: 768px)` block in `App.css` already shows `.app-command-bar__mobile-title` only
  below 768px — confirmed by reading both files directly.
- **D2/D3 (reuse `startNewConversation()`, matching `aria-label`)**: `startNewConversation` is a real
  exported action from `assistantConversationsSlice.ts` (`state.startingNewConversation = true`), and
  `ActiveConversationPanel.tsx` genuinely derives `effectiveId = startingNewConversation ? null : ...`
  — confirmed by reading the full component. The desktop trigger's `addLabel="New chat"` is a direct
  string match for the design's proposed mobile `aria-label`.
- **D4 (root-cause investigation) leads are real, not fabricated**: `App.tsx` confirms
  `<ErrorBoundary resetKey=...><Outlet /></ErrorBoundary>` wraps only `<Outlet />` — `CommandBar`,
  `MobileShell`, `QuickLauncherOverlay`, and `RefinementChatDrawer` are all siblings, outside the
  boundary, exactly as design.md claims. `MessageComposer.tsx:118` does call `crypto.randomUUID()`
  inside `handleSubmit`. `Modal.tsx:103` does call `dialog.showModal()`. `ChatPage.tsx` and
  `ActiveConversationPanel.css` do use the `.chat-page`/`.active-conversation-panel` class names D4
  says to inspect with `getComputedStyle`. None of these leads are hand-waved — each is a specific,
  falsifiable check tied to a real code path, with a stated exit condition (fix-or-documented-evidence,
  tasks 2.8/2.9) rather than a bare "investigate and see."
- **Spec delta correctness**: the ADDED requirement in `specs/mobile-bottom-nav/spec.md` states a
  clear, testable contract (visible <768px on `/chat*` only, dispatches `startNewConversation()`,
  hidden ≥768px and off `/chat*`) with three scenarios covering the positive case and both negative
  cases. This is a faithful, minimal delta to the capability the proposal claims to modify.
- **AC traceability**: all four ACs in `ticket.md` map to concrete tasks — AC1→tasks 1.1-1.3, AC2→
  tasks 2.1-2.6, AC3→tasks 2.8-2.9 (explicit "never assert root-caused without it" language), AC4→
  tasks 2.1/2.7 (both specify the real 390×844 viewport). No AC is left uncovered by any task.
- **No placeholders/hand-waving**: grepped and read every artifact in full; no `TODO`/`TBD`/deferred
  decisions found. D1-D4 are each concrete, justified decisions, not open questions.
- **No scope drift**: proposal's Non-goals explicitly exclude desktop changes and new
  `MobileNavSheet` CRUD affordances (correctly cited against the existing spec), and bound the
  root-cause investigation to what's live-testable in this environment with an explicit
  escalation/documentation fallback rather than silent scope expansion or silent closure.
- **Internal consistency**: proposal.md, design.md, tasks.md, and the spec delta all agree on the
  mechanism (CommandBar, `pickerId === "chat"`, `startNewConversation()`) with no contradictions
  across the four documents.

### Verdict: CONFIRM

The design is sound on both halves of this hotfix. D1's placement choice is genuinely reasoned
against the two real alternatives (not a rubber-stamp), correctly defers to the existing
`mobile-dashboard-sheet` "no CRUD in the sheet" spec, and reuses existing, already-shipped gating
machinery rather than inventing new state. D4's root-cause plan is a concrete, testable procedure
tied to real code paths (verified above) with a stated fix-or-document exit condition — not
hand-waving. No placeholder decisions, no AC left uncovered, no contradictions between artifacts, no
unjustified scope drift.

### Non-blocking notes

1. `tasks.md` 3.1 says "Add/update a `CommandBar.test.tsx` case" — no such test file currently
   exists (`find frontend/src -iname "*CommandBar.test.tsx*"` returns nothing), so the executor will
   be creating it fresh rather than updating one. The "Add/update" phrasing already covers this case;
   flagging only so the executor doesn't go looking for a nonexistent file.
2. The exact icon glyph for the new mobile `IconButton` isn't pinned down in tasks.md. `CommandBar.tsx`'s
   other `IconButton`s all use a `FontAwesomeIcon` (comments/wand/sun/moon), while
   `SidebarItemList`'s "+" trigger uses a bare `icon="+"` string. Either is defensible (D1 says
   "matching `SidebarItemList`'s own recipe"), but a `faPlus` FontAwesome glyph would be more visually
   consistent with `CommandBar`'s existing icon-button row. Worth a look at final-gate visual review,
   not blocking here.
3. Environmental note (not a defect in the planning artifacts): this worktree's local, gitignored
   `scripts/concertino/` directory predates `next-report-number.sh`/`persist-evidence.sh`/
   `emit-event.sh` being added to the project's canonical copy — those three scripts are absent from
   `WORKTREE_PATH/scripts/concertino/` (only `assert-phase.sh`/`cleanup.sh`/`README.md`/
   `setup-worktree.sh`/`start-servers.sh` are present, and those five happen to be tracked in git
   despite the directory's `.gitignore` rule, which is why the worktree has them at all). I invoked
   the main checkout's copies of the three missing scripts instead (they resolve `WORKTREE_PATH`
   dynamically via `git rev-parse --show-toplevel`/`--git-common-dir` from the path arguments given,
   not from their own script location, so this produces identical, correct output) rather than
   guessing a fallback filename or skipping evidence discipline.

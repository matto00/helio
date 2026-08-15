## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **Round-1 Change Request 1 (`renderRowAction` viability) — re-verified against the actual
   component, fresh.** Read `frontend/src/shared/chrome/SidebarItemList.tsx` in full (not the prior
   skeptic's narrative). Confirmed structurally:
   - `renderBadge` is invoked inside `renderItemText()` (line 274), which is itself rendered inside
     the row's own `<button onClick={() => onSelect(item)}>` (lines 172-190) when `onSelect` is set
     — exactly as design.md/round-1 describe. Embedding a clickable pin toggle there would indeed
     nest `<button>` inside `<button>` and, without `stopPropagation`, also fire selection.
   - `<ActionsMenu>` (the only other per-row extension point) renders as a **sibling** of that
     button/`NavLink`, inside the shared `dashboard-list__item-row` div (lines 171-223), gated only
     on `onDelete !== undefined && !isConfirmingDelete`.
   - design.md D3 / tasks.md 3.1a now plan a new `renderRowAction?: (item: SidebarItem) => ReactNode`
     prop on `SidebarItemList`, rendered as a sibling of the row button in that same
     `dashboard-list__item-row` div, gated on its own prop rather than `onDelete`. This is exactly
     the same DOM position `ActionsMenu` already occupies, sibling to (not nested in) the row's
     button — genuinely buildable, no nested-button/event-bubbling risk, and additive (existing
     `onDelete`-based callers on sources/pipelines/registry/metrics are structurally unaffected
     since chat never sets `onDelete`). Confirmed accurate, not hand-waved.
   - `proposal.md`'s Impact list now explicitly names `SidebarItemList.tsx` as modified (line 51).
     Task 3.1a exists as a standalone task. Test 4.4a explicitly targets the failure mode round-1
     flagged (pin click must not also select). Change Request 1 is resolved.

2. **Round-1 Change Request 2 (`mobile-bottom-nav` spec-delta framing) — re-verified.** Read the live
   base spec `openspec/specs/mobile-bottom-nav/spec.md`: it currently says "exactly the **four**
   section destinations of the desktop sidebar (`/`, `/sources`, `/pipelines`, `/registry`)". Read
   `frontend/src/shared/chrome/navDestinations.ts`: 5 entries today (Dashboards/Sources/Pipelines/
   Registry/**Metrics**) — confirms Metrics was added to code (HEL-553) but never reflected in this
   spec, a genuine pre-existing gap. `proposal.md`'s Modified Capabilities section (lines 41-46) now
   states this accurately ("corrected from **four**... to **six**... folds in that pre-existing
   spec-sync repair... self-approved, disclosed explicitly (see design.md D8)"), and design.md gained
   D8 making this disclosure explicit. Change Request 2 is resolved.

3. **`openspec validate chat-nav-destination --strict`** — ran it myself, twice (once standalone,
   once again during this review): `Change 'chat-nav-destination' is valid` both times. Reproduced,
   not a fluke.

4. **Wire-shape claims (D5/D7) spot-checked against actual backend code, not re-trusted from
   round 1.** Read `AssistantConversationProtocol.scala`, `AssistantConversationRoutes.scala`,
   `AssistantConversationRepository.scala:130-190`, and `ClaudeModels.scala`. Confirmed: list
   response = `{id, title, pinned, updatedAt}` (no transcript); detail response adds `transcript`;
   `ClaudeToolMessage(role, content: Seq[ClaudeContentBlock])` → spray `jsonFormat2` → wire keys
   `role`/`content`; `ClaudeContentBlock` hand-written formatter discriminates on `"blockType"` with
   values `"text"|"tool_use"|"tool_result"`. All match design.md D5/tasks.md 1.1 exactly.
   `.sortBy(r => (r.pinned.desc, r.updatedAt.desc))` in the repository and `DefaultListLimit = 10` in
   the routes confirm the `pinned DESC, updatedAt DESC` / 10-default claims.

5. **Mobile section-picker mechanics (D2) re-verified against the real files.** Read
   `frontend/src/app/App.tsx` (`breadcrumbLabel`, `mobileSheetItems` switch, `mobileSheetEmptyMessage:
   Record<typeof mobileSection, string>`, `handleMobileSheetSelect` switch) and
   `frontend/src/shared/chrome/SidebarBody.tsx` (`sectionFromPathname`'s return-type union). All four
   are genuinely hand-maintained per-section arms exactly as design.md describes; adding `"chat"` to
   `sectionFromPathname`'s union return type will force a compile error on `mobileSheetEmptyMessage`
   (a `Record` over that exact union) until a `chat:` key is added — confirmed mechanically true, not
   asserted.

6. **Desktop sidebar section pattern (D3/D4) cross-checked against sibling sections.** Read
   `SidebarBody.tsx`'s `sources`/`pipelines`/`metrics`/`registry` branches — each is a simple
   `if (section === "...")` returning one `<SidebarItemList>`. A `chat` branch following the same
   shape (using `onSelect`, no `onDelete`, a `renderBadge`, and the new `renderRowAction`) is a
   straightforward, structurally consistent addition — nothing in the actual component surface
   contradicts the plan.

7. No `TODO`/`TBD`/hand-waving in any of the 5 planning artifacts (re-grepped
   `ticket.md`/`proposal.md`/`design.md`/`tasks.md`/both spec deltas).

8. Confirmed no pre-existing `assistantConversations*` naming collisions anywhere in
   `frontend/src` (`grep -rl` returns nothing) and no existing `frontend/src/features/assistant/`
   directory yet (clean slate, nothing implemented before this design gate, consistent with this
   being a design-only review).

### Non-blocking notes

- `tasks.md` has no explicit line item for registering the new `assistantConversationsReducer` in
  `frontend/src/store/store.ts`'s `configureStore({ reducer: {...} })` (every existing slice —
  `sources`, `metrics`, `pipelines`, etc. — is listed there; the new slice needs the same). This is
  standard, low-ambiguity boilerplate any implementer following D4/D5's "mirror `sourcesSlice.ts`"
  instruction would naturally include (and its omission would be caught immediately by a TS compile
  error / `undefined` state at runtime, not silently shipped) — not blocking, but worth folding into
  task 1.3 or 3.3 for completeness.
- The `mobile-bottom-nav` spec's separate "Every route is escapable via the tab bar" requirement
  block (its "No trapped route" scenario still literally enumerates only `/`, `/sources`,
  `/pipelines`, `/registry`) carries the same pre-existing HEL-553 staleness (missing Metrics) that
  D8 disclosed and fixed for the "Bottom tab bar provides section navigation" block, and this ticket
  doesn't touch that second block. Consistent with D8's own stated scope boundary (only the block
  this delta already rewrites), so not a new gap this ticket introduces — flagging for awareness, not
  requiring a fix here.
- `scripts/concertino/next-report-number.sh`, `persist-evidence.sh`, and `emit-event.sh` are absent
  from this worktree's `scripts/concertino/` (only `assert-phase.sh`/`cleanup.sh`/`.concertino.env`/
  `README.md`/`setup-worktree.sh`/`start-servers.sh` are git-tracked; the newer scripts exist
  untracked in the main checkout at `/home/matt/Development/helio/scripts/concertino/` but a
  worktree checkout doesn't inherit another checkout's untracked files). I invoked the main
  checkout's copy of `next-report-number.sh` (a pure, location-agnostic directory scanner — verified
  by reading its source — taking this worktree's change directory as an argument) to get a
  collision-safe filename rather than guessing one. Orchestrator/tooling maintainers should sync
  these scripts into worktree setup so future rounds don't need this workaround.

### Verdict: CONFIRM

Both round-1 change requests are resolved with real, verifiable mechanisms (not just re-worded
prose): the `renderRowAction` sibling-slot plan is structurally sound against
`SidebarItemList.tsx`'s actual current markup, and the `mobile-bottom-nav` spec delta's "four →
six" framing matches the live spec file. `openspec validate --strict` passes. No placeholders,
contradictions, or scope gaps found in a fresh, independent re-read of all five planning artifacts
and the actual code they reference. Sound enough to implement.

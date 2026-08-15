## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

1. **`navDestinations.ts` + consumers (D1).** Read `frontend/src/shared/chrome/navDestinations.ts`
   (5 entries today: Dashboards/Sources/Pipelines/Registry/**Metrics**), `frontend/src/app/App.tsx`
   (sidebar `nav` maps `navDestinations` directly, lines 449-460), and `BottomNav.tsx` (maps
   `navDestinations` directly, lines 15-30). Confirmed: appending one entry is genuinely sufficient
   for both consumers, zero other edits needed. D1 accurate.

2. **`sectionFromPathname`/mobile switch statements (D2).** Read `SidebarBody.tsx:207-215`
   (`sectionFromPathname` — a hand-maintained union + if-chain) and `App.tsx:78-231`
   (`breadcrumbLabel`, `mobileSheetItems` switch, `mobileSheetEmptyMessage: Record<typeof
   mobileSection, string>`, `handleMobileSheetSelect` switch). All four are genuinely hand-maintained
   per-section arms, exactly as claimed. Confirmed `mobileSheetEmptyMessage`'s `Record` type does
   force a compile-time key add — and additionally (not claimed by design.md, but true) so does
   `mobileSheetItems`'s switch, since it's assigned to an explicitly-typed `const: MobileNavSheetItem[]`
   and TS narrows the switch exhaustively over the literal union. `breadcrumbLabel` and
   `handleMobileSheetSelect` are **not** compiler-forced (plain if-chain / void-returning switch with
   no default) — design.md correctly limits its "TypeScript forces this" claim to the `Record`, so no
   overclaim there. D2 accurate.

3. **`SidebarItemList`'s prop shape (D3).** Read `frontend/src/shared/chrome/SidebarItemList.tsx` in
   full. Confirmed: `onDelete?` is optional and cleanly omittable (renders no `ActionsMenu` when
   unset), `renderBadge?` exists and renders inline next to the item name, and there is genuinely no
   pinned/sort concept (items render in the order passed, filter is name-only). **However**, D3 also
   claims "Pin/unpin is a small icon-button per row (**not** `SidebarItemList`'s own chrome...)" —
   this is not achievable with the component's actual surface as specified. See Change Request 1.

4. **"Redux-selection" pattern (D4).** Read `SidebarBody.tsx`'s `sources`/`registry` branches
   (`onSelect` dispatches `setSelectedSourceId`/`setSelectedTypeId`) and `SourcesPage.tsx:30`
   (`sources.find(s => s.id === selectedSourceId) ?? sources[0] ?? null`) —the exact
   fallback-to-first-item formula design.md D4 describes. Confirmed accurate, and correctly
   distinguished from Pipelines/Metrics' `toHref`-based route-per-item pattern (also verified in
   `SidebarBody.tsx`).

5. **HEL-663 wire shapes (D5/tasks 1.1).** Read
   `backend/src/main/scala/com/helio/api/protocols/AssistantConversationProtocol.scala` and
   `AssistantConversationRoutes.scala`: `GET /` → `AssistantConversationSummaryResponse(id, title,
   pinned, updatedAt)` (no transcript); `GET /:id` → `AssistantConversationResponse(id, title, pinned,
   updatedAt, transcript)` — confirms the list/detail split design.md claims. Read
   `ClaudeModels.scala` (`ClaudeToolMessage(role, content: Seq[ClaudeContentBlock])`,
   `ClaudeContentBlock` = `Text`/`ToolUse`/`ToolResult`) and
   `AssistantConversationRepository.scala:144-188` (hand-written spray formatter, discriminator field
   literally named `"blockType"` with values `"text"|"tool_use"|"tool_result"`). All field names and
   the discriminator exactly match design.md D5/tasks.md 1.1. Also confirmed `ORDER BY pinned DESC,
   updatedAt DESC` and `DefaultListLimit = 10` in the repository/routes, matching the ticket's AC2 and
   the base `openspec/specs/assistant-conversation-persistence/spec.md`. D5/D7 accurate.

6. **`mobile-bottom-nav` spec delta accuracy.** Read the live base spec
   (`openspec/specs/mobile-bottom-nav/spec.md`): it currently says **"exactly the four section
   destinations... (`/`, `/sources`, `/pipelines`, `/registry`)"** — Metrics is not mentioned at all,
   a pre-existing drift from HEL-553 (`git log` confirms HEL-553 added Metrics to
   `navDestinations.ts` without updating this spec). `proposal.md`'s "Modified Capabilities" section
   claims "the tab-bar destination count/list requirement grows from **5** to 6" — this
   mischaracterizes the requirement's actual current text (it says four, not five). The delta's own
   requirement text is fine (it lands correctly on "six," including Metrics), but the proposal's
   accounting of what it is changing is factually wrong and doesn't disclose that this ticket is
   folding in an unrelated, pre-existing spec-sync gap. See Change Request 2.

7. **DESIGN.md UI states for `ActiveConversationPanel` (D6).** Read `DESIGN.md` §7 (loading/empty/error
   requirements) and `EmptyState.tsx` (`variant?: "sidebar"|"main"`, `main` is a real, precedented
   variant — confirmed reused identically in `SourcesPage.tsx`'s own selection-fallback pattern:
   `selected !== null ? <Detail/> : <EmptyState variant="main" .../>`). Confirmed a real "spinner"
   idiom exists in the codebase (`*__spinner` CSS classes in `PanelContent.css`, `auth.css`,
   `RefinementChatDrawer.css`, `AuthoringChatDrawer.css`) — not a single shared component, but a
   real, repeated pattern, so D6's "established spinner pattern" claim is accurate. D6's plan
   correctly applies DESIGN.md's binding states.

8. **`openspec validate chat-nav-destination --strict`** — ran it myself: `Change
   'chat-nav-destination' is valid`.

9. Checked the epic spec (`docs/superpowers/specs/2026-08-14-top-level-assistant-design.md`) — it
   describes `/chat` as "reusing the `SidebarItemList` pinned/recent pattern," which ticket.md
   correctly flags as aspirational/inaccurate (no such pattern exists anywhere in the codebase; only
   the backend's `pinned DESC, updatedAt DESC` ordering exists). design.md D3's narrower "pin badge,
   not a grouped list" response is a reasonable, explicitly self-approved divergence — not a design
   flaw.

10. No `TODO`/`TBD`/hand-waving found in any of the 5 planning artifacts (grep across
    `ticket.md`/`proposal.md`/`design.md`/`tasks.md`/both spec deltas — zero hits).

### Verdict: REFUTE

### Change Requests

1. **D3's "per-row pin/unpin icon-button" has no viable rendering mechanism given
   `SidebarItemList`'s actual prop surface — resolve before implementation starts.**
   `frontend/src/shared/chrome/SidebarItemList.tsx` exposes exactly two per-row extension points:
   the row's own selectable element (a `<button onClick={() => onSelect(item)}>` when `onSelect` is
   set — which D3 selects for chat) and, **only when `onDelete` is set**, a sibling `<ActionsMenu>`
   rendered next to that button (lines 211-222). D3 explicitly opts out of `onDelete` ("no `onDelete`
   prop is passed") and explicitly frames the pin/unpin button as "not `SidebarItemList`'s own
   chrome" — implying it needs a new rendering path — yet:
   - `proposal.md`'s Impact section lists only `navDestinations.ts`, `SidebarBody.tsx`, `App.tsx` as
     modified files; `SidebarItemList.tsx` appears nowhere.
   - `tasks.md` 3.2 scopes this work to "a `chat` branch in `SidebarBody.tsx`" — a *consumer* of
     `SidebarItemList`, which cannot inject a new sibling per-row element into that component's
     internal `<li>` markup without the component itself exposing a new prop/slot.
   - The only other extension point, `renderBadge`, renders *inside* `renderItemText()`, which is
     itself rendered inside the row's own `<button>` (since chat uses `onSelect`, not `toHref`).
     Embedding a clickable pin toggle there nests a `<button>` inside a `<button>` — invalid HTML —
     and, absent an explicit `stopPropagation()` (unaddressed anywhere in design.md/tasks.md), a
     click on "pin" would also fire `onSelect` and select the conversation, a real functional bug
     test 4.4 as written would not catch (it only asserts the `PATCH` fires and the badge appears,
     not that selection didn't also fire).

   A competent implementer hits this immediately and has to make an unplanned call: silently extend
   a shared component used by 4 other existing sections (sources/pipelines/registry/metrics — real
   blast radius, contra CLAUDE.md's "avoid unrelated refactors unless requested"), or ship the
   nested-button/event-bubbling bug. Resolve in design.md before execution: either (a) explicitly
   plan a `SidebarItemList.tsx` prop addition (e.g. a `renderRowAction` slot rendered as a *sibling*
   of the row button, mirroring `ActionsMenu`'s existing placement) and add it to `proposal.md`'s
   Impact list and a `tasks.md` item, or (b) if the badge-embedded-button route is intentional,
   specify it explicitly plus the required `stopPropagation()` and add a task/test asserting a pin
   click does not also select the conversation.

2. **`proposal.md`'s "Modified Capabilities" section misstates the base spec it's changing — correct
   and self-approve the fold-in.** It states the `mobile-bottom-nav` destination requirement "grows
   from 5 to 6 (Chat added)." The live spec (`openspec/specs/mobile-bottom-nav/spec.md`) currently
   says **"exactly the four section destinations... (`/`, `/sources`, `/pipelines`, `/registry`)"** —
   Metrics was never added to this requirement (a pre-existing HEL-553 spec-sync gap; `navDestinations.ts`
   already has 5 entries including Metrics, but this spec file was never updated). The delta's actual
   MODIFIED requirement text happens to land correctly on "six" (including Metrics + Chat), so the
   functional outcome is fine — but the proposal's own accounting of the change is factually wrong,
   and nowhere does this change disclose that it is folding an unrelated, pre-existing spec-drift fix
   (documenting Metrics for the first time) in alongside adding Chat. Fix `proposal.md` to state the
   base accurately ("four", pre-dating Metrics) and add an explicit self-approval note (matching the
   convention design.md already uses for D3/D6's own scope calls) that repairing this stale spec text
   is in scope here since this delta touches the same requirement regardless.

### Non-blocking notes

- `ActiveConversationPanel`'s planned `EmptyState variant="main"` call needs concrete
  `icon`/`title`/`description` values (all required props on `EmptyState`) — reasonable to leave to
  implementation-time judgment, no design-level ambiguity there.
- No task/test explicitly verifies `breadcrumbLabel`'s new `/chat` branch (only the desktop `NavLink`
  itself is tested, per task 4.2) — low risk given it's a one-line, explicitly-listed task item, but
  worth a one-line addition to the test list for completeness.

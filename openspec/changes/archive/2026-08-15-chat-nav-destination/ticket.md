# HEL-664: Chat nav destination + conversation list UI

## Description

Part of HEL-659's top-level assistant. Today's nav (`navDestinations.ts`) has Dashboards/Data
Sources/Data Pipelines/Type Registry/Metrics; there's no chat destination — `AuthoringChatDrawer`
lives inside the Dashboards sidebar instead. See
`docs/superpowers/specs/2026-08-14-top-level-assistant-design.md`.

Depends on the conversation-persistence ticket (HEL-663, merged) for its list/pin API.

## Scope

* New `/chat` route + nav entry in `navDestinations.ts`.
* Conversation list reusing the `SidebarItemList` pinned/recent pattern (heading, filter, pin/unpin,
  delete) already used for dashboards/sources/etc.
* Selecting a conversation loads its transcript into the active chat panel (chat panel's own visual
  design is a separate ticket — this ticket wires the list + selection, not the message-rendering
  UI).

## Acceptance Criteria

- [ ] `/chat` is reachable from the main nav and mobile bottom nav, matching the existing section
      pattern (desktop sidebar + `MobileNavSheet` stay in sync, no forked state — per the
      established mobile-pwa convention).
- [ ] The list shows the 10 most recent conversations plus any pinned ones, pin/unpin works, and
      selecting a conversation loads the right transcript.
- [ ] No regression to the existing Dashboards/Sources/Pipelines/Registry/Metrics nav sections.

## Context / Notes

- Parent epic: HEL-659. Fifth of 8 child tickets; delivery order 660→661→662→663 (all merged) → 664
  (this ticket) → 665 → 666 → 667. First frontend-facing ticket in the batch.
- **Research finding: "reusing the `SidebarItemList` pinned/recent pattern" is aspirational, not
  descriptive** — no existing section builds pinned/recent grouping on top of `SidebarItemList`
  anywhere in this codebase (it's a plain, unordered list component; only the *backend* ordering
  `pinned DESC, updatedAt DESC` exists, from HEL-663). This ticket is the first to add pin-aware
  presentation on top of it — see design.md for the chosen approach (respect server order + a pin
  badge, not a new two-section list component).
- **Research finding: mobile section-picker sync is NOT automatic.** The top-level nav tab
  (`navDestinations.ts` → desktop sidebar + `BottomNav`) picks up a new entry automatically, but the
  **item-list picker inside `MobileNavSheet`** (which conversation to view on phone) requires
  explicit parallel edits in `SidebarBody.tsx` (`sectionFromPathname`) and `App.tsx` (`mobileSheetItems`,
  `mobileSheetEmptyMessage`, `handleMobileSheetSelect`, `breadcrumbLabel`) — exactly the pattern
  every existing section (sources/pipelines/registry/metrics) already follows. AC1's "no forked
  state" requirement is about outcome parity (both surfaces show the same conversations,
  consistently), not about needing zero new code in the mobile path.
- **Scope boundary (self-approved, see design.md): this ticket builds a minimal placeholder for
  the "active chat panel"** — loads and holds the selected conversation's transcript in state,
  renders enough to verify the right data loaded (title, message count) — not the actual
  message-rendering/chat-bubble UI, which is HEL-665's job ("chat panel's own visual design is a
  separate ticket"). No message-composer/send-a-message UI either — `AssistantService.converse`
  (HEL-662) has no live route yet regardless.

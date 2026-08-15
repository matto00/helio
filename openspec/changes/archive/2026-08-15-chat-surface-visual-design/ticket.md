# HEL-665: New chat surface visual design (UI design pass against DESIGN.md)

## Description

Part of HEL-659's top-level assistant. The current `AuthoringChatDrawer` UI is explicitly not being
ported as-is — "not thrilled about the design, it will definitely need an upgrade." This ticket is
the actual UI design pass, separate from the plumbing tickets.

## Scope

* Design the message list/composer UI for the new chat surface: message bubbles/turns,
  streaming-response rendering, tool-call/search progress indication (e.g. "looking at your
  pipelines..."), proposal hand-off affordance into the existing Proposal Review UI.
* Design the inline quick-launcher's visual treatment (floating bubble vs. command-bar icon vs.
  keyboard shortcut — open question in the spec, resolve here).
* Follow `DESIGN.md` (tokens, spacing/type scales, shared components, UI state patterns) — binding
  for all frontend work per CLAUDE.md.
* Should read as one coherent design across both entry points (nav page and inline launcher render
  the same underlying conversation).

## Acceptance Criteria

- [ ] Design covers both entry points (Chat nav page, inline quick-launcher) as one coherent visual
      system, reviewed against DESIGN.md's tokens/components.
- [ ] Design explicitly covers the tool-call/search progress state (the user should see *something*
      happening during a multi-hop lookup, not a silent pause) and the propose→review hand-off
      moment.
- [ ] Design is approved before the entry-point-wiring ticket implements it.

## Context / Notes

- Parent epic: HEL-659. Sixth of 8 child tickets; delivery order 660→661→662→663→664 (all merged) →
  665 (this ticket) → 666 → 667.
- **`TICKET_TYPE` resolution (CON-100 mechanism, applied strictly): `feature`, not `design`.** No
  `type:design` label is present, and the title does not begin with the literal `[DESIGN] ` prefix
  — the mechanism is deliberately narrow (exact label or exact title prefix, never a content-sniff),
  so this ticket runs the ordinary feature pipeline despite its content clearly describing a
  design-pass deliverable.
- **What "design pass" means concretely in this codebase (self-approved interpretation, see
  design.md Planner Notes): real, tested, DESIGN.md-compliant React/CSS components — not a written
  spec/mockup document.** This codebase has no external design-tool artifact convention anywhere
  (confirmed at planning time); `DESIGN.md` itself is an implementation-level token/component
  standard, and AC1/AC2 describe concrete rendering requirements (message bubbles, progress
  indication, hand-off) only verifiable against real, running components. AC3's "approved before
  the entry-point-wiring ticket implements it" gate is satisfied by this workflow's own two-skeptic-
  gate structure (design-soundness before Execution, final gate before Delivery) — the existing
  mechanism this project already uses for "is this frontend work DESIGN.md-compliant," not a new,
  separately-invented approval step.
- **Buildable-now vs. deferred scope boundary**: HEL-664 already loads a conversation's REAL,
  complete transcript (`ClaudeToolMessageDto[]`, including any historical `tool_use`/`tool_result`
  blocks) into Redux state — retrospective message-bubble rendering, tool-call indication, and a
  proposal hand-off affordance (detecting a `propose_*` tool's result in that transcript) are all
  buildable and testable against real, already-shipped data. **Live** streaming (token-by-token
  reveal while Claude is still "thinking") has no data source to drive it yet — `AssistantService`
  (HEL-662) has no live route. This ticket builds the streaming-capable *component* (so a later,
  route-wiring ticket can drive it live) but cannot wire it to a real live stream — that dependency
  doesn't exist yet, mirrored explicitly in design.md.
- **Quick-launcher open question, resolved**: a command-bar icon-button trigger (reusing the exact
  `.topbar-theme-btn` recipe the theme-toggle button already uses, unconditionally, in
  `.app-command-bar__right`, which renders on every authenticated route since `AppShell` wraps them
  all — NOT the "Refine with AI" button, which is gated to the dashboard view with a dashboard
  selected, a design-gate round-1 correction to this ticket's own earlier draft) plus a keyboard
  shortcut, opening a DESIGN.md-canonical `Modal` (not `usePortalPopover`, whose small-dropdown
  anchoring model doesn't fit a conversation panel) — not a floating bubble. This codebase has zero
  precedent anywhere for a persistent floating overlay element; the command-bar icon slot is the
  established, consistent pattern already used for the one genuinely always-available icon button,
  see design.md D6/D7 for the full rationale. The overlay shows the active conversation only (a
  "Browse all conversations →" link reaches the full list, which stays `/chat`-only sidebar chrome
  per HEL-664 — reaching into that route-gated list from a portalled overlay would be real,
  unscoped architectural work).
- Explicitly **not** in scope: retiring `AuthoringChatDrawer` or its "magic wand" mount point in
  `DashboardList.tsx` (HEL-666's job); wiring a live send-message flow (no live route exists yet).

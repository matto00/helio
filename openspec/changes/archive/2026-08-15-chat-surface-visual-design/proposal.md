## Why

`ActiveConversationPanel` (HEL-664) is a deliberate placeholder — title + message count only. The
old `AuthoringChatDrawer` has no role-based message differentiation, no per-tool-call progress
indication (one global indeterminate spinner for an entire multi-step call), and no reusable
streaming-text pattern. HEL-659's chat surface needs real, DESIGN.md-compliant message UI before any
later ticket can wire a live entry point to it.

## What Changes

- Replace `ActiveConversationPanel`'s placeholder body with real message-turn rendering: role-based
  bubbles (user vs. assistant, distinct alignment/surface per DESIGN.md's token set — a real gap the
  old drawer never had), rendered from the already-loaded (HEL-664) `ClaudeToolMessageDto[]`
  transcript.
- Add per-`tool_use` progress-indicator rendering (e.g. "Looked up: find(...)" / "get_resource(...)")
  with its paired `tool_result` folded in as a small, non-raw-JSON summary disclosure — a real
  improvement over the old drawer's single global spinner, buildable now against real historical
  transcript data.
- Add a reusable `StreamingText` component (incremental reveal + a blinking-cursor affordance) —
  built and tested against mock incremental data; **not wired to a live source this ticket** (no
  live route exists yet).
- Add a proposal hand-off affordance: detect a successful `propose_*` tool's result in the
  transcript, parse it back into a typed proposal, and offer a "Review proposal" action reusing the
  *existing* `navigate("/proposals/review", { state: { proposal } })` mechanism
  `AuthoringChatDrawer` already uses — no new hand-off machinery invented.
- Add a quick-launcher: a command-bar icon-button trigger (mirrors the existing, genuinely
  always-visible theme-toggle button's exact recipe) plus a keyboard shortcut, opening a
  DESIGN.md-canonical `Modal` overlay (via the existing `OverlayProvider`/`useOverlay` primitive)
  rendering the *same* `ActiveConversationPanel` the `/chat` nav page renders, plus a "Browse all
  conversations →" link to `/chat` for the full list — resolves the design spec's open question
  against real codebase precedent, not a floating bubble.
- No backend changes; no wiring of a live send-message flow; no retirement of `AuthoringChatDrawer`.

## Capabilities

### New Capabilities

- `chat-message-rendering`: role-based message bubbles, tool-call progress indication, streaming
  text component, and the proposal hand-off affordance.
- `chat-quick-launcher`: the command-bar-triggered overlay entry point, rendering the same
  conversation surface as the `/chat` nav page.

### Modified Capabilities

(none — `assistant-chat-nav` (HEL-664) is extended by giving `ActiveConversationPanel` a real body,
but its own requirements, already-shipped and unchanged, don't need a delta)

## Impact

- `frontend/src/features/assistant/ui/`: `ActiveConversationPanel.tsx` (body replaced),
  new `MessageTurn.tsx`, `ToolCallIndicator.tsx`, `StreamingText.tsx`, `ProposalHandoff.tsx`.
- `frontend/src/features/assistant/` (new): `proposalExtraction.ts` (pure helper: transcript →
  typed `AssistantProposal | null`).
- `frontend/src/app/App.tsx`, `App.css`: new quick-launcher trigger button in
  `.app-command-bar__right` (mirrors the theme-toggle button's recipe, not "Refine with AI" — see
  design.md D7), mounting the new overlay component; global `Cmd/Ctrl+K` keydown handling.
- `frontend/src/features/assistant/ui/QuickLauncherOverlay.tsx` (new): a `Modal`-based (DESIGN.md
  §6 canonical primitive, size `lg`) overlay shell rendering `ActiveConversationPanel` directly
  (not a shared-list extraction — `ChatPage.tsx` has no list to extract, see design.md's Context
  correction) plus a link to `/chat`.
- `frontend/src/shared/chrome/SidebarBody.tsx` is **not** touched — the conversation list stays
  exactly where HEL-664 built it, `/chat`-only sidebar chrome, unmodified by this ticket.
- No backend changes; no schema changes.

## Non-goals

- No live streaming wiring (no live route exists yet).
- No live send-a-message UI/action (same reason).
- No retirement of `AuthoringChatDrawer`/its `DashboardList.tsx` mount point (HEL-666).

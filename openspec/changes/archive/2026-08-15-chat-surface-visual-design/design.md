## Context

`ActiveConversationPanel` (HEL-664) renders only a title + message count from the already-real
`activeConversation.data.transcript: ClaudeToolMessageDto[]` (discriminated `blockType:
"text"|"tool_use"|"tool_result"`). `AuthoringChatDrawer`'s existing turn UI (`.authoring-drawer__turn`)
has **no role-based differentiation** — user and assistant turns share one flat card style, only the
label text ("You"/"Assistant") differs (confirmed by reading the `.tsx`/`.css` directly). Its only
"progress" UI is one global indeterminate spinner (`.authoring-drawer__progress`/`__spinner`) for an
entire multi-step call — no per-step detail. `useDashboardAuthoringStream`'s `progressText` is
plumbed but deliberately **never rendered** (its own doc comment: raw incomplete JSON, not prose).
Proposal hand-off today is `navigate("/proposals/review", { state: { proposal } })` — only
`DashboardProposal` has a review destination (`ProposalReviewPage.tsx`); `PatchSetReviewPage.tsx`
separately expects `location.state.patchSet: PatchSet`. **No frontend review page exists yet for
`PipelineProposal`/`CombinedProposal`** (confirmed — no such file anywhere in `frontend/src/`). No
floating/persistent overlay pattern exists anywhere in this codebase. `.app-command-bar__right`
itself is unconditionally rendered by `AppShell` on every authenticated route, but its one existing
AI-related button ("Refine with AI") is **not** an always-available precedent — it's gated to
`onDashboardView && selectedDashboard !== null` (design-gate round 1 finding). The genuinely
unconditional button using the same `.topbar-theme-btn` recipe is the **theme-toggle button**
(`App.tsx`, no route guard) — that is the real precedent for an always-visible command-bar icon.
`OverlayProvider`/`useOverlay` (single-active-overlay + Escape) and `usePortalPopover` (trigger
positioning) exist, but every one of `usePortalPopover`'s 5 real callers (`ActionsMenu`, `UserMenu`,
`Select`, `AllowedDimensionsPicker`, `DashboardAppearanceEditor`) is a small, trigger-rect-anchored
dropdown — not shaped for a scrollable message thread. DESIGN.md §6's canonical `Modal` (sizes
sm/md/lg up to 720px, native `<dialog>`, ESC + backdrop-click-close already built in) is the
documented primitive for exactly this kind of overlay ("Use these; do not hand-roll equivalents") —
confirmed by reading `Modal.tsx` directly.

**Critical correction (design-gate round 1 finding): `ChatPage.tsx` contains no conversation list at
all.** It is 31 lines, rendering only a loading/error wrapper around `<ActiveConversationPanel />`.
The conversation list itself lives in `SidebarBody.tsx`'s route-gated `section === "chat"` branch —
persistent sidebar chrome, built there deliberately by HEL-664's own design.md D3, only rendering
when the route literally starts with `/chat`. A portalled overlay cannot reach into that route-gated
branch. This means the quick-launcher's shared piece with the nav page is **not** a list+panel
composition (there is no such composition to extract) — it's `ActiveConversationPanel` itself, which
HEL-664 already built and this ticket gives real content (D1-D4 below). See D5/D7 for the corrected
design.

## Goals / Non-Goals

**Goals:**
- Real, DESIGN.md-token-based message-turn rendering with genuine role differentiation.
- Per-tool-call progress indication, buildable now against real (retrospective) transcript data.
- A streaming-capable component, built and tested, not yet live-wired.
- A proposal hand-off affordance reusing existing review-page destinations, honest about the ones
  that don't exist yet.
- A quick-launcher resolving the design spec's open question with real codebase precedent.

**Non-Goals:**
- No live streaming wiring, no live send-message UI (no live route exists).
- No new `PipelineProposal`/`CombinedProposal` review page (out of scope; a future ticket's job).
- No `AuthoringChatDrawer` retirement (HEL-666).

## Decisions

**D1 — Message turns: role-based bubbles, a real gap the old drawer never had.** New
`MessageTurn.tsx` renders each `ClaudeToolMessage` as a bubble: `role === "user"` → right-aligned,
`--app-accent-surface` wash, `--app-accent-mid` border; `role === "assistant"` → left-aligned,
`--app-surface-soft` background, `--app-border-subtle` border. Both: `--app-radius-lg`,
`--text-sm` body, `--space-3` padding, `.authoring-drawer__turn-role`'s existing mono-eyebrow label
recipe kept (already DESIGN.md-compliant) for the role label above each bubble. `Text` content
blocks render as `white-space: pre-wrap` prose (mirrors `.authoring-drawer__turn-text` exactly,
which is itself already correct).

**D2 — Tool-call progress: one row per `tool_use`, paired `tool_result` folded in as a disclosure.**
`ToolCallIndicator.tsx` renders each `tool_use` block as `"<verb>: <name>(<compact input>)"` (e.g.
`"Searching: find(query: \"revenue\")"`) with a small icon, `--app-surface-soft` pill,
`--text-xs`/`--font-mono` (matches DESIGN.md's "mono for data" rule) — genuinely improves on the old
drawer's single global spinner by surfacing every hop distinctly. The paired `tool_result` (matched
by `toolUseId`) renders as a collapsed one-line summary ("Found 3 results" / the raw `content`
truncated) behind a disclosure toggle — never raw JSON dumped inline; `isError: true` results render
with `--app-error`/`--app-error-surface` intent styling, matching DESIGN.md §7's error-state
requirement.

**D3 — `StreamingText.tsx`: built, tested against mock data, not live-wired.** A small component
accepting a `chunks: string[]` prop (or an async iterable in tests), revealing text incrementally
with a blinking-cursor affordance (`--app-accent` colored, `1px` wide, `~1s` blink via
`--app-transition`-scaled keyframes, respecting `prefers-reduced-motion`) — the first incremental-
reveal pattern in this codebase (confirmed no precedent exists). This ticket's own tests drive it
with scripted mock chunk arrays; wiring it to `useDashboardAuthoringStream`-style real SSE deltas is
explicitly a later, route-wiring ticket's job (no live route exists for the new assistant yet).

**D4 — Proposal hand-off: reuse existing destinations, be honest about the ones that don't exist.**
`proposalExtraction.ts` (pure function): scans a transcript for a `tool_use` block whose `name` is
one of the 4 `propose_*` tools, paired with a non-error `tool_result`, and returns a discriminated
`{kind: "dashboard"|"pipeline"|"combined"|"patch", raw: string}` (or `null`). `ProposalHandoff.tsx`
renders a "Proposal ready" card: for `kind === "dashboard"`, parses `raw` as `DashboardProposal`
(existing frontend type — imported from `../../dashboards/types/proposal`, since `ProposalHandoff.tsx`
lives in `features/assistant/ui/` and the type is defined under `features/dashboards/types/`;
design-gate round 1 fixed an incorrect copy-pasted path here) and a "Review proposal" button
navigates `("/proposals/review", { state: { proposal } })` — the *exact* existing mechanism
`AuthoringChatDrawer` already uses, no new hand-off machinery. For `kind === "patch"`, parses as
`PatchSet` and navigates `("/patch-sets/review", { state: { patchSet } })`, matching
`PatchSetReviewPage`'s real expected shape. For `kind === "pipeline"`/`"combined"`, the card renders
informationally ("This proposal type doesn't have a review page yet") with **no navigation
button** — an honest scope limit, not a broken link, since building `PipelineProposal`/
`CombinedProposal` review UI is a real, separate, unscoped piece of work this ticket does not
invent.

**D5 — The quick-launcher shows the active conversation only, not a second copy of the list
(design-gate round 1 fix — corrects a false premise that `ChatPage.tsx` had a list to extract, and
resolves the layout ambiguity in the same stroke).** "One coherent design" per AC1 is satisfied by
both entry points rendering the *same* `ActiveConversationPanel` component (this ticket's own real
work — D1-D4's message bubbles, tool-call indicators, streaming, hand-off) reading the *same*
`state.assistantConversations` Redux slice — not by duplicating or reaching into `SidebarBody.tsx`'s
route-gated list. The quick-launcher deliberately does **not** attempt to render the pinned/recent
conversation list (that remains `/chat`-only sidebar chrome, HEL-664's existing, unmodified
territory) — instead, a "Browse all conversations →" link inside the overlay navigates to `/chat`
for that. This rescopes AC1's "one coherent visual system" to mean: the *message-rendering* surface
(this ticket's actual subject matter) is identical in both places, not that every UI element
(including the list) is literally duplicated into a small overlay.

**D6 — Quick-launcher overlay: DESIGN.md's canonical `Modal`, size `lg`, not `usePortalPopover`.**
`usePortalPopover`'s trigger-rect-anchored small-dropdown model (every one of its 5 real callers is
a menu/select, never a scrollable message thread) doesn't fit a conversation panel — design-gate
round 1 correctly flagged this as unresolved. `Modal` (`shared/ui/Modal`, size `lg`, native
`<dialog>`, ESC + backdrop-click-close already built in) is DESIGN.md §6's own documented primitive
for exactly this shape of overlay ("Use these; do not hand-roll equivalents"), and is what
`QuickLauncherOverlay.tsx` renders: `<Modal size="lg" onClose={...}><ActiveConversationPanel />
<Link to="/chat">Browse all conversations →</Link></Modal>`.

**D7 — Trigger: command-bar icon button (theme-toggle button is the real always-available precedent,
not "Refine with AI" — design-gate round 1 correction) + keyboard shortcut, not a floating bubble.**
Resolves the design spec's open question. A new button in `.app-command-bar__right` (mirrors the
theme-toggle button's `.topbar-theme-btn` recipe exactly — same control-height token, same
hover/border treatment, genuinely unconditional per `AppShell` wrapping every authenticated route) —
directly satisfies "a single persistent affordance in the app command bar, available on every
screen" from the epic spec, using a slot and recipe that already exists rather than inventing a new
floating-element paradigm this codebase has zero precedent for. Bound to a keyboard shortcut
(`Cmd/Ctrl+K`, the conventional "quick open" binding) as an additive, low-cost second trigger.
Clicking or triggering opens `QuickLauncherOverlay` via `useOverlay()` (the existing single-
active-overlay primitive, unaffected by the D6 correction — `useOverlay` is orthogonal to which
positioning/rendering mechanism the opened content itself uses).

## Risks / Trade-offs

- **`Cmd/Ctrl+K` may collide with a browser/OS-level binding in some contexts** → accepted, standard
  convention (command palettes across many apps use this binding); `event.preventDefault()` inside
  the app shell is standard practice for this exact case.
- **Pipeline/Combined proposal hand-off has no review destination (D4)** → an honest, disclosed
  scope limit, not a defect; the informational card states this plainly rather than routing to a
  broken/nonexistent page or silently hiding the proposal.
- **`StreamingText` has no live consumer this ticket (D3)** → acceptable, matches the epic's own
  staged delivery order; the component is fully tested against mock data so a later route-wiring
  ticket integrates it, not builds it from scratch.
- **The quick-launcher's rescoped omission of the conversation list (D5, design-gate round 1 fix)**
  — a user opening the overlay sees only the active conversation, not a way to switch conversations
  without first navigating to `/chat` → accepted: reaching into `SidebarBody.tsx`'s route-gated list
  from a portalled overlay is real, unscoped architectural work no part of this ticket's text asks
  for; "Browse all conversations →" is a low-friction escape hatch, and a richer in-overlay switcher
  is a reasonable future enhancement once there's real usage feedback.

## Planner Notes

- Self-approved: "design pass" == real, tested components, not a written spec document (see
  ticket.md's Context/Notes for the full reasoning) — the interpretive call this whole ticket rests
  on, stated explicitly here and in ticket.md so it's visible at both the plan and requirements
  level, not just once. **Residual ambiguity, flagged rather than treated as fully closed
  (design-gate round 1 non-blocking note):** AC3's "Design is approved before the entry-point-wiring
  ticket implements it" is satisfied here by this workflow's own two-skeptic-gate structure — but
  the ticket quotes the human author's own strong opinion on the old design ("not thrilled... will
  definitely need an upgrade"), and the epic spec frames HEL-666's eventual cutover as a hard,
  non-parallel "big-bang replacement" retiring `AuthoringChatDrawer` outright. There's a reasonable
  chance "approved" was meant to gesture at an actual human glance at the shipped result before
  HEL-666 makes this the sole entry point, not only an automated CONFIRM. Recommending (not
  requiring, since this is a process note, not a code change) that the orchestrator surface the
  shipped PR/screenshots for a human look before HEL-666 begins, alongside the ordinary PR review.
- Self-approved: mounting the quick-launcher trigger for real in `.app-command-bar__right` (D7),
  rather than only building an isolated, unmounted component — makes AC1's "reviewed against
  DESIGN.md" concretely verifiable live (Playwright), and is a small, low-risk, already-precedented
  integration point (the identical slot/recipe the existing theme-toggle button already occupies).
- Self-approved: scoping the proposal hand-off to be honest about missing Pipeline/Combined review
  destinations (D4) rather than inventing new review-page UI for them — that is a real, separate,
  unscoped body of work no part of this ticket's text asks for.
- Self-approved: choosing `Modal` (D6) over `usePortalPopover` once the quick-launcher's actual
  content (a conversation panel, not a menu) was correctly identified — DESIGN.md §6 names `Modal`
  as the canonical primitive for exactly this shape, and reaching for it instead of hand-rolling a
  bespoke overlay is the standard this repo's own binding frontend document sets.

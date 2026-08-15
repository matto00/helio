## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and both spec deltas
  (`specs/chat-message-rendering/spec.md`, `specs/chat-quick-launcher/spec.md`) in full.
- Read `docs/superpowers/specs/2026-08-14-top-level-assistant-design.md` (canonical epic design
  spec) in full.
- Read `DESIGN.md` in full.
- Fetched HEL-665 from Linear directly (`mcp__linear__get_issue`): `labels: []`, title
  `"New chat surface visual design (UI design pass against DESIGN.md)"` — confirms no `type:design`
  label and no literal `[DESIGN] ` title prefix, matching ticket.md's mechanical `TICKET_TYPE`
  claim. Cross-checked the CON-100 mechanism text itself in
  `.claude/agents/concertino-orchestrator.md:183-193` — the "exact label or exact title prefix,
  never a content-sniff" rule is accurately quoted.
- Ran `openspec validate chat-surface-visual-design --strict` → `Change 'chat-surface-visual-design'
  is valid`.
- Read `frontend/src/features/dashboards/ui/AuthoringChatDrawer.tsx` and `.css` in full — confirmed
  the claimed lack of role-based bubble differentiation (the `authoring-drawer__turn--${role}`
  modifier class exists in markup but has **no corresponding CSS selector anywhere** in
  `AuthoringChatDrawer.css`; `.authoring-drawer__turn` styling is one flat rule) and the
  single-global-spinner progress pattern (`.authoring-drawer__progress`/`__spinner`, one instance,
  no per-tool-call breakdown).
- `grep -rn "PipelineProposal\|CombinedProposal" frontend/src` → zero matches anywhere in
  `frontend/src/`, confirming design.md's claim that no review page/type exists for these yet.
- Read `ProposalReviewPage.tsx` (expects `location.state: {proposal?: DashboardProposal,
  authoringRequestId?: string}`) and `PatchSetReviewPage.tsx` (expects `location.state: {patchSet?:
  PatchSet}`) — both match design.md D4's claimed shapes.
- Read `OverlayProvider.tsx` (`useOverlay()` → `{isActive, open, close}`, single-active-overlay +
  global Escape) and `usePortalPopover.ts`, plus its 5 real callers (`ActionsMenu`, `UserMenu`,
  `Select`, `AllowedDimensionsPicker`, `DashboardAppearanceEditor`) — all are small,
  trigger-rect-anchored dropdown/menu panels.
- `grep -rli "floating\|fab-"` + a `position: fixed` sweep across `frontend/src` (excluding
  drawer/sheet/modal/popover/toast/backdrop matches) → no floating-bubble/FAB pattern found anywhere,
  confirming design.md's claim.
- Read `App.tsx` (lines 342-450) and `App.css` (lines 60-150) — confirmed `.app-command-bar__right`
  itself always renders (inside `AppShell`, the layout route wrapping all authenticated routes), but
  **the "Refine with AI" button specifically does not** — see Change Request 2.
- Read `ChatPage.tsx`, `ChatPage.css`, `ChatPage.test.tsx`, `ActiveConversationPanel.tsx`, and
  `SidebarBody.tsx` in full, and cross-checked against HEL-664's own archived
  `openspec/changes/archive/2026-08-15-chat-nav-destination/design.md` — see Change Request 1 (major
  finding).
- Read `Modal.tsx` (`frontend/src/shared/ui/Modal.tsx`) — DESIGN.md §6's canonical modal primitive.

### Verdict: REFUTE

### Change Requests

1. **[MAJOR — blocking] D5/D7's `ChatSurface` extraction rests on a premise that is factually false
   against real source, and the `chat-quick-launcher` spec delta locks in the same false premise.**
   `design.md` D5 says: *"achieved by extracting `ChatPage`'s current list+panel composition into a
   new `ChatSurface.tsx`... which `ChatPage.tsx` renders unchanged"*; task 3.2 says *"the list+panel
   composition currently inline in `ChatPage.tsx`, moved out unchanged."* I read `ChatPage.tsx` in
   full — it is 31 lines and renders only a loading/error message and `<ActiveConversationPanel />`.
   There is **no conversation list anywhere in `ChatPage.tsx`** (confirmed again by `ChatPage.css`,
   which has no list-related classes at all). The conversation list lives in
   `frontend/src/shared/chrome/SidebarBody.tsx`'s `section === "chat"` branch — the app's
   **persistent sidebar chrome**, gated by `sectionFromPathname(pathname)` so it only renders the
   chat list when the route literally starts with `/chat`. This is not a guess: HEL-664's own
   archived `design.md` (D3) explicitly built it there — *"A new `chat` branch in `SidebarBody.tsx`
   renders a single `SidebarItemList`..."* — precisely because the list is sidebar-chrome, not
   page content.
   This breaks the quick-launcher's core mechanism: a portalled overlay (D7) cannot reach into
   `SidebarBody.tsx`'s route-gated branch, so "extract `ChatPage`'s list+panel composition" has
   nothing to extract, and the `chat-quick-launcher` spec delta's requirement — *"The quick-launcher
   overlay SHALL render the identical conversation list... one shared implementation, not a second,
   independently-fetched copy"* — cannot be satisfied by the plan as written. Opening the overlay on
   `/pipelines/:id` would leave `SidebarBody` still showing the *pipelines* list (per
   `sectionFromPathname`), not the chat list, while the overlay itself would need genuinely new
   list-rendering code — which is either (a) real, unscoped new work not reflected in `tasks.md`
   or the `Impact` section (which never mentions touching `SidebarBody.tsx`), or (b) if
   hand-duplicated, a second list-presentation implementation directly contradicting D5's own stated
   goal of "never a second hand-copied list+panel layout."
   **Required:** rewrite `design.md` D5/D7, `tasks.md` 3.2/4.1, `proposal.md`'s `Impact` section, and
   the `chat-quick-launcher` spec delta to either (a) explicitly plan a shared list-rendering piece
   both `SidebarBody.tsx`'s chat branch and `ChatSurface.tsx` call into (naming `SidebarBody.tsx` in
   Impact, since it must change too), or (b) rescope the quick-launcher to omit the conversation list
   (active conversation only + a "browse all conversations" link to `/chat`) and adjust AC1's "one
   coherent design" framing plus the spec delta's requirement text to match.

2. **[MODERATE] Factual error: the "Refine with AI" button is not an "always-available" entry
   point** — the stated justification for reusing its recipe is wrong. `design.md`'s Context claims
   `.app-command-bar__right` *"already hosts one 'always-available AI entry point' (the 'Refine with
   AI' button, `.topbar-theme-btn` recipe) that renders on every authenticated route via
   `AppShell`"*; `ticket.md`'s Notes repeats this near-verbatim. I read `App.tsx:424-434`: the
   button is gated by `{onDashboardView && selectedDashboard !== null && (...)}` — it only renders
   on the dashboard view with a dashboard selected, the **opposite** of always-available. The button
   that genuinely is unconditional and uses the same `.topbar-theme-btn` recipe is the theme-toggle
   button (`App.tsx:435-443`, no route guard). The underlying D6 decision (add a new unconditional
   button to `.app-command-bar__right`, reusing `.topbar-theme-btn`) is still buildable — the
   `.app-command-bar__right` container itself is unconditionally rendered by `AppShell` — but
   **cite the theme-toggle button, not "Refine with AI," as the precedent**, and fix this in both
   `design.md`'s Context and `ticket.md`'s Notes.

3. **[MODERATE] The quick-launcher's actual visual/layout treatment — this ticket's entire stated
   purpose — is left unresolved.** `usePortalPopover` (and all 5 of its real callers: `ActionsMenu`,
   `UserMenu`, `Select`, `AllowedDimensionsPicker`, `DashboardAppearanceEditor`) produces a small,
   trigger-rect-anchored dropdown panel (`computePos(rect)` → `top`/`right` relative to the trigger's
   own `getBoundingClientRect()`). Rendering a full conversation list + message thread through that
   same anchoring model is a different UI problem than anything any existing caller does, yet D6/D7
   and task 4.1 wave it off as *"reuses `usePortalPopover`-style positioning/portal mechanics
   `ActionsMenu` already establishes, not new plumbing"* with no stated width/height/placement
   (anchored dropdown vs. centered command palette vs. docked panel). Worse, the plan never even
   considers DESIGN.md §6's canonical `Modal` primitive (`frontend/src/shared/ui/Modal.tsx` — sized
   sm/md/lg up to 720px, native `<dialog>`, ESC + backdrop-click-close already built in), despite
   DESIGN.md §6 explicitly instructing *"Use these; do not hand-roll equivalents"* for exactly this
   kind of primitive. **Required:** `design.md` must state a concrete overlay layout decision
   (dimensions, anchor vs. centered, scroll behavior) and explicitly address why `Modal` was or
   wasn't chosen, rather than gesturing at reuse of a hook built for small menus.

4. **[MINOR] Wrong relative import path stated for `DashboardProposal` in the planned
   `ProposalHandoff.tsx`.** `design.md` D4 says it "parses `raw` as `DashboardProposal` (existing
   frontend type, `../types/proposal`)" — but `ProposalHandoff.tsx` is planned to live in
   `frontend/src/features/assistant/ui/`, and `DashboardProposal` is defined at
   `frontend/src/features/dashboards/types/proposal.ts` (confirmed by reading
   `AuthoringChatDrawer.tsx:16`, which correctly imports it as `../types/proposal` from its own
   location at `features/dashboards/ui/`). From `features/assistant/ui/`, the correct relative path
   is `../../dashboards/types/proposal`, not `../types/proposal` — this text appears copy-pasted from
   `AuthoringChatDrawer.tsx` without adjusting for the new file's different location. Fix in
   `design.md` D4 and `tasks.md` 2.2.

### Non-blocking notes

- **AC3 scope-interpretation call.** The mechanical `TICKET_TYPE` resolution (`feature`, not
  `design`) is independently verified correct against Linear's actual labels/title. Treating this as
  a real feature-build ticket rather than a written-spec deliverable is a defensible, transparently
  disclosed reading, and it's consistent with this repo's established fully-autonomous delivery
  pattern for prior epics. That said, `design.md`'s Planner Notes states AC3's "approved before the
  entry-point-wiring ticket implements it" is satisfied by *"this workflow's own two-skeptic-gate
  structure"* as settled fact, with no acknowledgment of residual risk. Given the ticket description
  directly quotes the human author's own strong opinion ("not thrilled about the design, it will
  definitely need an upgrade") and the epic spec describes HEL-666's eventual cutover as a hard,
  non-parallel "big-bang replacement" that retires `AuthoringChatDrawer` outright, there's a
  reasonable chance "approved" was meant to gesture at an actual human glance before HEL-666 makes
  this the sole entry point — not just another automated CONFIRM. Recommend `design.md` explicitly
  flag this residual ambiguity (e.g. suggest a human look at the shipped screenshots/PR before
  HEL-666 begins) rather than treating the pipeline gate as full closure of AC3's intent. Not a
  blocker for this ticket's own artifacts.
- Token usage throughout D1-D3 (`--app-accent-surface`, `--app-accent-mid`, `--app-surface-soft`,
  `--app-border-subtle`, `--app-error-surface`, etc.) checked against `theme/theme.css` — all real,
  correctly-named tokens; no invented values.

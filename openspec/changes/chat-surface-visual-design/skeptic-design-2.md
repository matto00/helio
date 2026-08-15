## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas
  (`specs/chat-message-rendering/spec.md`, `specs/chat-quick-launcher/spec.md`), and
  `skeptic-design-1.md` (the round-1 report, treated as a claim to re-verify, not fact) in full.
- Re-verified round-1 Change Request 1 (MAJOR — the false `ChatSurface`/list-extraction premise):
  read `frontend/src/features/assistant/ui/ChatPage.tsx` in full — confirmed it is still exactly
  31 lines, rendering only loading/error states and `<ActiveConversationPanel />`, no list. Read
  `frontend/src/shared/chrome/SidebarBody.tsx` in full — confirmed the conversation list genuinely
  lives in its `section === "chat"` branch (lines 219-272), gated by `sectionFromPathname(pathname)`
  (only "chat" when `pathname.startsWith("/chat")`). `grep -rn "ChatSurface"` across the whole
  change dir found the term only inside `skeptic-design-1.md` itself (the historical record) — zero
  occurrences in any live planning artifact (`design.md`, `proposal.md`, `tasks.md`, both spec
  deltas). `design.md`'s "Critical correction" paragraph, D5, D7, `proposal.md`'s Impact section
  (explicitly: *"`SidebarBody.tsx` is **not** touched"*), and `tasks.md` 3.1/4.1 all consistently
  describe the corrected architecture (overlay renders `ActiveConversationPanel` directly, no list
  extraction, "Browse all conversations →" link to `/chat`). The `chat-quick-launcher` spec delta's
  requirement text was rewritten to match ("one shared component and Redux slice... a link to
  `/chat` for browsing the full conversation list, which the overlay itself does not attempt to
  duplicate") — genuinely resolved, not just reworded around the same false premise.
- Re-verified round-1 Change Request 2 (MODERATE — "Refine with AI" mischaracterized as the
  always-available precedent): read `frontend/src/app/App.tsx` lines 390-454. Confirmed the
  "Refine with AI" button (lines 424-434) is still gated by
  `{onDashboardView && selectedDashboard !== null && (...)}`, and the theme-toggle button
  (lines 435-443) has no gating and uses the identical `.topbar-theme-btn` class. `design.md`'s
  Context and D7, and `ticket.md`'s Notes, now correctly cite the theme-toggle button as the
  precedent throughout — grepped for "Refine with AI" across `tasks.md`/`proposal.md` and both
  occurrences correctly state it is NOT the precedent (dashboard-view-gated).
- Re-verified round-1 Change Request 3 (MODERATE — unresolved overlay mechanism/layout): read
  `frontend/src/shared/ui/Modal.tsx` in full — confirmed it is a real, working primitive (native
  `<dialog>`, `sm`/`md`/`lg` sizes, ESC + backdrop-click-close built in) with real, precedented
  `size="lg"` callers already in the codebase (`RunHistoryModal.tsx`, `PipelinePreviewModal.tsx`,
  `PatchSetReview.tsx`, `ProposalReview.tsx` — confirmed via grep). `design.md` D6 now states a
  concrete decision (`Modal`, size `lg`) and explicitly reasons against `usePortalPopover`'s
  trigger-anchored dropdown model, matching DESIGN.md §6's "use these, don't hand-roll" instruction.
  Read `frontend/src/shared/chrome/OverlayProvider.tsx` — confirmed `useOverlay()` returns a generic
  `{isActive, open, close}` orthogonal to whatever content it gates, consistent with D7's claim that
  the D6 correction doesn't affect `useOverlay`'s applicability.
- Re-verified round-1 Change Request 4 (MINOR — wrong import path) — **found only partially fixed,
  see Change Requests below.** `design.md` D4 (line 88) now correctly states
  `../../dashboards/types/proposal`; confirmed by finding `DashboardProposal` actually lives at
  `frontend/src/features/dashboards/types/proposal.ts` and the planned `ProposalHandoff.tsx` lives
  at `frontend/src/features/assistant/ui/` (confirmed no `types/` directory exists under
  `frontend/src/features/assistant/` at all — only `types.ts`, `ui/`, `state/`, `services/`), so
  `../../dashboards/types/proposal` is the correct relative path from that location. However,
  `tasks.md` task 2.2 (line 23) still reads `../types/proposal` — the stale, wrong path round 1
  explicitly asked to be fixed "in `design.md` D4 and `tasks.md` 2.2" (both, not one). This was
  not caught by a flaky re-run; I re-read the literal file text twice.
- Cross-checked `ClaudeToolMessageDto`/`ClaudeContentBlockDto` shapes referenced throughout D1-D4
  against the real `frontend/src/features/assistant/types.ts` — `role: string`, `blockType:
  "text"|"tool_use"|"tool_result"`, `toolUseId`, `isError: boolean` all match exactly.
- Checked all DESIGN.md tokens cited in D1-D3 (`--app-accent-surface`, `--app-accent-mid`,
  `--app-surface-soft`, `--app-border-subtle`, `--app-error`, `--app-error-surface`,
  `--app-radius-lg`, `--text-sm`, `--text-xs`, `--space-3`, `--font-mono`, `--app-transition`)
  against `frontend/src/theme/theme.css` — all real, correctly named, no invented values.
- Read `openspec/specs/assistant-chat-nav/spec.md` (HEL-664's already-shipped spec) — its own
  Purpose statement ("the message-rendering UI itself is a later ticket's job") and requirements
  are consistent with this ticket's scope and don't conflict with the two new deltas.
- Read both spec deltas in full and cross-checked them against each other and against `design.md`
  D1-D7 — internally consistent: `chat-message-rendering` never references the quick-launcher (a
  clean, orthogonal split), and `chat-quick-launcher`'s "one shared component and Redux slice, not
  a second, independently-fetched copy" requirement matches D5/D6's actual mechanism (reusing
  `ActiveConversationPanel` directly inside `Modal`).
- Ran `openspec validate chat-surface-visual-design --strict` twice (reproduced, not a one-off) →
  both runs printed `Change 'chat-surface-visual-design' is valid`.
- `git status`/`git diff --stat main...HEAD` — only the untracked `openspec/changes/
  chat-surface-visual-design/` directory exists; no frontend code has been touched yet, as expected
  at the design gate.
- Environmental note (not a Change Request against the plan): this worktree's `scripts/concertino/`
  is missing `next-report-number.sh`/`persist-evidence.sh`/`emit-event.sh` (only 6 of 17 scripts
  present — `git ls-files scripts/concertino/` in both the main checkout and this worktree confirms
  the missing ones are genuinely untracked/gitignored, not deleted). Resolved without creating,
  copying, or modifying any file outside my own report: invoked the main checkout's copies by
  absolute path against this worktree's change directory/report path, which each script's own
  argument handling (`<change-dir>` param, `git -C`/CWD-based repo resolution) supports correctly
  regardless of which checkout the script binary physically lives in.

### Verdict: REFUTE

Round 1's major and both moderate findings are genuinely resolved — this is a real redesign, not
wordsmithing, and I traced each one against live source myself. One round-1 minor finding is only
half-fixed and now constitutes a live, self-contradicting pair of planning artifacts, which is a
required revision before this can be handed to an implementer.

### Change Requests

1. **[MINOR — carried over, not fully fixed] `tasks.md` task 2.2 still states the wrong relative
   import path for `DashboardProposal`, now contradicting `design.md` D4's corrected path.**
   `tasks.md:23` reads: `` `kind === "dashboard"` parses `raw` as `DashboardProposal`
   (`../types/proposal`) `` — this is the exact stale text round 1 flagged (copy-pasted from
   `AuthoringChatDrawer.tsx`, which correctly uses `../types/proposal` from its own location at
   `features/dashboards/ui/`). `design.md` D4 (line 88) was correctly updated to
   `../../dashboards/types/proposal`, matching `ProposalHandoff.tsx`'s planned location at
   `features/assistant/ui/` — but `tasks.md`, the checklist an implementer follows line-by-line, was
   not updated to match, and there is no `features/assistant/types/` directory at all (confirmed:
   `frontend/src/features/assistant/` contains only `types.ts`, `ui/`, `state/`, `services/`), so
   `../types/proposal` would fail to resolve from `features/assistant/ui/` if followed literally.
   **Required:** update `tasks.md:23` to read `../../dashboards/types/proposal`, matching the
   corrected `design.md` D4. One-line fix; no further design discussion needed.

### Non-blocking notes

- The AC3 "approved" residual-ambiguity flag in `design.md`'s Planner Notes is unchanged from round
  1 and remains a reasonable, disclosed, non-blocking process recommendation (surface shipped
  screenshots for a human glance before HEL-666's cutover) rather than a defect in this ticket's own
  artifacts.
- `design.md` D6's illustrative `Modal` usage snippet (`<Modal size="lg" onClose={...}>...`) omits
  the required `title`/`open` props `Modal.tsx` actually requires — clearly shorthand for the
  decision being illustrated, not literal planned code (task 4.1's prose description is the actual
  task spec), so not flagged as a required revision.

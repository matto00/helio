## 1. Frontend: Message-turn rendering

- [x] 1.1 Add `frontend/src/features/assistant/ui/MessageTurn.tsx` + `.css`: role-based bubbles
      (user right-aligned `--app-accent-surface`/`--app-accent-mid`; assistant left-aligned
      `--app-surface-soft`/`--app-border-subtle`), reusing `.authoring-drawer__turn-role`'s existing
      mono-eyebrow label recipe and `.authoring-drawer__turn-text`'s `pre-wrap` text recipe
      (design.md D1)
- [x] 1.2 Add `frontend/src/features/assistant/ui/ToolCallIndicator.tsx` + `.css`: one row per
      `tool_use` block (tool name + compact input), paired `tool_result` as a collapsed disclosure
      summary (never raw JSON inline), `isError: true` results styled with DESIGN.md's error-intent
      tokens (design.md D2)
- [x] 1.3 Add `frontend/src/features/assistant/ui/StreamingText.tsx` + `.css`: incremental text
      reveal from a `chunks: string[]`/async-iterable prop, blinking-cursor affordance
      (`prefers-reduced-motion`-respecting), tested against mock chunk sequences only — no live
      wiring (design.md D3)

## 2. Frontend: Proposal hand-off

- [x] 2.1 Add `frontend/src/features/assistant/proposalExtraction.ts`: pure function scanning a
      transcript for a successful `propose_*` tool result, returning a discriminated
      `{kind: "dashboard"|"pipeline"|"combined"|"patch", raw: string} | null` (design.md D4)
      — **implementation correction**: the returned `input` field is sourced from the paired
      `tool_use.input` (the propose_* call's original arguments), not the `tool_result.content`
      design.md's prose described. Verified against `AssistantToolExecutor.scala`:
      `executeProposePatchSet` returns the *preview* (`PatchSetPreviewResponse`, `{edits:
      EditPreview[]}`) as the tool_result body, not the original `PatchSet` (`{summary?, edits:
      Edit[]}`) — parsing the tool_result as a `PatchSet` for `kind === "patch"` would silently
      produce a broken object. `tool_use.input` is reliable for every kind (the other three tools'
      results happen to mirror their input, so behavior for dashboard/pipeline/combined is
      unchanged). Locked in by a regression test in `proposalExtraction.test.ts`.
- [x] 2.2 Add `frontend/src/features/assistant/ui/ProposalHandoff.tsx`: "Proposal ready" card;
      `kind === "dashboard"` parses `raw` as `DashboardProposal`
      (`../../dashboards/types/proposal` — correct relative path from `features/assistant/ui/`,
      design-gate round 1 fix) and navigates
      `("/proposals/review", {state: {proposal}})` on click; `kind === "patch"` parses as `PatchSet`
      and navigates `("/patch-sets/review", {state: {patchSet}})`; `kind === "pipeline"|"combined"`
      renders an informational notice, no navigation action (design.md D4)

## 3. Frontend: Assemble ActiveConversationPanel

- [x] 3.1 Replace `ActiveConversationPanel.tsx`'s placeholder body with real rendering: map
      `transcript` to `MessageTurn`/`ToolCallIndicator` in order, render `ProposalHandoff` when
      `proposalExtraction` finds a result — preserve the existing loading/empty/error states
      unchanged (they're already DESIGN.md-compliant per HEL-664); `ChatPage.tsx` itself needs no
      change (it already just renders `<ActiveConversationPanel />` — confirmed no list lives there,
      design.md's Context correction)

## 4. Frontend: Quick-launcher

- [x] 4.1 Add `frontend/src/features/assistant/ui/QuickLauncherOverlay.tsx` + `.css`: a `Modal`
      (`shared/ui/Modal`, size `lg`) rendering `<ActiveConversationPanel />` directly plus a "Browse
      all conversations →" link to `/chat` — reads the identical `state.assistantConversations`
      slice `ChatPage` already reads, no second fetch/slice, no attempt to render
      `SidebarBody.tsx`'s route-gated list inside the overlay (design.md D5/D6)
- [x] 4.2 Add a quick-launcher trigger button to `App.tsx`'s `.app-command-bar__right`, reusing the
      exact `.topbar-theme-btn` recipe the theme-toggle button uses (genuinely unconditional — NOT
      the "Refine with AI" button, which is dashboard-view-gated), visible on every authenticated
      route (design.md D7)
- [x] 4.3 Bind `Cmd/Ctrl+K` to open the overlay via `useOverlay()` (global keydown listener scoped
      to the app shell, `event.preventDefault()`), in addition to the click trigger (design.md D7)

## Tests

- [x] 5.1 Test: a user turn and an assistant turn render with distinct alignment/surface treatment
- [x] 5.2 Test: two `tool_use` blocks in one turn render as two distinct indicator rows
- [x] 5.3 Test: a large `tool_result` JSON renders as a collapsed summary, not raw JSON inline
- [x] 5.4 Test: an `isError: true` tool result renders with error-intent styling
- [x] 5.5 Test: `StreamingText` reveals a scripted chunk sequence in order with a visible
      in-progress affordance until complete
- [x] 5.6 Test: a successful `propose_dashboard` result renders a working "Review proposal" action
      that navigates to `/proposals/review` with the parsed `DashboardProposal` in router state
- [x] 5.7 Test: a successful `propose_patch_set` result renders a working hand-off to
      `/patch-sets/review` with the parsed `PatchSet` in router state
- [x] 5.8 Test: a successful `propose_pipeline`/`propose_combined` result renders the informational
      notice with no navigation action
- [x] 5.9 Test: the quick-launcher trigger is visible on a non-chat route (e.g. `/pipelines`)
- [x] 5.10 Test: clicking the trigger opens the overlay without changing the URL
- [x] 5.11 Test: the keyboard shortcut opens the overlay
- [x] 5.12 Test: Escape closes the quick-launcher overlay
- [x] 5.13 Test: the overlay's active conversation matches what `/chat` shows for the same
      selection (shared Redux state, not a second independent copy)
- [x] 5.14 Test: the "Browse all conversations →" link navigates to `/chat` and closes the overlay
- [x] 5.15 Regression test: `ChatPage.tsx`'s existing tests (from HEL-664) are unaffected — this
      ticket does not modify `ChatPage.tsx` itself
- [x] 5.16 `npm test` fully green; `npm run lint`/`npm run format:check` clean

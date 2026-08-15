## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

1. **Quick-launcher unconditional (ticket bullet 1 / AC1).** Read
   `frontend/src/app/App.tsx` in full. The trigger button
   (`.app-command-bar__right`, lines 454-462) sits in `AppShell`, which is
   mounted once for the whole `<Route element={<AppShell />}>` subtree (lines
   584-596) wrapping every protected route (`/`, `/sources`, `/pipelines`,
   `/pipelines/:id`, `/registry`, `/metrics`, `/metrics/:id`, `/chat`,
   `/proposals/review`, `/patch-sets/review`) — it is not wrapped in any
   `onDashboardView`/route conditional (contrast with the "Refine with AI"
   button at line 440, which genuinely is gated). `QuickLauncherOverlay` is
   mounted unconditionally at lines 554-557 (no gating, unlike
   `RefinementChatDrawer` at 544-550 which is gated on
   `selectedDashboardId !== null`). The `Cmd/Ctrl+K` handler (lines 285-294)
   is a `window.addEventListener("keydown", ...)` registered once in
   `AppShell`, not scoped to any child. Plan's claim confirmed exactly as
   written.

2. **Proposal hand-off (ticket bullet 3 / AC2).** Read
   `frontend/src/features/assistant/ui/ProposalHandoff.tsx` and
   `frontend/src/features/dashboards/ui/ProposalReviewPage.tsx` in full.
   `ProposalHandoff` calls `navigate("/proposals/review", { state: { proposal
   } })` (line 41) — the identical `navigate(..., {state:{proposal}})` shape.
   `ProposalReviewPage` reads `routeState?.authoringRequestId` as a plain
   optional (line 37); `handleAccept` (lines 70-91) calls
   `dispatch(applyProposal(edited)).unwrap()` unconditionally and only
   conditionally fires the fire-and-forget `postAuthoringOutcome` telemetry
   call when `authoringRequestId` is present. Plan's claim confirmed exactly.

3. **`useDashboardAuthoringStream` consumers (bullet 4).**
   `grep -rln "useDashboardAuthoringStream" frontend/src` returns 8 hits, but
   inspecting each: `types/authoring.ts`, `useRefinement.ts`,
   `refinementService.ts` only *mention* the hook name in doc comments (no
   import). The only real `import { useDashboardAuthoringStream } from ...`
   is in `AuthoringChatDrawer.tsx` (line 11) plus the hook's own file and its
   own test. `grep -n "^import" ChatPage.tsx ActiveConversationPanel.tsx
   MessageComposer.tsx` shows none of the three import it — they import
   `assistantConversationsSlice` (`converse`, `fetchConversations`,
   `selectConversation`, `setSelectedConversationId`) instead, confirming the
   "independent Redux-slice-based data flow" claim. Plan's claim confirmed.

4. **`sseMock.ts` / `authoringService.ts` export consumers.**
   `grep -rln "sseMock" frontend/src` → exactly
   `AuthoringChatDrawer.test.tsx` and `useDashboardAuthoringStream.test.ts`
   (the two files scheduled for deletion). `AUTHORING_DASHBOARD_ENDPOINT`'s
   only non-definition use is `useDashboardAuthoringStream.ts:93`.
   `fetchAuthoringConversation` is used by `RefinementChatDrawer.tsx:92` (and
   by `AuthoringChatDrawer.tsx:116`, which is being deleted anyway — the plan
   correctly counts only the post-deletion consumer). `postAuthoringOutcome`
   is used by `ProposalReviewPage.tsx:81,98`. All four consumer-list claims
   confirmed exactly as stated.

5. **`RefinementChatDrawer` independence.** Read the file header and its
   hook/service chain: `useRefinement` (own hook) →
   `refinementService.ts`'s own `REFINEMENTS_ENDPOINT = "/api/refinements"`
   constant, entirely separate from `AUTHORING_DASHBOARD_ENDPOINT`. Its
   `App.tsx` mount (lines 544-550) is gated on `selectedDashboardId !== null`
   with its own `dashboardId` prop — a distinct precondition from the
   quick-launcher's unconditional mount. Canonical epic spec line 95: "HEL-343
   (Conversational Refinement, in progress) is unaffected and feeds this
   design." Confirmed genuinely out of scope, not swept in.

6. **REMOVED-requirements delta vs. base spec.** Read
   `openspec/specs/nl-authoring-chat-surface/spec.md` (base, 6 requirements)
   against the change's delta. `diff` of `grep "^### Requirement"` from both
   files is empty — all 6 headers match byte-for-byte
   (`A user can open the chat surface...`, `A terminal result hands the
   proposal...`, `Nothing is written until...`, `A terminal error or
   connection failure...`, `An intermediate repair status...`, `A
   discoverable entry point...`). Reason/Migration text for each points at
   real successor capabilities named in the epic spec's own "Reuse vs.
   rework" section (`chat-message-rendering`, `assistant-conversation-loop`,
   `chat-quick-launcher`, `assistant-chat-nav`, `assistant-live-converse`).
   `openspec validate single-assistant-entry-point --strict` → `Change
   'single-assistant-entry-point' is valid`.

7. **DashboardList.tsx is the sole mount point.**
   `grep -n "AuthoringChatDrawer\|isAuthoringOpen\|author-ai" DashboardList.tsx`
   confirms the import (line 28), state (line 38), button (line 167), and
   mount (line 374) all exist exactly as D3/task 2.1-2.3 describe.
   `grep -rln "author-ai\|Author with AI\|faWandMagic"` across the whole
   frontend returns only `DashboardList.tsx`/`.test.tsx` and
   `AuthoringChatDrawer.tsx`/`.test.tsx` — no other stray per-feature button
   exists anywhere. `DashboardList.test.tsx:280` has the
   "opens the Author with AI chat drawer..." test task 2.4 targets;
   `DashboardList.css:46,67,76` has the `.dashboard-list__author-ai` rules
   task 2.3 targets.

8. **Canonical epic spec tension, checked and resolved correctly.** The epic
   spec (`docs/superpowers/specs/2026-08-14-top-level-assistant-design.md:62`)
   originally planned to *rework* `useDashboardAuthoringStream`'s event
   shape. This plan's D-note "Planner Notes" self-approves overriding that
   stale framing with a *delete* on the strength of a grounded, reproduced
   grep (#3 above) that the as-built HEL-664/665 surface never adopted that
   hook and has its own independent data flow. This is a legitimate,
   evidence-backed correction of a pre-implementation architecture doc by
   post-implementation reality, not hand-waving — the grep evidence is
   reproducible and I reproduced it myself.

9. **No placeholders.** `grep -inE "TODO|TBD|figure out|placeholder|to be
   determined"` across all four artifact files: zero hits.

10. **Scope check against ticket ACs.** AC1 → task 3.3 (Playwright live
    sweep across `/`, `/sources`, `/pipelines`, `/registry`, `/metrics`,
    `/chat`). AC2 → task 3.4 (live send → `propose_dashboard` →
    `/proposals/review` → accept → dashboard created, against real dev
    backend + real `ANTHROPIC_API_KEY`, matching the ticket's own
    "live-verify, not mocked" wording). AC3 → tasks 1.1-1.4, 2.1-2.4, 3.5
    (grep sweep for stray references). All three ACs trace to a concrete
    task; no task exists outside the ticket's stated scope.

### One point flagged, not blocking

The "Refine with AI" button (gated to `onDashboardView`, line 440 of
`App.tsx`) remains a second AI-chat entry point on the `/` route alongside
the quick-launcher. AC1's literal text ("exactly one way to reach the
assistant... no leftover per-feature buttons anywhere") is broad enough that
a literal-minded reader could flag this as a violation. The plan's D4
resolves this correctly by anchoring on the canonical epic spec's own
disambiguation (line 95: HEL-343/RefinementChatDrawer is explicitly
"unaffected", and line 57 names only `AuthoringChatDrawer`'s mount point and
"the scattered per-feature entry buttons" — i.e. the *old assistant's*
buttons — as retired, not every AI-adjacent button in the app). This is a
correct, spec-grounded scope boundary, not a gap in this plan. Recommend the
executor's live-verification task 3.3 explicitly note this distinction when
it runs (so a future reader of the Playwright evidence doesn't misread two
buttons on `/` as a regression) — non-blocking polish, not a required
revision.

### Verdict: CONFIRM

### Non-blocking notes

- Task 3.3's page list is qualified "at minimum" — good, since it omits
  `/pipelines/:id`, `/metrics/:id`, `/proposals/review`, `/patch-sets/review`
  but doesn't claim to be exhaustive.
- Backend `DashboardAuthoringService`/routes staying untouched (D5) is a
  reasonable, explicitly-justified scope boundary consistent with
  CONTRIBUTING.md's "avoid unrelated refactors" guidance and the ticket's
  own frontend-only scope statement.

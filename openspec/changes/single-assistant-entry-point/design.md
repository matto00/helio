## Context

`App.tsx` already has an unconditional quick-launcher trigger (`.app-command-bar__right`, mirrors
the theme-toggle button's recipe) and mounts `QuickLauncherOverlay` unconditionally, plus a global
`Cmd/Ctrl+K` handler — all shipped by HEL-665 (confirmed by reading the real current code).
`ProposalHandoff.tsx` (HEL-665) already navigates to `/proposals/review`/`/patch-sets/review` with
router state, reusing `AuthoringChatDrawer.handleReviewAndApply`'s exact mechanism;
`ProposalReviewPage.tsx` already treats `authoringRequestId` as fully optional. `AuthoringChatDrawer`
is mounted in exactly one place (`DashboardList.tsx`'s "magic wand" button); its only other trace
anywhere in the frontend is doc-comment references in unrelated files (`ProposalHandoff.tsx`,
`MessageTurn.tsx`, `emptyWorkspaceCopy.ts`, `RefinementChatDrawer.tsx`, test files), none of which
import or render it. `useDashboardAuthoringStream` has exactly one real consumer
(`AuthoringChatDrawer.tsx`); the new chat surface never imports it. `frontend/src/test/sseMock.ts`
is consumed only by `AuthoringChatDrawer.test.tsx` and `useDashboardAuthoringStream.test.ts`.
`authoringService.ts` exports `AUTHORING_DASHBOARD_ENDPOINT` (used only by
`useDashboardAuthoringStream.ts`), `fetchAuthoringConversation` (also used by
`RefinementChatDrawer.tsx` — stays), and `postAuthoringOutcome` (also used by
`ProposalReviewPage.tsx` — stays). `RefinementChatDrawer` is a wholly independent flow (own hook,
own `/api/refinements` endpoint, targets an existing dashboard) the canonical epic spec's
"Relationship to existing tickets" section explicitly calls "unaffected."

## Goals / Non-Goals

**Goals:**
- Exactly one way to reach the assistant per page: the quick-launcher (everywhere) plus `/chat`.
- `AuthoringChatDrawer` and everything that becomes dead code once it's gone are deleted, not left
  dormant.
- Live-verify (not rebuild) that the already-shipped quick-launcher and proposal hand-off satisfy
  AC1/AC2 for real, against the real dev backend.

**Non-Goals:**
- No new quick-launcher or proposal-hand-off code (already shipped by HEL-665).
- No changes to `RefinementChatDrawer`/"Refine with AI".
- No backend changes; no retirement of `DashboardAuthoringService`/`DashboardAuthoringRoutes`.

## Decisions

**D1 — Delete, don't deprecate.** `AuthoringChatDrawer.{tsx,css,test.tsx}`,
`useDashboardAuthoringStream.{ts,test.ts}`, and `frontend/src/test/sseMock.ts` are removed outright
— matching AC3's explicit "deleted, not left dormant." Each has zero remaining real consumers once
`DashboardList.tsx`'s mount point is removed (verified by grep at planning time, not assumed).

**D2 — `authoringService.ts` loses one export, keeps two.** `AUTHORING_DASHBOARD_ENDPOINT` is
removed (its only consumer, `useDashboardAuthoringStream.ts`, is deleted). `fetchAuthoringConversation`
and `postAuthoringOutcome` stay verbatim — `RefinementChatDrawer.tsx` and `ProposalReviewPage.tsx`
respectively still call them, confirmed by reading both files' real imports, not inferred from
naming similarity. `authoringService.test.ts` needs no change (it only tests the two surviving
functions already).

**D3 — `DashboardList.tsx`'s removal is a clean four-part excision, not a partial disable.**
Remove: the `import { AuthoringChatDrawer } from "./AuthoringChatDrawer"` line; the
`isAuthoringOpen` state; the `dashboard-list__author-ai` button (and its `DashboardList.css`
rules); and the `<AuthoringChatDrawer open={...} onClose={...} />` mount at the component's end.
`DashboardList.test.tsx`'s "opens the Author with AI chat drawer" test is removed alongside it (the
affordance it tests no longer exists).

**D4 — `RefinementChatDrawer`/"Refine with AI" is explicitly untouched — a boundary worth stating
plainly, not just implying.** Confirmed against the canonical epic spec's own text ("HEL-343...is
unaffected") and against the real current code (independent hook, independent endpoint, independent
mount point, independent target-an-existing-dashboard precondition). A careless reading of "retire
per-feature entry points to the old assistant" could sweep this in by mistake; it must not be.

**D5 — Backend stays; the route becomes frontend-unreachable, not literally dead.** Confirmed no
other frontend consumer of `POST /api/authoring/dashboard` exists, and confirmed the new assistant's
`propose_dashboard` tool reuses `DashboardProposalService` directly (service-layer logic reuse, per
the epic's own stated design), never calling this HTTP route internally. This ticket's own scope is
stated entirely in frontend terms — retiring the backend route/service is a separate, larger,
out-of-scope decision this ticket does not make, and CONTRIBUTING.md's "avoid unrelated refactors"
guidance applies directly here.

**D6 — `nl-authoring-chat-surface`'s 6 requirements are REMOVED, each with Reason + Migration.**
The capability's own subject no longer exists once `AuthoringChatDrawer` is deleted. Each removed
requirement's Migration note points at its real successor in the already-shipped
`chat-message-rendering`/`chat-quick-launcher`/`assistant-chat-nav` capabilities, so a reader of the
archived spec history isn't left wondering what replaced this behavior.

**D7 — AC1/AC2 are satisfied by live re-verification of already-shipped behavior, not new
implementation tasks.** The quick-launcher's "every page has exactly one way to reach the
assistant" and the proposal hand-off's "applies exactly as today's dashboard proposals do" are both
already true in the shipped code — this ticket's Execution phase confirms this live (Playwright,
real dev backend, real Anthropic API for the hand-off case) rather than re-building either.

## Risks / Trade-offs

- **Deleting a real, working feature (`AuthoringChatDrawer`) is inherently one-way** → accepted per
  the epic's own explicit "big-bang replacement, not a parallel rollout" framing and this ticket's
  own AC3; git history preserves the code if ever needed for reference.
- **Backend route becomes unreachable from the frontend but isn't removed (D5)** → a small amount
  of now-unused-from-the-frontend surface area remains → accepted: removing it is a distinct,
  larger decision (does anything else, e.g. a future integration, ever want this endpoint?) that
  this frontend-scoped ticket correctly declines to make unilaterally.

## Planner Notes

- Self-approved: correcting the ticket's own bullet 4 (`useDashboardAuthoringStream` "update... for
  a new event shape") to "delete, it has no successor" — the research finding is unambiguous (zero
  real consumers in the new surface), and building a speculative "update" for a hook nothing would
  ever call again would be pure waste.
- Self-approved: treating AC1/AC2 as live-verification tasks rather than implementation tasks,
  since both are independently confirmed already-shipped by reading the real current code — no
  speculative re-implementation of something that already works.

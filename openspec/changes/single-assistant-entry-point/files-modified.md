# Files modified — HEL-666 single-assistant-entry-point

## Deleted (design.md D1 — zero remaining consumers, confirmed by grep)

- `frontend/src/features/dashboards/ui/AuthoringChatDrawer.tsx` — the old assistant's chat surface;
  superseded by the new `/chat` page + quick-launcher (HEL-663/664/665).
- `frontend/src/features/dashboards/ui/AuthoringChatDrawer.css` — its styles.
- `frontend/src/features/dashboards/ui/AuthoringChatDrawer.test.tsx` — its tests.
- `frontend/src/features/dashboards/hooks/useDashboardAuthoringStream.ts` — SSE hook whose only
  real consumer was `AuthoringChatDrawer`; the new chat surface never used it.
- `frontend/src/features/dashboards/hooks/useDashboardAuthoringStream.test.ts` — its tests.
- `frontend/src/test/sseMock.ts` — shared SSE test helper, consumed only by the two `.test.tsx`/
  `.test.ts` files above.

## Modified

- `frontend/src/features/dashboards/services/authoringService.ts` — removed the now-unused
  `AUTHORING_DASHBOARD_ENDPOINT` export (its only consumer, `useDashboardAuthoringStream.ts`, is
  deleted). `fetchAuthoringConversation`/`postAuthoringOutcome` are untouched (still used by
  `RefinementChatDrawer.tsx`/`ProposalReviewPage.tsx` respectively).
- `frontend/src/features/dashboards/ui/DashboardList.tsx` — removed the `AuthoringChatDrawer`
  import, `isAuthoringOpen` state, the "magic wand" (`dashboard-list__author-ai`) button, and the
  `<AuthoringChatDrawer .../>` mount. Also dropped the now-unused `faWandMagicSparkles` icon import.
- `frontend/src/features/dashboards/ui/DashboardList.css` — removed the
  `.dashboard-list__author-ai` rules (button sizing/hover/font-size), leaving `.dashboard-list__add`
  intact.
- `frontend/src/features/dashboards/ui/DashboardList.test.tsx` — removed the "opens the Author with
  AI chat drawer" test; the affordance it exercised no longer exists.
- `frontend/src/features/dashboards/utils/emptyWorkspaceCopy.ts` — comment-only fix: the doc comment
  claimed (present tense) this constant is shared with `AuthoringChatDrawer`, which is now false —
  reworded to past tense/historical framing. No functional change. (Not in design.md's
  explicitly-untouched-files list, unlike `ProposalReviewPage.tsx`/`RefinementChatDrawer.tsx`.)

## Added

- `e2e/hel666-single-assistant-entry.spec.ts` — Playwright live-verification spec (tasks.md 3.3/3.4,
  AC1/AC2), run via `npm run e2e` against real dev servers with a real `ANTHROPIC_API_KEY`, not part
  of the pre-commit gates. Two tests:
  1. Every authenticated route (`/`, `/sources`, `/pipelines`, `/registry`, `/metrics`, `/chat`)
     shows the single quick-launcher trigger and never the deleted "magic wand" button; confirms
     "Refine with AI" legitimately remains visible on `/` (a different, out-of-scope feature);
     confirms Ctrl+K opens the same overlay.
  2. A real message sent via the composer produces a real `propose_dashboard` tool call (real
     Anthropic API), "Review proposal" navigates to `/proposals/review` with the correct proposal
     content, and Accept actually applies and creates the dashboard (verified in the sidebar).
  Both tests PASSED against the real dev backend.
- `openspec/changes/single-assistant-entry-point/tasks.md` checkboxes updated to reflect completed
  work (all 15 tasks marked done).

## Explicitly untouched (confirmed via this diff / grep, per design.md D4/D5 and the ticket's
critical boundary)

- `frontend/src/features/dashboards/ui/RefinementChatDrawer.{tsx,css,test.tsx}` and its "Refine with
  AI" mount point in `frontend/src/app/App.tsx` — a separate, still-valid HEL-343 feature.
- `frontend/src/features/dashboards/ui/ProposalReviewPage.tsx` / `ProposalReview.tsx` — already
  correct as of HEL-665.
- Everything under `frontend/src/features/assistant/` (`ProposalHandoff.tsx`,
  `QuickLauncherOverlay.tsx`, `MessageTurn.tsx`, `ChatPage.tsx`, `ActiveConversationPanel.tsx`,
  `MessageComposer.tsx`, etc.) — already correct as of HEL-664/665.
- Backend `DashboardAuthoringService`/`DashboardAuthoringRoutes` — out of scope; the route becomes
  frontend-unreachable but stays as real, independently-tested code (design.md D5).

## Spinoff candidate (not fixed inline — flagged, not this ticket's scope)

- `AuthoringGoalRequest`/`AuthoringResult` (types in
  `frontend/src/features/dashboards/types/authoring.ts`, re-exported from `authoringService.ts`)
  now have zero real consumers anywhere in the frontend (only `useDashboardAuthoringStream.ts`,
  itself deleted, ever imported them) — confirmed via grep. Not removed here: design.md's D1-D7
  decisions don't mention these types, and CONTRIBUTING.md's "avoid unrelated refactors" guidance
  applies — a follow-up ticket can retire them (and audit whether `AuthoringConversationView`'s
  shape still needs every field) without risk of silently widening this ticket's diff.

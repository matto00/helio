## Why

HEL-659 is a big-bang replacement, not a parallel rollout — but the old `AuthoringChatDrawer` and
its "magic wand" entry point in `DashboardList.tsx` are still live, sitting alongside the new
`/chat` page and quick-launcher HEL-664/665 already shipped. Two assistants, two entry points into
one of them, is exactly the state this ticket exists to close out.

## What Changes

- Delete `AuthoringChatDrawer.{tsx,css,test.tsx}` and its mount point in `DashboardList.tsx` (the
  `dashboard-list__author-ai` button, `isAuthoringOpen` state, the import, and the mount) — the
  sole remaining per-feature entry point to the old assistant.
- Delete `useDashboardAuthoringStream.{ts,test.ts}` — its only consumer is `AuthoringChatDrawer`
  itself; the new chat surface never used it and has no successor need for it.
- Delete `frontend/src/test/sseMock.ts` — a shared SSE test helper with zero remaining consumers
  once both deleted test files above are gone.
- Remove the now-unused `AUTHORING_DASHBOARD_ENDPOINT` export from `authoringService.ts` (its other
  two exports stay — `fetchAuthoringConversation` is still used by `RefinementChatDrawer`,
  `postAuthoringOutcome` by `ProposalReviewPage`).
- Add a `REMOVED Requirements` delta against the `nl-authoring-chat-surface` openspec capability.
- **No new production code for the quick-launcher or the proposal hand-off** — both are already
  fully shipped by HEL-665 (confirmed by reading the real current code at planning time). This
  ticket's job for AC1/AC2 is live re-verification against the real dev backend, not construction.
- `RefinementChatDrawer` ("Refine with AI") and its mount point are explicitly untouched — a
  separate, still-valid HEL-343 feature, not part of "the old assistant" this ticket retires.
- Backend `DashboardAuthoringService`/`DashboardAuthoringRoutes` stay untouched — this ticket's
  scope is frontend-only; the backend route becomes frontend-unreachable but remains real,
  independently-tested code, and retiring it is a separate, out-of-scope decision.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `nl-authoring-chat-surface`: all 6 requirements REMOVED — the capability's own subject
  (`AuthoringChatDrawer`) no longer exists.

## Impact

- `frontend/src/features/dashboards/ui/`: `AuthoringChatDrawer.{tsx,css,test.tsx}` deleted;
  `DashboardList.{tsx,css,test.tsx}` modified (entry point removed).
- `frontend/src/features/dashboards/hooks/`: `useDashboardAuthoringStream.{ts,test.ts}` deleted.
- `frontend/src/features/dashboards/services/authoringService.ts`: one unused export removed.
- `frontend/src/test/sseMock.ts`: deleted.
- No backend changes; no schema changes.
- `RefinementChatDrawer.tsx`, `App.tsx`'s "Refine with AI" mount, `ProposalReviewPage.tsx`/
  `ProposalReview.tsx`, `QuickLauncherOverlay.tsx`, and everything under
  `frontend/src/features/assistant/` are untouched — all already correct as of HEL-664/665.

## Non-goals

- No retirement of the backend `DashboardAuthoringService`/`DashboardAuthoringRoutes`.
- No changes to `RefinementChatDrawer`/"Refine with AI" — separate, still-valid feature.
- No new proposal-review UI for `PipelineProposal`/`CombinedProposal` — a pre-existing,
  independently-tracked gap `ProposalHandoff.tsx` already discloses honestly, not this ticket's job.

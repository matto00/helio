## Files modified

- `frontend/src/features/dashboards/types/authoring.ts` — new: `AuthoringGoalRequest` /
  `AuthoringResult` TS types mirroring `DashboardAuthoringProtocol.scala`'s wire shapes (task 1.1).
- `frontend/src/features/dashboards/services/authoringService.ts` — new: thin service holding only the
  `/api/authoring/dashboard` endpoint path constant + re-exported types, no fetch/stream logic
  (design.md D3, task 1.2).
- `frontend/src/features/dashboards/hooks/useDashboardAuthoringStream.ts` — new: `fetch` +
  `credentials: "include"` + `AbortController` SSE-consumption hook, structurally mirroring
  `usePipelineRunEvents.ts`, `POST`ing `{goal}` and dispatching on `authoring-progress` /
  `authoring-status` / `authoring-result` / `authoring-error` (design.md D2, tasks 2.1–2.3). **Cycle 2
  fix (evaluation-1.md change request #1):** added `"X-Helio-Requested-With": "1"` to the fetch
  `headers` — `AuthDirectives.requireCsrfHeader` 403s every non-GET request carrying the
  `helio_session` cookie without it; `httpClient` (axios) sets it by default on every other mutating
  call, but this hook bypasses `httpClient` for streaming and never added it. Root cause confirmed live
  against the real dev backend (real login + real `POST /api/authoring/dashboard?stream=true`): 403
  without the header, 200/`text/event-stream` with it — see the executor's cycle-2 return summary for
  the curl transcript.
- `frontend/src/features/dashboards/hooks/useDashboardAuthoringStream.test.ts` — new: unit tests for
  the hook (progress accumulation, status label, terminal result/error, connection failure, reset on a
  fresh attempt, abort on active=false and on unmount) (task 5.1). **Cycle 2 (evaluation-1.md change
  request #2):** added a dedicated test asserting `X-Helio-Requested-With: "1"` is present on the
  outgoing fetch call (mirroring `httpClient.test.ts`'s "sets the CSRF header by default" assertion),
  plus updated the existing "POSTs {goal}" test's header expectation.
- `frontend/src/features/dashboards/ui/AuthoringChatDrawer.tsx` — new: the "Author with AI" chat
  drawer overlay (design.md D1) — goal input, submit/cancel, indeterminate "composing your
  dashboard..." progress state (not raw mid-JSON text), inline error state, and on a terminal
  `authoring-result` a `navigate("/proposals/review", { state: { proposal } })` hand-off — no apply
  call anywhere in this component (design.md D4, tasks 3.1–3.2). Uses the existing `useOverlay`
  primitive (single-active-overlay + global Escape), matching `MobileNavSheet.tsx`'s convention for a
  non-native-`<dialog>` overlay.
- `frontend/src/features/dashboards/ui/AuthoringChatDrawer.css` — new: co-located CSS Module for the
  drawer, using `theme.css` tokens only (`--app-surface-strong`, `--z-popover`/`--z-popover-scrim`,
  `--space-*`, `--text-*`, etc.), mirroring `Modal.css`/`MobileNavSheet.css` conventions.
- `frontend/src/features/dashboards/ui/AuthoringChatDrawer.test.tsx` — new: RTL tests for the drawer
  (submit → progress state shown, no raw JSON rendered → terminal result → `navigate` called with the
  exact `{state: {proposal}}` shape read by `ProposalReviewPage.tsx`; terminal error → inline error, no
  navigate; connection failure → inline error, no navigate; retry after error; cancel aborts the
  in-flight fetch; close calls `onClose`) (task 5.2).
- `frontend/src/features/dashboards/ui/DashboardList.tsx` — modified: adds the "Author with AI" entry
  point (icon button beside the existing "Add dashboard" affordance, design.md D5) and renders
  `<AuthoringChatDrawer>`, toggled by local component state (no new Redux slice, per design.md D1)
  (task 4.1).
- `frontend/src/features/dashboards/ui/DashboardList.css` — modified: styles the new
  `.dashboard-list__author-ai` icon button, sharing the existing `.dashboard-list__add` 24px
  icon-button recipe.
- `frontend/src/features/dashboards/ui/DashboardList.test.tsx` — modified: adds the entry-point test
  (activating the affordance opens the drawer) (task 5.3).
- `frontend/src/test/sseMock.ts` — new: shared `createSseMock` test helper (fetch + `ReadableStream`
  SSE mock), generalized from `usePipelineRunEvents.test.ts`'s local helper, reused by both new test
  files above rather than duplicated.
- `openspec/changes/nl-authoring-chat-surface/tasks.md` — all tasks marked complete.

## Untouched (verified, per design.md D4 / hard constraint)

- `frontend/src/features/dashboards/ui/ProposalReviewPage.tsx`
- `frontend/src/features/dashboards/ui/ProposalReview.tsx`
- `frontend/src/features/dashboards/state/dashboardsSlice.ts` (`applyProposal`)

`ProposalReviewPage.test.tsx` / `ProposalReview.test.tsx` pass unmodified (task 5.4) — see gate output
in the executor's return summary.

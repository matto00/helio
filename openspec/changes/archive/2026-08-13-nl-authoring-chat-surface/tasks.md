## 1. Frontend: types + thin service

- [x] 1.1 Add `frontend/src/features/dashboards/types/authoring.ts` (or extend `proposal.ts`):
      `AuthoringGoalRequest`, `AuthoringResult` types matching `DashboardAuthoringProtocol.scala`'s
      wire shapes (`{proposal, warnings}`).
- [x] 1.2 Add `authoringService.ts` (`frontend/src/features/dashboards/services/`): endpoint path
      constant + types only, mirroring `proposalService.ts`'s thin-wrapper style (design.md D3).

## 2. Frontend: streaming hook

- [x] 2.1 Add `useDashboardAuthoringStream` (`frontend/src/features/dashboards/hooks/`), structurally
      mirroring `usePipelineRunEvents.ts`: `fetch` + `credentials: "include"` + `AbortController`,
      `POST` with a `{goal}` JSON body instead of `GET`, manual SSE line-buffer parsing dispatching on
      `authoring-progress`/`authoring-status`/`authoring-result`/`authoring-error` (design.md D2).
- [x] 2.2 Expose state: accumulated progress text, current status label, terminal result
      (`{proposal, warnings}` or `null`), terminal error (or `null`), connection error (or `null`).
- [x] 2.3 Cleanup: abort on unmount/cancel, matching `usePipelineRunEvents`'s cleanup contract.

## 3. Frontend: chat drawer UI

- [x] 3.1 New drawer component + CSS module under `frontend/src/features/dashboards/ui/` (design.md
      D1): goal text input, submit/cancel, an indeterminate "composing your dashboard..." progress
      state while streaming (not raw mid-JSON text, per design.md's Risk note), a status line for
      `authoring-status` labels, an inline error state for `authoring-error`/connection failures.
      Follow `DESIGN.md` tokens/components (co-located CSS Module, BEM-ish class names, no new
      styling system).
- [x] 3.2 On terminal `authoring-result`, `navigate("/proposals/review", { state: { proposal } })` —
      no other side effect, no apply call (design.md D4).

## 4. Frontend: entry point

- [x] 4.1 Add an "Author with AI" affordance near the existing dashboard-creation trigger (design.md
      D5 — exact placement at implementer discretion, grounded in `DESIGN.md`'s icon-button
      conventions) that opens the chat drawer.

## 5. Tests

- [x] 5.1 `useDashboardAuthoringStream` unit test (fetch mocked, hand-constructed SSE byte chunks,
      mirroring `usePipelineRunEvents.test.ts`'s existing pattern): progress accumulation, status
      surfaced, terminal result parsed, terminal error parsed, connection failure, cleanup-on-unmount
      aborts the in-flight request.
- [x] 5.2 Chat drawer component test (RTL): submit goal → progress state shown → terminal result →
      `navigate` called with the exact `{state: {proposal}}` shape; terminal error → inline error
      shown, no navigate; no `applyProposal`/apply-endpoint call anywhere in this flow.
- [x] 5.3 Entry-point test: activating the affordance opens the drawer.
- [x] 5.4 Confirm `ProposalReviewPage.test.tsx`/`ProposalReview.test.tsx` (existing suites) still pass
      unmodified — the review/apply path is untouched by this ticket.
- [x] 5.5 `npm run lint` (zero-warnings), `npm test`, `npm run format:check` all green.

# Files modified

## Cycle 2 — skeptic-final-1.md fixes (CR1/CR2/CR3)

- `frontend/src/shared/chrome/sections.ts` — CR1: added `/pipeline-proposals/review` ("Review
  Pipeline Proposal") and `/combined-proposals/review` ("Review Combined Proposal") entries to the
  `sections` registry (`pickerId: "other"`, `showInNav: false`), mirroring `/proposals/review`/
  `/patch-sets/review`. Without these, both new routes fell through `sectionLabel()`'s "Dashboards"
  default for the breadcrumb, `document.title`, and the sr-only `<h1>` — the exact HEL-724 bug
  class, live-reproduced by the final-gate skeptic.
- `frontend/src/shared/chrome/sections.test.ts` — CR2: extended the `expected` array to 11 routes
  and the distinct-label regression test to cover all five "other"-picker routes.
- `frontend/src/features/pipelines/types/pipelineProposal.ts` — non-blocking note: tightened
  `PipelineProposalApplyResponse.run` from optional to required, matching the backend's
  `PipelineProposalProtocol.scala` (`jsonFormat4`, no `Option`).
- `frontend/src/features/pipelines/state/pipelinesSlice.test.ts`,
  `frontend/src/features/pipelines/ui/PipelineProposalReviewPage.test.tsx`,
  `frontend/src/features/proposals/state/combinedProposalsSlice.test.ts`,
  `frontend/src/features/proposals/ui/CombinedProposalReviewPage.test.tsx` — added `run` to each
  `PipelineProposalApplyResponse`/`CombinedProposalApplyResponse` test fixture, now required by the
  tightened type above.

CR3 (live re-verification) was done with a temporary, uncommitted Playwright spec run against the
dev servers (logged in as the shared dev account) — confirmed the breadcrumb, `document.title`, and
sr-only `<h1>` on both new routes now read "Review Pipeline Proposal"/"Review Combined Proposal",
never "Dashboards"; screenshotted both routes as evidence. The spec was deleted after the run (not
part of this change's permanent test suite).

## Cycle 1

## Pipeline proposal (new)

- `frontend/src/features/pipelines/types/pipelineProposal.ts` — `PipelineProposal`,
  `PipelineProposalSource`, `PipelineProposalStep`, `PipelineProposalApplyResponse` types
  (design.md D4/D5 — loose `steps`/`source`).
- `frontend/src/features/pipelines/services/pipelineProposalService.ts` — `applyPipelineProposal`
  → `POST /api/pipelines/apply-proposal`.
- `frontend/src/features/pipelines/ui/PipelineProposalSummary.tsx` — read-only render of source +
  ordered steps + output DataType name; reused unmodified inside `CombinedProposalReview`.
- `frontend/src/features/pipelines/ui/PipelineProposalReview.tsx` — Modal wrapper around
  `PipelineProposalSummary` with the Accept/Reject footer.
- `frontend/src/features/pipelines/ui/PipelineProposalReview.css` — styles for both of the above.
- `frontend/src/features/pipelines/ui/PipelineProposalReviewPage.tsx` — route container for
  `/pipeline-proposals/review` (router-state proposal, DEV-only self-contained demo fixture,
  Accept → apply → navigate to the created pipeline's detail page, Reject → navigate to `/`).
- `frontend/src/features/pipelines/ui/PipelineProposalReview.test.tsx`,
  `frontend/src/features/pipelines/ui/PipelineProposalReviewPage.test.tsx` — new tests.

## Pipeline proposal — existing files touched

- `frontend/src/features/pipelines/state/pipelinesSlice.ts` — new `applyPipelineProposal` thunk
  (design.md D7; no new reducer state — the created pipeline isn't cached client-side today).
- `frontend/src/features/pipelines/state/pipelinesSlice.test.ts` — new
  `applyPipelineProposal thunk` describe block (fulfilled/rejected cases).

## Combined proposal (new)

- `frontend/src/features/proposals/types/combinedProposal.ts` — `CombinedProposal`,
  `CombinedProposalApplyResponse` types (design.md D3 — reuses `PipelineProposal`/
  `DashboardProposal`/`AppliedProposal` verbatim).
- `frontend/src/features/proposals/services/combinedProposalService.ts` —
  `applyCombinedProposal` → `POST /api/proposals/apply`.
- `frontend/src/features/proposals/state/combinedProposalsSlice.ts` — real `createSlice()`
  (`applying`/`error` state) with an `applyCombinedProposal` thunk that dispatches BOTH
  `dashboardUpserted` AND `setSelectedDashboardId` on success (design.md D7).
- `frontend/src/features/proposals/ui/CombinedProposalReview.tsx` — Modal wrapper rendering the
  unmodified `PipelineProposalSummary` for the pipeline half + NEW read-only JSX for the dashboard
  half (design.md D8 — not a reuse of `ProposalReview.tsx`), special-casing the
  `"$pipelineOutput"` sentinel (design.md Risk 1).
- `frontend/src/features/proposals/ui/CombinedProposalReviewPage.tsx` — route container for
  `/combined-proposals/review` (router-state proposal, DEV-only self-contained demo fixture,
  Accept → apply → navigate to `/`, Reject → navigate to `/`); reads `applying`/`error` from
  `combinedProposalsSlice` rather than local state.
- `frontend/src/features/proposals/ui/CombinedProposalReview.css` — styles for the dashboard-half
  panel list.
- `frontend/src/features/proposals/ui/CombinedProposalReview.test.tsx`,
  `frontend/src/features/proposals/ui/CombinedProposalReviewPage.test.tsx`,
  `frontend/src/features/proposals/state/combinedProposalsSlice.test.ts` — new tests.

## Wiring

- `frontend/src/features/assistant/ui/ProposalHandoff.tsx` — `pipeline`/`combined` branches now
  render a real "Review proposal" button navigating to the new routes, replacing the former
  informational-only fallback card.
- `frontend/src/features/assistant/ui/ProposalHandoff.css` — removed the now-dead
  `.proposal-handoff--info` styling.
- `frontend/src/features/assistant/ui/ProposalHandoff.test.tsx` — replaced the informational-only
  assertions with navigation tests for `pipeline`/`combined`.
- `frontend/src/app/AppRoutes.tsx` — added `/pipeline-proposals/review` and
  `/combined-proposals/review` routes, lazy-loaded like the existing `/proposals/review` entry.
- `frontend/src/store/store.ts` — registered `combinedProposalsReducer` as `combinedProposals`.

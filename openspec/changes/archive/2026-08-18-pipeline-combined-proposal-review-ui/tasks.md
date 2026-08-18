## 1. Frontend — Pipeline proposal types/service

- [x] 1.1 Add `frontend/src/features/pipelines/types/pipelineProposal.ts`: `PipelineProposalSource`,
      `PipelineProposal`, `PipelineProposalApplyResponse` (design.md D4/D5 — loose `steps`/`source`)
- [x] 1.2 Add `frontend/src/features/pipelines/services/pipelineProposalService.ts`:
      `applyPipelineProposal(proposal)` → `POST /api/pipelines/apply-proposal`
- [x] 1.3 Add `applyPipelineProposal` thunk to `frontend/src/features/pipelines/state/pipelinesSlice.ts`
      (mirrors `dashboardsSlice.applyProposal`'s shape/error-unwrap, design.md D7)

## 2. Frontend — Pipeline proposal review UI

- [x] 2.1 Add `frontend/src/features/pipelines/ui/PipelineProposalSummary.tsx`: read-only render of
      source (existing-source ref or inline type/config) + ordered steps (type + config summary,
      D4) + output DataType name — reused unmodified by the combined page (section 4)
- [x] 2.2 Add `frontend/src/features/pipelines/ui/PipelineProposalReview.tsx`: pure component wrapping
      `PipelineProposalSummary` in a `Modal` with Accept/Reject footer, mirrors `ProposalReview.tsx`'s
      applying/error prop shape
- [x] 2.3 Add `frontend/src/features/pipelines/ui/PipelineProposalReviewPage.tsx`: route container —
      `location.state.proposal`, DEV-only demo fixture (F-002 pattern), Accept → apply thunk →
      navigate `/pipelines/:id` (D6), Reject → navigate away, "Nothing to review" empty state
- [x] 2.4 Add `PipelineProposalReview.css` (mirror `ProposalReview.css`'s class naming/tokens)

## 3. Frontend — Combined proposal types/service

- [x] 3.1 Add `frontend/src/features/proposals/types/combinedProposal.ts`: `CombinedProposal`
      (`{pipeline: PipelineProposal, dashboard: DashboardProposal}`), `CombinedProposalApplyResponse`
      (`{pipeline: PipelineProposalApplyResponse, dashboard: AppliedProposal}`, D3)
- [x] 3.2 Add `frontend/src/features/proposals/services/combinedProposalService.ts`:
      `applyCombinedProposal(proposal)` → `POST /api/proposals/apply`
- [x] 3.3 Add `frontend/src/features/proposals/state/combinedProposalsSlice.ts`: real `createSlice()`
      (applying/error state) with an `applyCombinedProposal` thunk that on success dispatches BOTH
      `dashboardUpserted(response.dashboard.dashboard)` AND
      `setSelectedDashboardId(response.dashboard.dashboard.id)` from `dashboardsSlice.ts` (D7 —
      `dashboardUpserted` alone does not select the new dashboard; skeptic round 1 CR1 fix)
- [x] 3.4 Register `combinedProposalsReducer` as `combinedProposals` in `frontend/src/store/store.ts`
      (mirrors `patchSetsReducer`'s existing registration)

## 4. Frontend — Combined proposal review UI

- [x] 4.1 Add `frontend/src/features/proposals/ui/CombinedProposalReview.tsx`: pure component
      rendering `PipelineProposalSummary` (section 2.1, unmodified) for the pipeline half + NEW,
      dedicated read-only JSX (dashboard name + one row per panel: title/type/bound-DataType-name/
      field-mapping, no edit affordances) for the dashboard half — NOT a reuse of `ProposalReview.tsx`
      (design.md D8; that component owns its own Modal chrome + footer and cannot be embedded
      footer-less, skeptic round 1 CR2 fix), special-casing a `"$pipelineOutput"`-bound panel as
      "this pipeline's own output" (design.md Risk 1) instead of a `dataTypesById` lookup, single
      Accept/Reject footer
- [x] 4.2 Add `frontend/src/features/proposals/ui/CombinedProposalReviewPage.tsx`: route container —
      `location.state.proposal`, DEV-only demo fixture, Accept → apply thunk → navigate `/` (D6),
      Reject → navigate away, "Nothing to review" empty state
- [x] 4.3 Add `CombinedProposalReview.css`

## 5. Frontend — Wiring

- [x] 5.1 Update `ProposalHandoff.tsx`: `pipeline` branch → "Review proposal" button navigating to
      `/pipeline-proposals/review` with `{state: {proposal}}`; `combined` branch → same, to
      `/combined-proposals/review`; remove the now-dead informational-only fallback card
- [x] 5.2 Add `/pipeline-proposals/review` and `/combined-proposals/review` routes to
      `AppRoutes.tsx`, lazy-loaded like the existing `/proposals/review` entry

## 6. Tests

- [x] 6.1 `PipelineProposalReviewPage.test.tsx` — router-state proposal render, DEV fixture,
      accept/reject navigation, accept-error inline display, "nothing to review" empty state
- [x] 6.2 `PipelineProposalReview.test.tsx` — source/steps/output rendering, Accept/Reject callbacks
- [x] 6.3 `CombinedProposalReviewPage.test.tsx` — same coverage as 6.1 for the combined route
- [x] 6.4 `CombinedProposalReview.test.tsx` — nested pipeline+dashboard rendering, `"$pipelineOutput"`
      sentinel special-casing, Accept/Reject callbacks
- [x] 6.5 `ProposalHandoff.test.tsx` — update/extend for the new `pipeline`/`combined` "Review
      proposal" buttons replacing the old informational-only assertions
- [x] 6.6 `pipelinesSlice.test.ts` — `applyPipelineProposal` thunk fulfilled/rejected cases
- [x] 6.7 `combinedProposalsSlice.test.ts` — `applyCombinedProposal` thunk fulfilled/rejected cases,
      including BOTH the `dashboardUpserted` AND `setSelectedDashboardId` dispatches on success

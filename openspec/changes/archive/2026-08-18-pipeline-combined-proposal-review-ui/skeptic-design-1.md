## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-proposal-review-ui/spec.md`, `workflow-state.md` in full.
- Confirmed the ticket's premise against ground truth:
  `frontend/src/features/assistant/ui/ProposalHandoff.tsx` does fall through
  to an informational card for `pipeline`/`combined` kinds (read the whole
  file) — the gap is real.
- Confirmed `AppRoutes.tsx` currently has `/proposals/review` (lazy),
  `/patch-sets/review` (NOT lazy — direct top-level import), `/pipelines/:id`
  — all as the design assumes for D1/D6.
- Confirmed backend ground truth by reading
  `PipelineProposalProtocol.scala`, `CombinedProposalProtocol.scala`,
  `PipelineProposalRoutes.scala`, `CombinedProposalRoutes.scala`,
  `CombinedProposalService.scala`, `ProposalPanelSupport.scala`,
  `DashboardProtocol.scala` (`DuplicateDashboardResponse`),
  `PipelineProtocol.scala` (`PipelineSummaryResponse.id` exists — needed for
  D6's `/pipelines/${response.pipeline.id}` navigation) and
  `PipelineStepProtocol.scala` (`CreatePipelineStepRequest(type, config:
  JsObject, position, enabled)`).
- Confirmed frontend precedents by reading `ProposalReviewPage.tsx` (full),
  `ProposalReview.tsx` (full, 216 lines), `dashboardsSlice.ts` (full
  `applyProposal`/`dashboardUpserted`/`extraReducers` block),
  `patchSetsSlice.ts` (`invalidateAffectedState`'s `dashboardUpserted`
  usage), `PanelList.tsx` (`selectedDashboardId` dependency),
  `PipelineDetailPage.tsx`/`PipelinesPage.tsx` (fetch-on-mount confirmed),
  `pipelinesSlice.ts`, `store.ts` (root reducer registration list),
  `proposalExtraction.ts`, `frontend/src/features/dashboards/types/proposal.ts`.
- Most of the design's specific factual claims check out: D3's
  `DuplicateDashboardResponse` ↔ `AppliedProposal` byte-shape-identity claim
  is correct (verified both case classes field-by-field); D5's
  `PipelineProposalSource` flat-optional/shared-`"config"`-key claim matches
  the hand-written `pipelineProposalSourceFormat` reader/writer exactly; D6's
  pipeline-accept navigation target (`response.pipeline.id`) is a real field;
  the two backend routes (`POST /api/pipelines/apply-proposal`,
  `POST /api/proposals/apply`) exist exactly as described.

### Verdict: REFUTE

Two concrete, code-grounded defects in the design that would ship a feature
violating its own stated acceptance criteria or requiring untracked scope,
plus one real ambiguity that should be closed before implementation.

### Change Requests

1. **Combined-proposal accept will not actually select the new dashboard —
   contradicting the spec's own acceptance scenario.**
   `design.md` D7 / `tasks.md` 3.3 say the `applyCombinedProposal` thunk
   "dispatches `dashboardUpserted` with the response's dashboard half on
   success." But `dashboardUpserted` (`frontend/src/features/dashboards/state/dashboardsSlice.ts:216-223`)
   only pushes/replaces the dashboard in `state.items` — it never touches
   `state.selectedDashboardId`. Compare `applyProposal.fulfilled`
   (lines 308-311), which does both (`state.items.push(...)` AND
   `state.selectedDashboardId = action.payload.dashboard.id` — the
   `ProposalReviewPage.tsx` comment explicitly calls this out: "The thunk's
   fulfilled reducer inserts *and selects* the created dashboard in the same
   dispatch cycle"). `PanelList.tsx` (the `/` route) reads
   `state.dashboards.selectedDashboardId` to pick which dashboard to render
   (line 27/35). So as literally specified, after a combined-proposal accept
   + `navigate("/")`, the user lands on whatever dashboard was previously
   selected (or none) — NOT the one they just created. This directly
   contradicts `specs/pipeline-proposal-review-ui/spec.md`'s own "Accepting a
   combined proposal" scenario ("navigates to `/` with the created dashboard
   selected") and proposal.md's D6 rationale. The `patchSetsSlice`
   precedent design.md cites for this pattern (`invalidateAffectedState`,
   `patchSetsSlice.ts:187-191`) is not actually analogous: it syncs an
   *already-selected/loaded* dashboard's cache after an edit, and never
   needs to newly select anything — it does not establish that
   `dashboardUpserted` alone is sufficient to make a *brand-new* dashboard
   the active one. **Required fix:** design.md D7 and tasks.md 3.3 must also
   dispatch `setSelectedDashboardId(response.dashboard.dashboard.id)` (the
   action already exists, exported from the same slice) alongside
   `dashboardUpserted` on combined-proposal apply success.

2. **The plan to reuse "the existing `ProposalReview` panel-list rendering"
   for the combined page's dashboard half is not achievable as stated, and
   the refactor it actually requires is untracked.**
   `proposal.md`'s "What Changes" and `tasks.md` 4.1 both describe the
   combined page's dashboard half as "reusing the existing `ProposalReview`
   panel-list rendering" with "a single Accept/Reject footer covering both
   halves." But `ProposalReview.tsx` (read in full,
   `frontend/src/features/dashboards/ui/ProposalReview.tsx`) is one
   monolithic component: it wraps itself in its own `<Modal open ...
   onClose={onReject}>`, owns its own footer with its own Accept ("Accept &
   create") / Reject buttons wired directly to `onAccept`/`onReject`
   (lines ~69-86), and interleaves the panel-list JSX with local
   `useState`-held `name`/`panels` edit state (`updateTitle`, `removePanel`,
   `bindingIssue`) — there is no separately importable "just the panel list"
   piece, and no prop to suppress its own Modal chrome or its own footer.
   Dropping `ProposalReview` into `CombinedProposalReview` as-is would
   render a *second*, dashboard-scoped Accept/Reject pair nested inside
   (or alongside) the combined page's own single footer — directly
   contradicting "a single Accept/Reject pair covering both halves
   atomically." Achieving the stated goal genuinely requires either (a)
   refactoring `ProposalReview.tsx` to extract a reusable, footer-less
   panel-list sub-component, or (b) writing new (not "reused") panel-list
   JSX for the combined page. Neither is reflected anywhere: `proposal.md`'s
   Impact section lists no change to `ProposalReview.tsx`, and no task
   touches it. **Required fix:** design.md must pick (a) or (b) explicitly,
   and if (a), add `ProposalReview.tsx` to the Impact section and a task to
   extract the shared piece (also then confirm design.md's stated Non-Goal —
   "beyond what `ProposalReview.tsx` already lets a dashboard-half reviewer
   do (title edit/panel removal)" — is still intended, since that implies
   the combined page's dashboard half keeps per-panel editing state that a
   single top-level Accept/Reject pair has to collect from).

### Non-blocking notes

- `tasks.md` 3.3 names a new file `combinedProposalsSlice.ts`, matching the
  naming convention of every other `*Slice.ts` in this codebase (all of
  which are `createSlice()` + registered in `store.ts`'s root reducer, e.g.
  `pipelinesReducer`/`patchSetsReducer`/`dashboardsReducer`). If this file
  ends up being a real `createSlice()` (not just a bare `createAsyncThunk`
  export, as the `ProposalReviewPage.tsx`-style local-`useState`-for-
  applying/error precedent might suggest), it needs a `store.ts`
  registration that's mentioned nowhere in proposal.md's Impact list or
  tasks.md. Worth one sentence in design.md clarifying whether this file
  owns any reducer state at all, to avoid an implementer discovering the gap
  only when `state.combinedProposals` doesn't exist.
- D4's frontend `steps` type (`{type: string, config: Record<string,
  unknown>, position?: number}[]`) omits the backend's `enabled?: boolean`
  field (`CreatePipelineStepRequest`, `PipelineStepProtocol.scala:151`).
  Harmless functionally since the untouched JSON payload still carries
  whatever fields were present at runtime, but worth adding to the type for
  completeness/documentation accuracy.
- proposal.md's Impact section says the new routes will be "lazy-loaded
  alongside the existing `/proposals/review` and `/patch-sets/review`
  entries" — `/patch-sets/review` is actually NOT lazy-loaded today (direct
  top-level import in `AppRoutes.tsx`); only `/proposals/review` is. Minor
  factual inaccuracy, doesn't block implementation (the design intent —
  "make the new routes lazy" — is still clear and correct).

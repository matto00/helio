## Why

`frontend/src/features/assistant/ui/ProposalHandoff.tsx` already knows how to
hand a `dashboard` proposal off to `/proposals/review`
(`ProposalReviewPage.tsx`) and a `patch` proposal off to `/patch-sets/review`
(`PatchSetReviewPage.tsx`). For `pipeline` and `combined` proposals — the
output of the assistant's `propose_pipeline` / `propose_combined` tools,
whose backend apply paths (`POST /api/pipelines/apply-proposal`,
`POST /api/proposals/apply`) have been live since HEL-383/HEL-387 — it falls
through to a plain "This proposal type doesn't have a review page yet" card.
A user who drives the web assistant through source → pipeline → dashboard
authoring hits a dead end: the proposal is generated but cannot be reviewed
or applied from the web app at all. The only working path today is the
separate PAT-based MCP surface (HEL-385), not the UI most users touch.

## What Changes

- Add a **Pipeline Proposal Review** page (`/pipeline-proposals/review` —
  see Design Decision D1 for the route-naming choice) that renders a
  `PipelineProposal`'s proposed source (existing or inline
  csv/rest_api/sql/static), ordered steps, and output DataType name, with
  Accept (→ `POST /api/pipelines/apply-proposal`) and Reject actions —
  mirroring `ProposalReviewPage.tsx`/`PatchSetReviewPage.tsx`'s existing
  route-container + pure-presentational-component split, DEV-only demo
  fixture, and Accept/Reject wiring.
- Add a **Combined Proposal Review** page (`/combined-proposals/review`)
  that renders a `CombinedProposal`'s nested pipeline proposal (reusing the
  same read-only summary component the pipeline-only page renders) alongside
  a new, dedicated read-only rendering of its nested dashboard proposal
  (name + panel list) — see Design Decision D8 for why this is new JSX
  rather than a reuse of `ProposalReview.tsx` — with a single Accept
  (→ `POST /api/proposals/apply`) / Reject pair covering both halves
  atomically.
- Wire `ProposalHandoff.tsx`'s `pipeline` and `combined` branches to real
  "Review proposal" buttons that `navigate(...)` to the new pages with the
  extracted proposal in router state, replacing the current
  informational-only card for those two kinds.
- Add the new route(s) to `AppRoutes.tsx`, lazy-loaded like the existing
  `/proposals/review` entry (`/patch-sets/review` is not itself lazy-loaded
  today, so it is not a lazy-loading precedent here).
- New frontend types/services for `PipelineProposal`/`CombinedProposal` and
  their apply responses — currently zero frontend references to either
  concept anywhere in the codebase.

## Not in Scope

- Standalone "source proposal," "type proposal," or "metric proposal" review
  UI — none of these are real, distinct backend concepts (verified via
  full-repo grep: zero matches for `SourceProposal`/`TypeProposal`/
  `MetricProposal`). Source creation is already covered as a nested field of
  the pipeline proposal; metric binding already flows through the existing
  dashboard proposal review UI via `metricId`.
- Wiring the existing dry-run `GET /api/pipelines/:id/analyze` preview into
  either new review page — see Design Decision D2 for why this ticket's own
  "Consider surfacing" is not actionable as stated.
- Any change to the backend apply/analyze routes, services, or protocols
  themselves (HEL-383/HEL-387 already shipped and are reused verbatim).

## Impact

- Affected specs: `pipeline-proposal-review-ui` (new capability).
- Affected code:
  - `frontend/src/features/assistant/ui/ProposalHandoff.tsx` (wire the two
    remaining branches).
  - `frontend/src/app/AppRoutes.tsx` (new route(s)).
  - New: `frontend/src/features/pipelines/types/pipelineProposal.ts`,
    `frontend/src/features/pipelines/services/pipelineProposalService.ts`,
    `frontend/src/features/pipelines/ui/PipelineProposalSummary.tsx`,
    `frontend/src/features/pipelines/ui/PipelineProposalReview.tsx`,
    `frontend/src/features/pipelines/ui/PipelineProposalReviewPage.tsx`
    (+ matching `.css`/`.test.tsx`).
  - New: `frontend/src/features/proposals/types/combinedProposal.ts`,
    `frontend/src/features/proposals/services/combinedProposalService.ts`,
    `frontend/src/features/proposals/state/combinedProposalsSlice.ts`,
    `frontend/src/features/proposals/ui/CombinedProposalReview.tsx`,
    `frontend/src/features/proposals/ui/CombinedProposalReviewPage.tsx`
    (+ matching `.css`/`.test.tsx`).
  - `frontend/src/features/pipelines/state/pipelinesSlice.ts` (new
    `applyPipelineProposal` thunk).
  - `frontend/src/store/store.ts` (register `combinedProposalsReducer`,
    mirroring `patchSetsReducer`'s registration).
  - `ProposalReview.tsx` is NOT touched — see Design Decision D8.
- No backend or schema changes.

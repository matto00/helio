# HEL-739: Pipeline (and Combined) Proposal Review UI — close the web-app authoring dead end

## Description

The in-app assistant can already produce fully-validated `PipelineProposal` and `CombinedProposal` payloads (`propose_pipeline` / `propose_combined` tools; backend routes `POST /api/pipelines/apply-proposal` and `POST /api/proposals/apply` are live — HEL-383/HEL-387), but the web UI has no way to review or apply them.

`frontend/src/features/assistant/ui/ProposalHandoff.tsx` explicitly branches on proposal kind: `dashboard` → navigates to `/proposals/review` (`ProposalReviewPage.tsx`); `patch` → navigates to `/patch-sets/review` (`PatchSetReviewPage.tsx`); but `pipeline` / `combined` (lines 73-83) fall through to a plain informational card reading "This proposal type doesn't have a review page yet" — a deliberate, self-documented gap (comment at lines 17-19/75-76), not a bug. Confirmed via exhaustive grep: zero frontend references to `PipelineProposal`/`CombinedProposal` anywhere, and no route exists for either.

This means a user driving the web assistant through the source → pipeline → dashboard flow to author a pipeline (or a full combined proposal) hits a dead end — the proposal is generated but cannot be applied from the web app at all. (The only working path today is the separate PAT-based MCP surface, HEL-385 — not the web UI most users will actually touch.)

## Scope

Mirror the two shipped precedents, `ProposalReviewPage.tsx` and `PatchSetReviewPage.tsx`:

1. A pipeline/combined proposal review page rendering the proposed source/steps/output-DataType shape (and, for `combined`, the nested dashboard proposal too), with Accept (→ the existing `POST /api/pipelines/apply-proposal` / `POST /api/proposals/apply`) and Reject actions. Consider surfacing the existing dry-run `GET /api/pipelines/:id/analyze` (HEL-381) preview before commit.
2. Wire `ProposalHandoff.tsx`'s `pipeline | combined` branch to a real "Review proposal" button/navigate call instead of the current informational-only card.
3. Add the new route(s) to `AppRoutes.tsx` alongside the existing `/proposals/review` and `/patch-sets/review` entries.

## Not in scope

Standalone "source proposal," "type proposal," or "metric proposal" review UI — none of these are real, distinct backend concepts (verified via full-repo grep, zero matches for `SourceProposal`/`TypeProposal`/`MetricProposal`). Source creation is already covered as a nested field of the pipeline proposal; metric binding already flows through the existing dashboard proposal review UI via `metricId`.

## Context

Filed 2026-08-17 from live user testing of the agentic authoring flow. No duplicate — HEL-383/HEL-387 only ever scoped the backend apply-path; no follow-up UI ticket was filed when HEL-659/662 built `ProposalHandoff.tsx`'s honest-limitation fallback.

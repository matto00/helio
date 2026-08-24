# Proposals

Combined (dashboard + pipeline) NL-authoring proposal review:
`state/combinedProposalsSlice.ts`, the API client
(`services/combinedProposalService.ts`), wire types
(`types/combinedProposal.ts`), and the review UI (`ui/CombinedProposalReview`,
`CombinedProposalReviewPage`).

**Belongs here:** the review/apply flow for a proposal that spans both a
dashboard and its backing pipelines.
**Does not belong here:** single-domain proposal review — dashboard-only
proposals live in `dashboards`, pipeline-only proposals in `pipelines`.

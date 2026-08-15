/** Shared copy for the "no pipeline-output data to build from" empty state, used by
 *  `ProposalReviewPage` (a proposal with zero panels). Originally shared with the now-deleted
 *  `AuthoringChatDrawer` (an authoring call that failed with kind `EmptyWorkspace`, HEL-401
 *  design.md D5's "reuse the SAME copy, don't re-author it" ask; HEL-666 retired that consumer).
 *  Kept as its own constant rather than an inline literal so a future authoring-adjacent surface
 *  can reuse it without drifting out of sync. */
export const EMPTY_WORKSPACE_COPY = {
  title: "No proposal to review",
  description:
    "Create a pipeline (source → pipeline → output type) so a dashboard can be proposed over its data, then try again.",
} as const;

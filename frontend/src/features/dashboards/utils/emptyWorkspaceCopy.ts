/** Shared copy for the "no pipeline-output data to build from" empty state — used by BOTH
 *  `ProposalReviewPage` (a proposal with zero panels) and `AuthoringChatDrawer` (an authoring call
 *  that failed with kind `EmptyWorkspace`, HEL-401 design.md D5's explicit "reuse the SAME copy,
 *  don't re-author it" ask). Kept as a single shared constant rather than duplicating the literal
 *  strings in both files, so the two surfaces can never drift out of sync. */
export const EMPTY_WORKSPACE_COPY = {
  title: "No proposal to review",
  description:
    "Create a pipeline (source → pipeline → output type) so a dashboard can be proposed over its data, then try again.",
} as const;

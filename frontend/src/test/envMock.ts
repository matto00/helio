export const API_BASE_URL = "";
// F-002: mocked `false` so `ProposalReviewPage`/`PatchSetReviewPage`'s DEV-only
// demo-fixture path never activates under Jest — tests exercise the
// `location.state`-driven path and the "nothing to review" empty state.
export const IS_DEV = false;

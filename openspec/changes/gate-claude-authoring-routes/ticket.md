# HEL-1205: Free-tier users can drive unlimited Claude calls via /api/authoring/dashboard and /api/refinements (no tier or daily-usage gate)

## Description

Registration is open and new users default to tier free. The workspace assistant returns 403 TIER_FORBIDDEN to free users and applies the beta daily limit (ChatAccessService, HEL-703). Two other routes call ClaudeClient with no tier check and no daily-usage accounting: POST /api/authoring/dashboard (DashboardAuthoringRoutes -> DashboardAuthoringService) and POST /api/refinements (RefinementRoutes -> RefinementService). Both are mounted unconditionally for every authenticated user. A self-registered free account can make unbounded Claude calls on the prod API key; the only brake is the general /api limiter.

## Scope

- Gate both routes through the same ChatAccessService tier + daily-usage check: free -> 403 TIER_FORBIDDEN, beta -> counted against shared assistant_daily_usage -> 429 CHAT_LIMIT_REACHED, owner unlimited. One mechanism, not a copy.
- Sweep for any other ClaudeClient consumer reachable by an authenticated user without that gate (pipeline AI steps gated via HEL-1108; confirm) and list them in the PR.
- If /api/authoring/dashboard has no real caller, say so; removing it is acceptable alternative (state which, and why). (Driver direction: removal is an owner scope decision; gate it, do not remove.)

## Acceptance Criteria

- Red-first: a free-tier session reaches the Claude client (observed via a test double) on both routes on current main, then 403 after the fix.
- A beta user's calls on these routes increment the same daily counter as chat, and the (limit+1)th returns 429.
- No regression for owner tier; a missing ANTHROPIC_API_KEY still yields 503.
- 403/429 wire shape identical to the assistant's (TierErrorResponse); frontend refinement UI renders these errors; helio-mcp propose_patch_set copy documents the real codes (live-probed).

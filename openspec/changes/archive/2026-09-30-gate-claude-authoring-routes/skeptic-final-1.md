## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 545247563bc66e4ede6972b113cdc12a0af0b67d against base 74d67ff7.

### What I verified (with evidence)
- Independent sweep (grep of backend/src/main for ClaudeClient/ClaudeTransport plus every `new ClaudeClient` site in ApiRoutes): exactly four construction sites — pipeline AI step client (:400, gated by AiPipelineQuotaGate.Live on the same assistant_daily_usage row; unconstructible without DbContext), DashboardAuthoringService (:687, only mounted via DashboardAuthoringRoutes), RefinementService (:711, only via RefinementRoutes), AssistantService (:731, only via AssistantConversationRoutes, already gated). No other route/class holds these services. Authoring sub-routes (conversations GET, requests/outcome) make no Claude call and stay ungated.
- Gate placement: authoring `gated{}` wraps both stream and buffered branches, after 503 (serviceOpt) and body-parse, before service call; by-name inner so nothing runs on denial. Refinement same ordering. `chatAccessOpt = None` with a live service -> 503 (fail closed). ApiRoutes passes chatAccessServiceOpt (declared at :565, before the routes at :991, so no null-capture init-order issue).
- Charge ordering / shared counter: `guardAndCount` = guard + checkConverseCap -> the same incrementIfUnderCap on assistant_daily_usage as converse. Tests assert cross-direction sharing against the real DB row.
- Wire shape: shared `TierErrorCompletion.completeTierError` (extracted from assistant routes, which now use it) -> identical TierErrorResponse. Live probe evidence shows 403/429 JSON on all three paths incl. stream.
- Tests: ran ClaudeRoutesChatGateSpec + DashboardAuthoringRoutesSpec + RefinementRoutesSpec fresh: 23/23 pass. Red proof: the evidence spec is a line-for-line copy of the final fixture (diffed) differing only in 2-arg route constructors (the unmodified main signature) and asserting post-fix behaviour; recorded output shows free tier status 200, stubTransportCalls=1 on all three paths. Genuine. Mutation: I ran my OWN stream-only mutation (gate bypassed on the `?stream=true` branch only) in a scratch copy: the streaming-403 test, shared-counter test and fail-closed test went red (3 failed). Gates are failable per path. (Scratch copy deleted; worktree untouched.)
- helio-mcp: diff reviewed. CHAT_LIMIT_REACHED 429 thrown immediately with code in message; other 429s (incl. test with RATE_LIMITED code + Retry-After) still retried; error body read once, non-JSON tolerated; 401 path unchanged. `npx jest helio-mcp` 30 suites / 305 tests pass; `npm run typecheck` clean. Tool copy documents the live-probed codes.
- Frontend: useRefinement / refinementService / RefinementChatDrawer tests 26/26 pass; they assert the server message is rendered for 403/429 (existing error path; no frontend source change needed). No UI style changes, so visual judgment not applicable.
- No real Anthropic calls: all tests use CountingTransport; probe used a fake key with limit 0.
- evidence/sbt-test-full.txt shows 4953 tests, 0 failed (claim; I re-ran the affected specs myself).

### Verdict: CONFIRM

### Non-blocking notes
- Beta users are charged before the Claude call, so a downstream 502/422 still consumes a message; this matches assistant converse semantics and the design.
- mutation-proof.txt is a bare excerpt without commands; my independent mutation corroborates it.

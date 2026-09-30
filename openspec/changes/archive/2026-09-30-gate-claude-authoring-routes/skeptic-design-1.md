## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Premise: DashboardAuthoringRoutes.scala and RefinementRoutes.scala (api/routes/proposals, api/routes/patchsets) take only
  Option[Service] + user; no tier/usage check anywhere. ApiRoutes.scala:991/995 mount them with no ChatAccessService. Premise holds on the live tree.
- ClaudeClient sweep: all four `new ClaudeClient` sites are ApiRoutes:400/686/710/729 and each row's consumer/gate is correct.
  grep of `sendWithTools(`, `.send(ClaudeRequest`, `.stream(ClaudeRequest` outside infrastructure/ai: AssistantService:94,
  DashboardAuthoringService:307/327/352/418, RefinementService:143/162, ClaudeAiStepClient:37. No missed consumer. Only one
  Anthropic URL (HttpClaudeTransport:135). Pipeline AI steps are gated (aiStepClient only constructible with AiPipelineQuotaGate.Live).
- Streaming: gate placed above the `stream` branch (design D2) covers both; the stream repair call (l.418) is inside the same request.
- Sub-routes: GET conversations/:id and POST requests/:id/outcome make no Claude call (no claudeClient reference reachable from them).
- Declaration order: chatAccessServiceOpt is at ApiRoutes ~l.565, before the service vals (l.686/710) and mount (l.991): no null capture.
  (Stale comment at l.385 says ":488"; harmless.)
- Ordering 503 -> body parse -> gate: serviceOpt.fold comes first (no charge on 503), and entity/param parsing failures 400 before charge. Sound.
- Charging: incrementIfUnderCap is atomic and a denied attempt does not increment, so 429s never double-charge. One unit per request with at most
  one internal repair call is bounded (<=2 model calls per unit).
- Frontend premise: RefinementRequestError already surfaces `message` from any body (refinementService.ts:38-40), so 3.1 is mostly a test; no
  frontend caller of POST /api/authoring/dashboard (only fetch-conversation and outcome) confirmed.

### Verdict: CONFIRM

### Non-blocking notes (address during execution)
1. helio-mcp httpClient.ts retries every 429 up to MAX_RATE_LIMIT_RETRIES=5 with 1/2/4s backoff (its docstring assumes a 429 never reached the
   handler). The new CHAT_LIMIT_REACHED 429 (no Retry-After) will be retried ~5 times and only then surfaced; it does not double-charge (denials
   do not increment) but wastes ~15s and the docstring premise is now false. Task 3.2's live probe must observe what the MCP agent actually sees
   for 403 and 429, and consider not retrying a 429 whose body code is CHAT_LIMIT_REACHED.
2. Charge-before-validate: a beta request that then fails service-side validation (unknown conversationId, refinement target 404/403) burns a unit
   without a model call, unlike converse which fetches the conversation first. Self-inflicted only, not a bypass; acceptable, but state it in the design.
3. Add an explicit test for the fail-closed path (service Some, ChatAccessService None -> 503, zero transport calls); tasks 1.5/2.x only implies it.
4. useRefinement effect fires POST on mount/dep change without abort; React StrictMode (dev) double-invokes it, charging twice. Dev-only, note it.
5. Test 2.3 should also assert the cap is shared in both directions (route calls exhaust converse, and converse calls exhaust routes) and that a
   replayed converse idempotency key still does not charge.

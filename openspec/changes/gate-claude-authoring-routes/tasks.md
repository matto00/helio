## 1. Backend gate

- [x] 1.1 Add `ChatAccessService.guardAndCount` composing `guard` + `checkConverseCap` (unit-tested: free/beta under/at cap/owner)
- [x] 1.2 Extract the tier-error completion helper from `AssistantConversationRoutes` and reuse it there (behavior unchanged)
- [x] 1.3 Gate `DashboardAuthoringRoutes` POST `/authoring/dashboard` (buffered + stream) after 503/body-parse, before the service
- [x] 1.4 Gate `RefinementRoutes` POST `/refinements` the same way
- [x] 1.5 Wire `chatAccessServiceOpt` into both routes in `ApiRoutes`; missing gate with a live service fails closed (503)

## 2. Tests (red-first, test-double transport only; never real Claude calls)

- [x] 2.1 On unmodified main code, demonstrate a free-tier session reaching the stub Claude transport on both routes (record output)
- [x] 2.2 Free 403 on both routes (buffered, stream, refinements) with zero transport calls
- [x] 2.3 Beta: counter shared with assistant converse; (limit+1)th 429 with `limit`; owner uncounted
- [x] 2.4 503 without key does not charge; outcome/conversation-read sub-routes not charged
- [x] 2.4a Fail-closed: service present but ChatAccessService absent -> 503, zero transport calls
- [x] 2.4b Shared cap both directions (route calls exhaust converse and vice versa); replayed converse idempotency key still not charged
- [x] 2.5 Mutation proof: removing the gate call turns 2.2/2.3 red

## 3. Frontend and MCP

- [x] 3.1 Refinement hook/drawer shows the 403/429 server message (test)
- [x] 3.2 Update `propose_patch_set` tool copy with the live-probed 403/429 codes; update MCP tests

- [x] 3.3 helio-mcp httpClient: do not retry a 429 whose body code is `CHAT_LIMIT_REACHED` (surface immediately); fix its docstring premise; test

## 4. Sweep and docs

- [x] 4.1 Re-verify the ClaudeClient consumer sweep in design.md against the final tree; list it in the PR body

## Standing Constraints

- [C1] Tests and probes use a stub/test-double Claude transport only; never spend real Anthropic API tokens.
- [C2] Red-first: show a free-tier session reaching the Claude client on unmodified main code before the fix, then 403 after.
- [C3] Bash calls that can run hooks/sbt/jest use timeout 600000; max 3 workers, nice -n 19.

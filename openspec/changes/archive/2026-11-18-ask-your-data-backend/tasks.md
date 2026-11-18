## Standing Constraints

- [C1] Never read, cat, grep, source or print any .env file; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ). Scripts may read scripts/concertino/.concertino.env; never print it.
- [C2] Quoted heredocs only (<<'EOF'), or Write/Edit; no backticks or $(...) inside echo strings.
- [C3] No pkill/pgrep/killall; kill only by exact PID; stop servers with stop-servers.sh; delete DB residue only by exact id (guarded buildUserDeleteSql); throwaway emails are plain addresses.
- [C4] jest maxWorkers 3, Playwright workers 2, sbt -J-Xmx3g, nice -n 19.
- [C5] timeout: 600000 on long calls; use sbt testFull and read the summary (it can print TESTS FAILED and exit 0).
- [C8] No prod actions, no release cut, no concertino sync.
- [C12] RED FIRST: tests before code, red runs recorded; every guard (scope re-checks especially) has a recorded mutation.
- [C13] Scratch only in .concertino/scratch/HEL-1745/.
- [C15] Live check: Haiku only (claude-haiku-5-5), model id asserted before the first call, 3 questions, $1 hard cap (stop at $0.75 projected); Sonnet/Opus only via fakes; never print the API key; report any file landing under ~/.helio by exact path, never delete it.

### Backend

## 1. Grounding offset and scope

- [x] 1.1 Add `firstCitation: Int = 1` to `InsightContextBuilder.pack` (D6); default output byte-identical
- [x] 1.2 `AskScope` + `AskAccess`: dashboard owner-or-grant-row; Output via `readablePipelineId` (explicit SQL, never RLS alone) (D2)
- [x] 1.3 Per-call scope resolution, nothing cached: access re-check + board Output-to-panels map; Output path = one Output (D4)

## 2. Tools and loop

- [x] 2.1 `AskTools` definitions (four read tools, input schemas, limits) (D5)
- [x] 2.2 `AskCitationLedger.packAndRecord`: shed, then pack + append in one synchronized step (D5/D6)
- [x] 2.3 `AskToolExecutor`: rows via binding panels in order; history via forOutput + fromResolution, point ids only with grant; history-rows re-checks grant (D4/D5)
- [x] 2.4 `AskPrompts` system prompt and sanitized question (D8)
- [x] 2.5 `AskDataService`: sendWithTools maxHops 4, webSearch false, no temperature; validate; one corrective retry; outcomes (D7)
- [x] 2.6 Pin block: one pipeline, requireAccess Owner/Editor, 1..8 non-insight reads, name = question cut to 80, no answer text, no render (D10)

## 3. Routes, billing, contract

- [x] 3.1 `AskProtocol` request/response (no model/usage/cost fields) (D9)
- [x] 3.2 `AskRoutes`: access, question validation, guard + checkConverseCap(weightOf(serverDefault)), 503 without client (D2/D3)
- [x] 3.3 Wire in `ApiRoutes.scala` (authenticated tree only)
- [x] 3.4 `schemas/ask/ask-request.schema.json` and `ask-response.schema.json`
- [x] 3.5 CLAUDE.md key-endpoints entry for both ask routes

### Tests

## 4. Tests (red first, mutations recorded)

- [x] 4.1 Fail-first: dashboard-only viewer's off-board `get_output_rows`/`get_output_history` and any `get_history_rows` give error results, no data; no point ids returned; mutate each check, record the red
- [x] 4.1b Per-call re-check: panel removed (and separately grant revoked) between hop 1 and hop 2 gives an error result in hop 2; red against a loop-start cache
- [x] 4.1c Concurrency: two `get_output_history` calls in one scripted response get disjoint ids resolving to their own Outputs; red with the lock removed
- [x] 4.1d Two panels bind one Output; only the second offers the filter column; filter served through it
- [x] 4.2 Tool-schema assertion: only the four read tools; no write/propose/web_search; `webSearch = false` on the request
- [x] 4.3 Day-14 fixture: fake model reads history and its answer cites the day-14 citation; mutate the ledger/offset and record the red
- [x] 4.4 Access: unauth 401; dashboard stranger, public-grant stranger, share-token holder, Output-route stranger all 404, no model call, no charge; Output-route red against a findById-only gate
- [x] 4.5 Billing: free 403 TIER_FORBIDDEN; beta charged weightOf(server default) with fakes for Haiku 1 / Sonnet 4 / Opus 8 defaults; owner uncounted; retry not re-charged; empty question 400
- [x] 4.6 Validation: uncited numeral triggers one retry then 422 ASK_UNGROUNDED; response never has model/usage/cost keys
- [x] 4.7 Pin: editor gets a pin whose body creates an insight Output via POST /api/pipelines/:id/outputs (refresh manual, prompt = question, no answer text); viewer and cross-pipeline get null
- [x] 4.8 `InsightContextBuilderSpec`: default numbering unchanged, offset numbering starts at the offset
- [x] 4.9 Catalog rules: no temperature/top_p/top_k, no budget_tokens, no forced tool_choice in the sent request
- [x] 4.11 Data budget: a 7th data tool call (or one past 12k estimated tokens) gets the "data budget reached" error result; trial packs never enter the ledger
- [x] 4.10 Live check (C15): 3 Haiku questions on the lane backend; evidence/live-check.md with request ids, response model, usage, cost; fixture rows deleted by exact id

## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD c03fc0a4ad97b1dd17000c0fa2a543e37b57cce5. The planning artifacts are untracked in the change dir (`git status`: `?? openspec/changes/ask-answer-cap-and-reasons/`).

### What I verified (with evidence)

- **Spawn cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/ask-answer-token-cap/HEL-1761`.
- **Round-1 CR 1 (scope of "truncated" hops): resolved, using option (a).**
  - The spec now reads "A hop that ends the tool loop (it carries no tool call) and stops with `stop_reason: max_tokens` SHALL ...". It also says a tool-carrying `max_tokens` hop is outside the rule and that scope is still checked.
  - D3 has a matching "Scope" bullet, and Risks has a matching line.
  - Against the code:
    - `ClaudeClient.scala:134` treats only `toolUses.isEmpty` as final.
    - The tool branch runs `executeTool`, and the ask executor re-checks scope.
    - `logHop` (`:177`) logs `stop_reason`.
  - Spec, design and code now agree, and `ClaudeClient`'s loop is left unchanged, so `AssistantService` and `ClaudeInsightClient` are not affected.
- **Round-1 non-blocking notes: all four were taken up.**
  - Route-level partial-text test: task 1.4b.
  - V98 wording: the spec now says "a null root id, which V98's backfill should have eliminated".
  - D1 now discusses the effort level of non-Haiku models.
  - D2 settles on a new `{message, code}` type.
- **Current-behaviour claims, re-derived from the code:**
  - `AskDataService.scala:39`: `MaxAnswerTokens = 1024`, used in `request(...)` for both the main request and the corrective request.
  - `failure`: `NoAnswer` maps to `BadGateway`, which is a 502.
  - A partial-text `max_tokens` hop: `ClaudeClient.scala:138-142` gives `FinalResponse`, the answer is validated, and it can be returned truncated.
  - Clamps: `ClaudeClient.scala:327,402` clamp `maxTokens` to `config.maxOutputTokens`, and `ClaudeConfig.DefaultMaxOutputTokens = 4096` (line 39). `grep CLAUDE_MAX_TOKENS infra .github` gives 0 hits.
  - `AskRoutes.scala:56-60` returns `reasons` verbatim.
  - `InsightValidator.scala` lines 19/23/25/27/68/73 produce:
    - an empty-text reason
    - `citation marker [id]`
    - character and sentence counts
    - `date '...'`
    - `numeral '...'`
  - D5's prefix map plus its catch-all covers each of these, and the extra final digit strip backs it up. The main loop's `HopBudgetExhausted` reason is hard-coded in `AskDataService` and is mapped too.
- **The `FinalResponse` second-list change is source-compatible.**
  - `ClaudeModels.scala:213-215` already has a second list `(val responseModel: Option[String] = None)`. A defaulted `stopReason` added after it does not change `unapply`.
  - Main-code use sites:
    - `AssistantService:152,154`
    - `AskDataService:53,63`
    - `ClaudeInsightClient:31`
    - construction only at `ClaudeClient:142`, which is positional `(apiResponse.model)` and stays valid.
- **Pin fallback, D6:**
  - `AskPinBuilder.scala:33-36` behaves as described.
  - `build` calls `accessChecker.requireAccess("pipeline", ...)`. So constructed `Output` values need a seeded pipeline, which the harness provides (`seedPipelineWithOutput`, `accessChecker` in `AskDataServiceSpec`).
  - The two mutations D6 names each turn a different scenario red: (a) distinct root and (b) neither step nor root. The two branches can be told apart.
- **Fake-transport feasibility:**
  - `AskApiHarness.ScriptedTransport` (line 84) hard-codes `stop_reason` as `tool_use`/`end_turn`. Tests 1.1/1.2/1.4/1.4b need a scripted stop reason, so the harness must be extended or a local transport written. That is a small, obvious test-support change.
  - `ClaudeClient.toContentBlock` already models `thinking` blocks (line 249), so a thinking-only fake response parses.
  - The harness configures the clamp at 4096 (lines 134/142), so task 1.3's 4096 assertion is observable.
- **ACs covered by tasks:**
  - AC1: 1.1 and 1.4
  - AC2: 1.2 and 1.4b, on both the main hop and the corrective hop
  - AC3: D1, D4 and 1.3
  - AC4: 1.5
  - AC5: 1.6 with mutations, and 3.2
  - No task goes beyond the ticket. CLAUDE.md:174 documents `422 {code: "ASK_UNGROUNDED", reasons}`, and task 2.4 updates it. `schemas/ask/` holds no 422 shape, so no schema delta is needed.
- **D4 premise:** I grepped `frontend/src` for `/ask`. The only hit was a test string ("ask for a new proposal"), so nothing calls the ask routes and there is no traffic to measure. No live call is planned.
- **Placeholders / contradictions:** I found no TODO or TBD. The one implementer's choice left open is the constant's name (D1), which is harmless.

### Verdict: CONFIRM

### Non-blocking notes

- Tasks do not mention that `AskApiHarness.ScriptedTransport` has to be able to script a `stop_reason`. It currently derives the value from the blocks. Extend it with an optional per-step stop reason rather than duplicating a transport.
- Task 1.3's mutation catches any cap below 4096. A cap above 4096 is invisible under the harness's 4096 clamp. Assert on the constant, or build a harness client with a larger clamp, if the mutation record needs to catch both directions.
- The ticket cites `premise-validation.md`, which does not exist in the change dir. The claims it would hold (no live calls, no migration) are consistent with the design, so this is not blocking.
- D5's catch-all phrase covers `"the text is empty"`. Consider giving it its own category for clarity.

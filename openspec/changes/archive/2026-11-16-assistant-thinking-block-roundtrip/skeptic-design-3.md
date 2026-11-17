## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD `4540b3c91aadc7f2b05d7799cc0fd719ed8b2b1e`. The planning artifacts are uncommitted in the worktree.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/assistant-thinking-block-roundtrip/HEL-1636`.
- **Round-2 CR1 (an empty `end_turn` drops valid proposals): resolved in substance.**
  - D6 now fails the tool loop only on `refusal`, or on `max_tokens`/`pause_turn` with no `tool_use` and no text.
    An `end_turn` stays `FinalResponse("")`.
  - The assistant layer turns a blank `FinalResponse` into `NoAnswer(end_turn)` only when `executor.proposal` is empty.
    I checked `AssistantService.converse`: it builds a new `AssistantToolExecutor` on every call, so `executor.proposal`
    is per turn, as the rule needs. `toTurnResult` (AssistantService.scala:142-180) is where the rule goes.
  - Test 5.8 and the spec scenario "Proposal then an empty end_turn" were added.
  - I traced the follow-on path:
    1. The persisted final assistant turn is empty.
    2. On the next converse, `danglingToolUseIds` on an empty last turn returns no ids.
    3. D5 drops the empty assistant message and merges `user[tool_result]` with `user[text]`.

    The result alternates correctly and keeps tool_result first. D10/`lastTurnHasTrailingText` already handles an
    empty last turn.
- **Round-2 CR2 (the spec contradicted D3a): resolved.**
  - The spec now defines a "strip point". It says every thinking block produced before that point is never sent again
    in the loop.
  - D3a and task 1.6a say the strip rewrites the carried `history`, not only the outbound request.
  - Test 5.6 and a spec scenario now cover hop 3: S2 byte-exact, no S1.
  - I re-fetched `https://platform.claude.com/docs/en/build-with-claude/thinking-troubleshooting.md` today. Its
    documented recovery for the invalid-signature 400 is exactly this rule: "Strip the block the error names and
    every later `thinking` and `redacted_thinking` block, leaving each turn's other blocks in place … leave the
    stripped blocks out of later requests". It lists "A rebuilt … `tools` array" as a cause. That is stronger support
    for D3a(b) than the earlier rounds had.
- **Round-2 CR3 (the stream repair would send an empty assistant message): resolved, with both (a) and (b).**
  - (a) `completeStream` (DashboardAuthoringService.scala:398-426) currently sends any parse failure, including blank
    text, to `runStreamingRepair`, which appends `ClaudeMessage(Assistant, priorResponseText)` (:437-439). D6 now ends a
    blank `fullText` with `failStreamEvent` and no repair call, and test 5.7 asserts that no repair `send` happens.
  - (b) D5 is extended to `toApiRequest` (ClaudeClient.scala:281-295). It drops empty-content messages and joins
    same-role neighbours, and a spec scenario covers it.
  - On the non-stream path, `runAttempt` → `runRepair` (:326-358) can no longer build an empty assistant message,
    because `send` now returns `NoAnswer` on blank text first.
- **Round-1 CRs still hold in the revised artifacts:**
  - D3a resolves round-1 CR1.
  - D6 on `send` resolves CR2. I grepped `main/`, and the `ClaudeError` match sites are exactly
    AssistantConversationRoutes:116, DashboardAuthoringService:315, RefinementService:138 and ClaudeAiStepClient:40-42.
    Task 2.3 lists all four.
  - D12 Conversation B resolves CR3 (web search, then another hop, UNEXERCISED if no search).
- **Round-2 non-blocking notes:** the D5 note about tool_result followed by text is in design.md:98-99, and the test
  numbering is now 5.1–5.8 in order.
- **`AiStepFailure.Api(0, msg)`:** the status-0 sentinel is documented on `ClaudeError.ApiError`
  (ClaudeModels.scala:51-55). The two AI-step consumers (GenerateTextStep:73, AnalyzeWithAiStep:73) fail the step with
  `ai-error`. That is loud, not an empty output.
- **D11:** `git grep claude-haiku-4-5` outside the archive finds:
  - `cd-backend.yml:99` and `deploy-backend.sh:120`: these are the planned changes;
  - the `CLAUDE.md` example row: D11 updates it;
  - `ClaudeConfigSpec:53-54`: an arbitrary model string in a test, so it is harmless.

  Nothing in `backend/src/main` or `frontend/src` branches on a model id. The only hit is `ClaudeConfig.DefaultModel`.
- **D7:** no caller outside `infrastructure/ai` sets `temperature` (grep of `backend/src/main`), so omitting the field
  at 1.0 changes no caller's behavior.
- **HEL-1639 mergeability:** I diffed HEL-1639's worktree against 4540b3c91.
  - ClaudeClient: the `Future.traverse` block plus the `rejectedOncePerResponse` helper.
  - ClaudeModels: `oncePerResponseTools` on `ClaudeToolRequest`.
  - AssistantService: one named argument in `converse`.

  None of these touches `toTurnResult`, `completeStream`, `toApiRequest`, `toApiToolRequest` or `toContentBlock`. It
  does not change the outbound `tools` between hops, so it cannot trigger D3a. See non-blocking note 1 for the one
  likely textual overlap.

### Verdict: CONFIRM

### Non-blocking notes

1. **Likely small textual conflict with HEL-1639.** D3a "tracks the previous hop's outbound tools". The natural way to
   do that is a new `loop` parameter, or a strip applied at the recursive call `loop(history :+ assistantTurn :+ userTurn, …)`
   (ClaudeClient.scala:132). Either change sits 3 lines below HEL-1639's edit to `.traverse(toolUses)`, inside the
   same diff hunk. It is trivial to resolve, but it falls outside C4's literal "response branch" boundary. Whoever
   merges second should expect it.
2. **Whitespace-only text.** D5 drops text that is *empty*, while D6's assistant rule and D10 say *blank*/whitespace.
   The API docs I fetched do not state a whitespace rule. Still, using one `isBlank` predicate for D5 as well would be
   cheap, and it would close the neighbouring "text content blocks must contain non-whitespace text" shape if the API
   enforces it. The spec's "no non-empty text" wording in the `send` requirement could match too.
3. **Assistant spec wording.** The conversation-loop spec says converse fails when the loop "ends with no visible
   answer text and no proposal was captured". D6 limits this to `FinalResponse`. A `HopBudgetExhausted` stop has no
   model text either, and it must stay a successful turn with its `hopBudgetExhausted` flag. Naming "a final response
   (not a hop-budget stop)" in the requirement would prevent a misreading.
4. **`searchedWithNoResults` side effect.** A turn where `find` returns `[]` and the model then ends with an empty
   `end_turn` now becomes a 502 NoAnswer. Today the same turn is persisted with the "searched with no results"
   decoration. Under D10 that decoration has no bubble to sit on anyway, so this is acceptable. Mention it in the PR
   body as an intended behavior change.
5. **AI-step error text.** `AiStepFailure.Api(0, msg)` renders as "API returned status 0: Claude declined …". It is
   loud and correct, but slightly odd for users. A later polish could add a dedicated failure kind.

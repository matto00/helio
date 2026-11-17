## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed head: 40eb222f4c2af1d81a63b954dd8c1423adf447c3 (merge 56acc4185 of origin/main 0c699d263, plus the live-check commit).
Review base (resolve-review-base.sh, live): 0c699d2633e5dedbc14cb3bddaca6147dd6b6025.
The focus is the merge and the cycle-2 evidence. Cycle 1 (evaluation-1.md, PASS at 2799de3a1) covers the rest.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- Merge recipe (archive/2026-11-16-assistant-system-prompt-every-turn/design.md, "Merge recipe for HEL-1636"):
  1. `ClaudeProtocol.scala:239-246`: `Map[String, JsValue](...) ++ r.temperature.map(...) ++ systemField(r.system)`. Matches the recipe.
  2. `ClaudeClient.scala`: HEL-1636's `prepareHop` / `buildTools` / `toApiToolRequest(request, messages, finalTools)` split is kept. `system = ...` is re-added in `toApiToolRequest` (lines 320-323). The loop calls `guardrailRejectTool(request.system, history)` (line 103). `flattenForEstimate` keeps the Thinking/RedactedThinking/Opaque cases. HEL-1639's `rejectedOncePerResponse` is merged into the tool-execution branch without changing the thinking/strip logic. Matches the recipe.
  3. `AssistantService.toTurnResult`: both `FinalResponse` and `HopBudgetExhausted` return `persistable(fullHistory)` (lines 156 and 171). `desanitizeFirstTurn` and its `message` parameter are gone. Matches the recipe.
  4. `ClaudeWireModels.ClaudeApiToolRequest`: `system` is added, and the strip check still compares `tools` JSON only (`prepareHop`, line 281). That is correct because `system` is constant within a loop.
- Persisted thinking is still dropped. `AssistantService.persistable` (lines 224-230) filters out Thinking, RedactedThinking, Opaque and blank Text blocks from every turn. Thinking travels only inside `sendWithTools`' carried history. The strip-point rewrite (`prepareHop`) also removes it from `FinalResponse.history` after a tools change. The merge did not change any of this.
- Temperature is omitted for Haiku 5.x. `wireTemperature` (`ClaudeClient.scala:333-334`) drops the value when it equals 1.0, on both the tool path and the `send`/`stream` path. No main-code caller passes a per-call temperature (grep: zero hits outside `infrastructure/ai`). `ClaudeConfig.fromEnv` logs a WARN if `CLAUDE_TEMPERATURE` is not 1.0 on `claude-haiku-5*`. A non-default env value is still sent, and the API would return a 400. That is the D7 decision (warn, do not silently override), and it is acceptable.
- The CLAUDE_MODEL pin survived the merge: `claude-haiku-5-5` at `.github/workflows/cd-backend.yml:101` and `infra/deploy-backend.sh:123`. The CLAUDE.md env table is updated to match.
- AC6 (live check): met as written. The AC asks that "a 2-message conversation and a web-search/tool conversation both succeed on claude-haiku-5-5". I checked `.concertino-backend.log` independently. All 7 cited request ids log `Claude API response status=200`. Telemetry shows `modelId=claude-haiku-5-5` for conversations 2504f3a2 (two turns, 2 and 1 tool calls) and 3d8ddcb5 (4 tool calls including the search). `Invalid signature` has 0 matches, and there are no WARN/ERROR lines from the Claude client. The cache-read token counts match the evidence table (50186/50186/75206).
- Honesty of evidence/live-check.md:
  - (ii) is explicitly labelled "indirect on wire". That is accurate.
  - (iii) carries the caveat that it cannot show thinking was emitted. That is accurate.
  - (iv) is labelled NOT EXERCISED. That is accurate.
  - Conversation A's three request ids are not in the current log, which was overwritten by the JSON re-run. Nothing load-bearing rests on A, because A2 is the 2-message proof.
  - AC6 is not partial. The PR body should still carry caveats (iii) and (iv) verbatim: the live run does not prove that Haiku 5.5 emitted thinking blocks, so the signature round-trip is proven only by the recorded-fixture specs (AC1/AC2).
- All tasks are `[x]` (0 unchecked).
- CONSTRAINTS C1-C5:
  - C1: honored in artifacts. No key appears in any committed file; the only `sk-ant` strings are pre-existing test stubs. workflow-state.md records that the executor attempted a .env comparison and the permission system denied it. That is a process note for the orchestrator, not a diff defect. The live-check line "not read by the agent" stays literally true only because of that denial.
  - C2 and C3: unchanged from cycle 1. I read the ScalaTest summary myself.
  - C4: honored. The merge-side edits to ClaudeClient/ClaudeModels are local.
  - C5: honored. About $0.02 spent against a $2 cap.

### Phase 2: Code Review — PASS
Gates, re-run by me in WORKTREE_PATH at 40eb222f4:
- `SBT_OPTS=-J-Xmx3g nice -n 19 sbt testFull`: `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`, `Tests: succeeded 9569, failed 0, canceled 5, ignored 0, pending 0`, `All tests passed.`, exit 0. The executor's 9569/0 claim is confirmed. The suite includes ClaudeThinkingRoundTripSpec, ClaudeThinkingWireSpec, ClaudeNoAnswerAndStripSpec, AssistantThinkingSeamSpec, ClaudeClientOncePerResponseSpec, ClaudeProtocolSpec and ClaudeConfigSpec.
- `npm run lint`: exit 0, zero warnings. `npm run typecheck`: exit 0. `npm run format:check`: all files formatted.
- `HELIO_JEST_MAX_WORKERS=3 npm --prefix frontend test`: 765 suites, 9407 tests passed, exit 0.
- `npm --prefix frontend run build`: exit 0. `npm run check:openspec`: clean.

Code: the merge-resolution code introduces no new duplication and no dead code. The only test change after the merge is `AssistantThinkingSeamSpec` gaining the `SourceFetchBudget.default()` constructor argument required by main. That is mechanical, not a fixture edit to make a test pass.

### Phase 3: UI Review — N/A for this cycle
Since cycle 1 (where Phase 3 was evaluated), no frontend file from this ticket has changed. The merge-side frontend changes belong to merged main tickets and are covered by the green jest/lint/build above. The trigger path `ApiRoutes.scala` changed only through main's merge, not through this ticket.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- In the PR body, state AC6 as met, and quote live-check caveats (iii) and (iv) verbatim so no reader infers that thinking emission was observed live.
- Carried over from evaluation-1, still open: the `ClaudeHistoryNormalizer.scala` duplicate Scaladoc, and the design.md D6 note on `ClaudeAiStepClient`'s blank `end_turn` mapping.
- `infra/deploy-backend.sh:30` still cites the historical "Pin production CLAUDE_MODEL to Haiku 4.5" commit. It is accurate as history; the new HEL-1636 comment at line 39 disambiguates it.

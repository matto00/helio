## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD fd7064f7d700e49a2f7dfc1f6a244aab02048fd2 (planning artifacts untracked under the change dir).

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/assistant-system-prompt-every-turn/HEL-1718`.
- **Root cause in the ticket is real** (AssistantService.scala): line 118 `val turnText = if (history.isEmpty) AssistantSystemPrompt.text + "\n\n" + message else message`; lines 227-229 `desanitizeFirstTurn` rewrites turn 0 back to the plain message; called at 159 and 174. On turn 2 `history` is non-empty, so no prompt goes out. Confirmed.
- **Design's code citations hold**: `ClaudeToolRequest` (ClaudeModels.scala) has no `system`; `ClaudeApiToolRequest` (ClaudeWireModels.scala:118) has `model, maxTokens, messages, temperature, tools`; `claudeApiToolRequestFormat.write` (ClaudeProtocol.scala:206) writes those five keys only; `toApiToolRequest` (ClaudeClient.scala:228) marks the last custom tool and the first message's last block; `guardrailRejectTool(history)` at ClaudeClient.scala:93/279. The only `ClaudeApiToolRequest(` construction sites are ClaudeClient.scala:252 and HttpClaudeTransportSpec.scala:39, which uses named args (D2 claim true). `sendWithTools` has exactly one caller, AssistantService.scala:96 (D-context claim true).
- **D7 legacy claim**: `git log -S desanitizeFirstTurn` and `-S converseFlow` both first appear in 65adba30d (HEL-665), so no persisted transcript ever stored the prompt. True. Executor still re-verifies per 2.3.
- **Merge recipe vs. the parked HEL-1636 branch** (read only, `git diff origin/main...bug/assistant-thinking-block-roundtrip/HEL-1636` and `git show` on that branch, merge-base ee66e5b1a):
  - HEL-1636 does not touch `ClaudeToolRequest` (its ClaudeModels.scala diff adds `NoAnswer`, `isBlankText`, `Thinking`/`RedactedThinking`/`Opaque` only), so D1 does not conflict.
  - It rewrites `claudeApiToolRequestFormat.write` to `Map(...) ++ r.temperature.map(...)`, as recipe item 1 says.
  - It changes `ClaudeApiToolRequest.temperature` to `Option[Double]`. D2 puts the insertion after `maxTokens` with `messages` as an unchanged separator line, so there is no textual conflict.
  - Its `toApiToolRequest(request, messages, finalTools)` still builds `ClaudeApiToolRequest(model=..., ..., temperature = wireTemperature(...), tools = finalTools)`, and `loop` still calls `guardrailRejectTool(history)` (line 103 on that branch). Recipe item 2 matches.
  - Its AssistantService diff changes both `desanitizeFirstTurn(...)` call sites to `desanitizeFirstTurn(persistable(fullHistory), ...)`. Recipe item 3 matches.
  - HEL-1636 adds no new `cache_control` sites (only the same 3 at lines 279/300/361), so the merged result has 3 tool-path breakpoints, under the API's limit of 4.
- **AC coverage**:
  - AC1 (system on every turn, stable position, API `system` field) is covered by D1-D4 and D6, tasks 1.1-1.4 and 2.1, plus the ADDED requirement in both spec deltas.
  - AC2 (never persisted or rendered) is covered by D6/D7, tasks 2.2/2.3, the "persisted transcript" scenario, and 3.2's route seam test with a GET read-back. The frontend has no reference to the prompt (`grep -rln "AssistantSystemPrompt\|system prompt" frontend/src` returns nothing), so the UI renders persisted turns verbatim.
  - AC3 (turn-2 test, red on main) is covered by D8: it asserts on serialized JSON, so it compiles on main, and 3.5 records red evidence. The existing fixtures `FakeToolTransport` (AssistantServiceSpec:117) and `SequencedTransport` (AssistantConversationRoutesSpec:204) are transport-level, so capturing the wire request is feasible.
- **Existing tests needing inversion are covered**: AssistantServiceSpec:502-518 asserts `outboundFirstTurnText should include(AssistantSystemPrompt.text)`, which this change must invert. Task 3.4 covers it.
- **Prompt text works as a standalone system prompt**: AssistantSystemPrompt.text has no "message follows/below" phrasing that depends on sitting in a user turn (checked its tail and grep).
- **Spec delta hygiene**: the MODIFIED header matches the live `openspec/specs/claude-api-client/spec.md:280` requirement exactly, and the full requirement text is carried. `npx openspec validate assistant-system-prompt-every-turn --strict` -> `Change 'assistant-system-prompt-every-turn' is valid`.
- **Scope**: backend only, no schema, route or migration change. The non-goals (send/stream callers, thinking persistence) are explicit. No scope drift found, no placeholders or TBDs, and no internal contradiction between proposal, design and tasks.

### Verdict: CONFIRM

### Non-blocking notes
- `AssistantSystemPrompt.scala:21-24` scaladoc says `converse` "folds this text into the conversation's first `user` turn" because `ClaudeToolRequest` has "no separate `system` field". This becomes false after the change. Task 2.2 only names AssistantService's scaladoc. The executor should also fix this comment and the `ClaudeToolRequest` scaladoc (document the new `system` field).
- D5 estimates the system prompt as a leading `User` `ClaudeMessage`. That is fine for a heuristic, but the guardrail test (3.3) should be built so messages alone pass and messages plus system fail, as the spec scenario states. A test where the messages alone already exceed the limit proves nothing.
- D8's AssistantServiceSpec "no `messages` entry contains the prompt" assertion should search the serialized `messages` JSON string (any block type), not just text blocks. That keeps it failable if the prompt were ever folded into a tool_result.

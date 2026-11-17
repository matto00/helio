## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `4540b3c91aadc7f2b05d7799cc0fd719ed8b2b1e` (planning artifacts are uncommitted in the worktree).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/assistant-thinking-block-roundtrip/HEL-1636`.
- **Ticket root cause holds in the tree.** `ClaudeProtocol.claudeApiContentBlockFormat.read` `case _` keeps only `text`.
  `ClaudeClient.toContentBlock` `case _ => ClaudeContentBlock.Text(b.text.getOrElse(""))` (ClaudeClient.scala:182-183).
  `sendWithTools` folds every decoded block into `assistantTurn`. The design's Context section is accurate.
- **D4 rationale (HEL-1718) holds.** `AssistantService.seedHistory` folds `AssistantSystemPrompt.text` into turn 1's user
  message only when `history.isEmpty`. `desanitizeFirstTurn` (AssistantService.scala:225-227) persists that turn as the
  plain message. So turn 2's first message differs from what turn 1's thinking was bound to. I re-fetched
  `.../preserved-thinking/prefix-checks` today: a change to "an earlier message" invalidates every later thinking
  block, and on Haiku 5.5 the result is "Possible 400 error". Dropping all prior-turn thinking is allowed: "you can
  leave out the oldest, the newest, or all of them, but not one in between". **D4 is sound.**
- **HopBudgetExhausted risk (named in Risks).** I re-fetched `.../thinking-tool-workflows`. It says dropping thinking
  "loses the reasoning in them, even without an error". The prefix-check page allows leaving all of them out. No page
  I read documents a 400 for a tool_use assistant turn sent back without its thinking on an adaptive model. Accepting
  this risk and naming it is reasonable. See non-blocking note 1 for a deterministic alternative.
- **Route slicing.** `AssistantConversationRoutes.scala:156` persists `result.fullHistory.drop(history.length)`. D4 keeps
  the turn count, and D5 only rewrites the outbound wire request, not the returned history. Slicing is unaffected.
- **Match sites.** `ClaudeError` is matched in AssistantConversationRoutes, ClaudeAiStepClient, RefinementService and
  DashboardAuthoringService (with AuthoringError). That is the list in proposal Impact and task 2.3. `ClaudeContentBlock`
  is matched in AssistantConversationRepository (write 163-190, read 202-228), ClaudeClient and AssistantService. All are
  covered by tasks 1.4, 2.1 and 2.2.
- **Deploy pin lines.** `cd-backend.yml:99` and `deploy-backend.sh:120` both carry `CLAUDE_MODEL=claude-haiku-4-5-20251001`.
  The ticket's line numbers (91/110) are stale and D11's are right.
- **Frontend.** `ActiveConversationPanel.tsx:176` `lastTurnHasTrailingText` and `:201` `blockType === "text"` render
  path both exist. D10 targets the right code.
- **HEL-1639 mergeability.** I read HEL-1639's diff against 4540b3c91. In ClaudeClient it changes only the
  `Future.traverse(toolUses)` block plus a new private helper. In ClaudeModels it adds `oncePerResponseTools` to
  `ClaudeToolRequest`. In AssistantService it adds one named argument in `converse`. D2/D4/D6 and C4 touch other
  hunks: `toContentBlock`, the `object`s, `toTurnResult`, and the branch before `if (toolUses.isEmpty)`. At worst
  the conflict is adjacent-line and textual. Acceptable.
- **The evidence/api-contract.md claims I spot-checked by re-fetching** (thinking, thinking-troubleshooting,
  thinking-tool-workflows, prefix-checks) match the live docs: empty `thinking` with a signature, "Possible 400" on Haiku
  5.5, Haiku 5.5 accepts `thinking: disabled` at effort high or below. **But the evidence file leaves out the one rule that breaks D3 (CR1).**

### Verdict: REFUTE

### Change Requests

1. **D3's in-loop round trip fails the prefix check whenever web_search is used, because the `tools` array changes
   between hops.** `ClaudeClient.toApiToolRequest` (ClaudeClient.scala:219-222) sends
   `WebSearch(remainingWebSearchBudget)`, where `remaining = config.webSearchMaxUses - webSearchUsed`. So after any hop
   that ran a web search, the next hop's `tools` carries a smaller `max_uses`. Once the budget (default 3,
   ClaudeConfig.scala:39) is spent, the `web_search` entry is dropped entirely. The official prefix-check page
   (https://platform.claude.com/docs/en/build-with-claude/preserved-thinking/prefix-checks, fetched 2026-11-16) says:
   - "A prefix check fails if system, tools, or an earlier message changed after Claude produced a block."
   - "Adds, removes, or rewords a tool … Stop changing tools."
   - "Only system, tools, and messages are compared"; the API compares parsed JSON.
   - The Haiku 5.5 result is "Possible 400 error". The no-error case feeds Claude reasoning about a prefix that has
     since changed.

   So hop N+1 after a web-search hop sends back hop N's thinking byte-exact (D3) under a changed `tools` array. That
   can 400 with "Invalid `signature` in `thinking` block". This is the web-search/tool conversation the ticket's live
   AC requires. Neither design.md nor evidence/api-contract.md mentions it, and no task or test covers it. Required
   revision:
   - **Pick a resolution in design.md** and record the rejected options. Candidates:
     - (a) Keep `tools` byte-stable for the whole `sendWithTools` call: send `WebSearch(config.webSearchMaxUses)` on
       every hop and never drop it. Then enforce the cross-hop budget in another way that does not alter `tools`, and
       state what that does to HEL-757's cost cap.
     - (b) When the hop's `tools` differs from the previous hop's, strip every earlier thinking/redacted block from the
       in-loop history. Leaving all of them out is allowed by the prefix-check rules. Reconcile this with the "Required:
       within a tool-use turn" wording.
     - (c) Opt into `thinking-binding-controls-2026-08-01` with `prefix_mismatch_behavior: "drop_block"`.
   - Add the matching fixture test to group 5, e.g. hop 1 = [thinking, server_tool_use, web_search_tool_result,
     tool_use], then assert on hop 2's serialized request. For (a), pin that the `tools` JSON is identical on both hops.
     For (b), pin that no stale thinking is sent.
   - Add this rule to evidence/api-contract.md.

2. **Under the new prod pin, the refusal / empty-answer case is left open on the `send` path, and one caller writes
   it silently as data.** D11 moves every `ClaudeClient` consumer onto Haiku 5.5, not only the assistant: all of them
   share `ClaudeConfig.model`. The proposal makes "refusal handling on the single-shot `send`/`stream` paths" a
   non-goal. But `ClaudeAiStepClient.sendToModel` maps `Right(response) => Right(response.text)`
   (ClaudeAiStepClient.scala:38-39). A refusal (`content: []`) or `max_tokens` spent on thinking (shared 4096 clamp, no
   `maxTokens` override at any `send` call site) returns `Right("")`. A pipeline AI step then writes an empty string
   as its output with no error. The ticket's refusal bullet says it "must surface as a clear error, never an empty
   answer", and it is not scoped to the assistant. Required revision: either
   - (a) make `ClaudeClient.send` return `Left(ClaudeError.NoAnswer(...))` on `stop_reason == "refusal"`, or on a response
     with no non-empty text. D6 already adds exhaustive `NoAnswer` cases at ClaudeAiStepClient, DashboardAuthoringService
     and RefinementService. Map it to their existing failure kinds and add a test per mapping. Or
   - (b) state in design.md exactly what each `send`/`stream` caller does with an empty answer on Haiku 5.5, and get an
     explicit owner ruling that a silent empty AI-step output is acceptable.

   The `stream` path (`DashboardAuthoringService:376`) should get at least a one-line statement of its behavior on a
   refusal.

3. **The live check (D12 / task 4.3) does not exercise the ticket's "web-search/tool conversation" AC.** D12 requires
   only "at least one tool hop". The ticket's last AC requires a 2-message conversation and a web-search/tool
   conversation to both succeed on `claude-haiku-5-5`, and CR1 is exactly the web-search-then-another-hop path.
   Revise D12 and task 4.3:
   - a turn whose prompt makes a `web_search` call likely, followed by at least one more hop in the same turn;
   - record from the logged request-ids whether a web search occurred;
   - say what happens if the model declines to search: one retry within the $2 cap, or report it as unexercised.
     Never claim it passed.

### Non-blocking notes

1. A deterministic alternative to the named HopBudgetExhausted risk: in `seedHistory`, when `danglingToolUseIds` is
   non-empty, the request is mid-tool-turn with that turn's thinking dropped. Instead you could persist a
   HopBudgetExhausted turn with its unexecuted `tool_use` blocks removed, so no request is ever mid-tool-turn without
   its thinking. That needs care with the existing synthetic `tool_result` logic and its tests. Your call. The current
   "accept and name it" is defensible against the docs I read.
2. Narrow D5 so it never removes an empty `Text` from an assistant turn that also holds a `Thinking`/`RedactedThinking`
   block. The prefix-check page counts "changing text before a thinking block in its own message" as a change. This is
   unlikely to occur, but the invariant is cheap to state.
3. `stop_reason: "pause_turn"` (a long server-tool turn) with no text will become `NoAnswer(pause_turn)` under D6. That
   is better than today's empty answer. The message could say it was paused rather than imply a model failure. Consider
   filing a follow-up for continuing paused turns.
4. Stripping `Opaque` blocks from persisted turns (D4) could orphan a future server-tool result type paired with a kept
   `server_tool_use`. Only `web_search` is offered today, so it is moot, but a one-line comment would stop the next
   server tool from tripping over it.
5. D7: from `anthropic-version: 2026-10-21`, any `temperature` returns 400 on Haiku 5.5 (evidence file). A non-default
   `CLAUDE_TEMPERATURE` would therefore 400 every request on this model. Consider a one-line WARN at config load when the
   model is `claude-haiku-5-5` and the temperature is not 1.0.

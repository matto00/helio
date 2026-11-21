## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/assistant-conversation-loop/spec.md,
specs/assistant-tool-loop-telemetry/spec.md (uncommitted planning artifacts on HEAD
ba30212be1f3d53084c1131706ea3ec63ef1820a), against the live code in the worktree.

### What I verified (with evidence)

- **Premises hold.**
  - `AssistantService.scala:56` `private val MaxHops: Int = 4`, passed at :87; no other cap on the converse path.
  - `ClaudeClient.scala:144` `thisHop > request.maxHops` -> `HopBudgetExhausted(history :+ assistantTurn, ...)`,
    so a ceiling of 12 means 12 executing round trips and 13 transport calls (D3, task 2.3 are right).
  - `ClaudeClient.scala:102-104`: the guardrail runs before every hop and returns `Failed(GuardrailExceeded)`
    mid-loop, which `AssistantService.toTurnResult` maps to `Left` and the route persists nothing (D4 premise right).
  - `ClaudeClient.scala:149-155`: HEL-1639 synthetic rejections are built in the loop before `executeTool`, so
    the client can tell them apart from executed calls (D2 is implementable as written).
  - `AssistantToolExecutor.scala:183-210`: `test_connection` returns `Right(TestConnectionResponse.toJson)` for
    `ok:false`, so `isError` alone misses it (D1 premise right). `TestConnectionResponse(ok: Boolean, error: Option[String])`.
  - `ActiveConversationPanel.tsx:255` renders the hardcoded "I couldn't find enough in 3 lookups" text; the
    server's "Reached the maximum number of tool calls (4)" text (`AssistantService.scala:173`) is never shown.
    The "3" premise finding is correct.
  - Beta charge: `AssistantConversationRoutes.scala:287` calls `checkConverseCap(... weightOf(resolvedModel) ...)`
    once before `converseFlow`; per turn, not per hop.
  - Exhaustive matches on `ClaudeToolOutcome` exist in `AskDataService`, `ClaudeInsightClient` and the test-side
    `eval/AssistantEval.scala` (task 2.1 names all three).
  - `ToolCallIndicator.tsx:94` shows the raw `tool_result.content` on expand, so "the error text is the same text
    the tool-call row already shows" holds for `isError` results.
- **D1 (total, per executed call) is reasoned and consistent** with the ticket ("3 failed tool calls in a turn")
  and the measured transcript (turn 7: 12 failures; with consecutive counting, alternating fail/re-read patterns
  never trip it). Excluding the HEL-1639 synthetic rejections and dangling-call results is sound. Counting
  `test_connection ok:false` is sound and matches the ticket's own list ("a failed `test_connection`").
- **D5 ceiling-stop persistence choice is sound.** Appending a text turn after a trailing `tool_use` assistant
  turn would be merged by the HEL-1636 normaliser into text-after-tool_use; keeping today's shape and carrying the
  message in the response avoids that.
- **Hop-ceiling number** is an owner ruling; not relitigated.
- **AC coverage:** AC1 -> task 1.1; AC2 -> tasks 2.2/2.3/3.2; AC3 -> tasks 2.3 (web search), 4.2 (beta, hop-1
  refusal); AC4 -> task 6.2 plus the evidence file. All four ACs are covered by a task.

### Verdict: REFUTE

Three defects a competent implementer would hit or resolve two different ways, one of them a missing contract
delta. All are artifact edits; none needs a new owner ruling.

### Change Requests

1. **Missing spec delta for `claude-api-client`.** `openspec/specs/claude-api-client/spec.md:245-255`
   ("The existing input-token guardrail applies to every hop of the tool-use loop") requires a mid-loop rejection to
   resolve `Failed(GuardrailExceeded(_))`. D4 changes that for callers setting `stopOnInputBudget`, and D2 adds a
   new outcome (`FailureBudgetExhausted`) and new `ClaudeToolRequest` fields that change "the loop continues
   (consuming one hop)" (:217-222) for callers with a `failureBudget`. Add
   `specs/claude-api-client/spec.md` with: a MODIFIED guardrail requirement (default stays `Failed`; with
   `stopOnInputBudget` and at least one hop used it resolves `InputBudgetExhausted` with the carried history;
   hop 1 is always `Failed` with zero transport calls), and an ADDED failure-budget requirement (opt-in,
   caller-supplied classifier, executed calls only, stop after the round trip of the Nth failure, `None` unchanged).
   As written, the implementation would contradict a live spec with no delta recording why.

2. **`failedToolCalls` has no source for three of the four stop reasons.** D6 says only "the new outcomes carry
   `failedCalls`"; `FinalResponse`, `HopBudgetExhausted` and `InputBudgetExhausted(carriedHistory, usage)` carry
   none. Yet `AssistantTurnResult.failedToolCalls` and the telemetry field (D7, telemetry spec) must be filled for
   every turn, e.g. a turn with 2 failures that then answers, or a ceiling stop. The only fallback is re-deriving
   from history by `isError`, which miscounts HEL-1639 synthetic rejections and the dangling-call results that
   D1 says must not count. State in D2/D6 that every outcome exposes the loop's failure count (second parameter
   list, like `hopsUsed`), and add a telemetry scenario for a non-budget stop with a non-zero count (for example
   2 failures then a final answer -> `failedToolCalls` 2, `stopReason` `final`) plus a test for it in task 4.1.

3. **The failure message for `test_connection ok:false` is unspecified and would show raw JSON.** D2 builds
   `FailedToolCall(name, message)` inside the client from the `ToolResult`; D5 then shows "The last error was:
   <first line of the last failure>". For an `ok:false` result the content is
   `{"ok":false,"error":"..."}`, so the plain-language message (the ticket's "say what failed in plain language",
   and the very case the example "I couldn't connect to the source after 3 tries" is about) would end with a JSON
   blob. Specify how the message is derived: e.g. make the classifier return `Option[String]` (the failure text,
   `None` = not a failure) so `AssistantService` supplies `error` from `TestConnectionResponse` (and a fixed
   phrase when `error` is absent). While editing D2/D3, fix the type mismatch: D2 defines
   `failureBudget: Option[ToolFailureBudget]` but D3 says `failureBudget = Some(3)`. Add a task 3.2 assertion that
   the `ok:false` message contains the `error` text and no `{"ok"`.

### Non-blocking notes

- **An input_budget stop makes the conversation permanently unusable.** The persisted history after an
  `input_budget` stop already exceeds the limit, so every later send in that conversation is refused at hop 1
  (422). Today the whole turn is discarded and the conversation stays usable. The stop message does say "Start a
  new conversation", so this may be the intended trade, but the Risks section only says a later turn "may hit the
  input refusal sooner". State it as certain, and say it in the PR. Consider covering it in task 4.2 (next send on
  that conversation is the guardrail error, nothing persisted).
- **Precedence on hop 12.** If the third failure lands on round trip 12, D2's check runs before recursion, so
  `failure_budget` wins over `hop_ceiling`. That is fine; say so in one sentence so the test is unambiguous.
- **Model stamp on the server-authored stop turn.** `AssistantConversationRoutes.scala:171-173` stamps every new
  assistant turn with `model = answered` (HEL-1755 D5, "the model that answered it"). The appended stop-text turn
  will be stamped with a model that did not write it. Probably harmless; worth a sentence in D5.
- **Proposal plus failure stop.** A turn can capture a valid proposal and then hit the failure budget.
  `AssistantTurnResult` would carry both the proposal and a "couldn't put together a valid proposal" message only if
  the last failures were proposes; the grouping text could then contradict a shown proposal. Consider choosing the
  message from `executor.proposal` too, or note the case.
- Measured turn 3 of the 2026-10-16 transcript had 3 failed calls in 3; under the new rule it would stop. Consistent
  with the owner's "3 failures", but worth one line in the PR notes.
- Task 1.1 asks to commit the red test before implementation; that is good. Keep the mutation list in D10 and add
  "re-derive failures from history by isError" as a mutation for CR2.

## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed cold: ticket.md, proposal.md, design.md, tasks.md, specs/{assistant-conversation-loop,
assistant-tool-loop-telemetry,claude-api-client}/spec.md (uncommitted planning artifacts on HEAD
ba30212be1f3d53084c1131706ea3ec63ef1820a), skeptic-design-1.md, and the evidence file
`.concertino/runs/HEL-1637/evidence/turn-measurements.md`, against the live code and live specs.

### What I verified (with evidence)

- **Premises re-checked on live code.**
  - `AssistantService.scala` `private val MaxHops: Int = 4`, passed as `maxHops = MaxHops`; the only cap on the
    converse path. The ceiling-stop text "Reached the maximum number of tool calls ($MaxHops)..." lives in
    `toTurnResult`'s `HopBudgetExhausted` arm.
  - `ClaudeClient.sendWithTools`: `guardrailRejectTool` runs before every hop and returns `Failed(GuardrailExceeded)`;
    `thisHop > request.maxHops` -> `HopBudgetExhausted(history :+ assistantTurn)`; HEL-1639 rejections are built in
    the `Future.traverse` before `executeTool`, so the loop can tell dispatched calls from synthetic ones (D2
    implementable); the failure-budget check after `toolResults` and before `loop(...)` recursion is the natural
    place, giving the stated precedence over the ceiling.
  - `ClaudeModels.scala:213-228`: `FinalResponse(...)(responseModel, stopReason)`, `HopBudgetExhausted(...)(responseModel)`,
    `Failed(error)(usage, responseModel)`: second parameter lists with defaults already exist, so D6's "add
    `hopsUsed`/`failedToolCalls` to the second list, defaults 0" keeps existing patterns compiling.
  - `ActiveConversationPanel.tsx:191,224,255` renders the hardcoded "3 lookups" fallback; the slice carries
    `hopBudgetExhausted` (`assistantConversationsSlice.ts:357`). D8's plumbing points are real.
  - `schemas/assistant/assistant-conversation.schema.json:45` has converse-only `hopBudgetExhausted`; the two new
    optional fields follow the same pattern.
- **Round-1 change requests.**
  - CR1 (claude-api-client delta): resolved. `specs/claude-api-client/spec.md` MODIFIES "The existing input-token
    guardrail applies to every hop of the tool-use loop" (header matches the live spec at :245 exactly; default
    stays `Failed`, opt-in + >=1 hop -> input-budget outcome, hop 1 always `Failed` with zero transport calls) and
    ADDS the failure-budget requirement (opt-in, classifier on dispatched calls only, total count, stop after the
    round trip, precedence over the hop cap, `None` unchanged, counts exposed on every history-carrying outcome).
    `openspec validate assistant-failure-budget-loop --strict` -> "Change 'assistant-failure-budget-loop' is valid".
  - CR2 (failure count for every stop reason): resolved in design D6 (every history-carrying outcome exposes
    `hopsUsed`/`failedToolCalls` from the loop, never re-derived by `isError`), the claude-api-client ADDED
    requirement's last sentence, task 4.1 (2 failures then final -> `failedToolCalls` 2, `stopReason` `final`) and
    the D10 mutation list ("re-derive the failure count from history by `isError`"). The telemetry spec delta
    itself did not gain that scenario (see notes); the obligation is carried by task 4.1 and D10, so not blocking.
  - CR3 (test_connection message / type mismatch): resolved. `classify` returns `Option[String]`; `ok:false` maps to
    `TestConnectionResponse.error` or a fixed phrase; D5 says the message never comes from raw JSON; D3 now says
    `Some(ToolFailureBudget(3, classify))`; task 3.2 asserts the `error` text and no `{"ok"`; D10 adds the
    raw-JSON mutation.
  - Round-1 non-blocking notes were all taken up: input-budget consequence stated as certain and tested (task 4.2),
    precedence on round trip 12 stated and tested, model stamp addressed, proposal-then-failure wording added,
    transcript turn 3 noted in Risks.
- **Live-spec consistency of the deltas.** REMOVED "The hop cap is 4, supplied by the caller" matches the live
  header (:178); its scenario is superseded by the ADDED ceiling scenario. MODIFIED "A bounded 7-tool
  conversational loop answers a goal" matches (:138). "converse surfaces a real Claude/transport failure as an
  error" (:60) still holds: `input_budget` is no longer a `Failed`, by explicit opt-in in the client delta.
  "fullHistory is populated even when the hop budget is exhausted" (:44) still holds (D5 keeps the ceiling shape).
  "Every converse request ends with a user turn" (:373) holds: failure/input stops end with an appended assistant
  text turn, then the next turn's user message; the ceiling stop keeps the existing `seedHistory` pairing.
- **D1 counting rule** is reasoned against the owner's words and the measured transcript (turn 7: 12 failures in
  3 round trips; consecutive counting never trips on the fail/re-read/fail pattern). Excluding HEL-1639 synthetic
  rejections and `seedHistory` dangling results is sound and consistent with the evidence file's turn-5 note.
- **AC coverage.** AC1 -> task 1.1 (red committed first; with `MaxHops = 4` the 5th tool request resolves
  `HopBudgetExhausted`, so the test is genuinely red on current code). AC2 -> tasks 2.2/2.3/3.2. AC3 -> 2.3 (web
  search over >4 round trips), 4.2 (beta charged once over 7 round trips; first-request input refusal). AC4 -> 6.2
  plus the evidence file and the owner's ceiling ruling. No task reaches beyond the ticket; the ask loop is
  explicitly out of scope with only mechanical exhaustive-match arms (D9).
- No placeholders/TBDs found in proposal, design, tasks or specs.

### Verdict: CONFIRM

### Non-blocking notes

- `tasks.md` 3.1 still reads "`failureBudget = Some(3)`"; D3 is authoritative (`Some(ToolFailureBudget(3, classify))`).
  The implementer should follow D3; fix the task text if the artifacts are touched again.
- The telemetry spec delta has no scenario for a non-budget stop with a non-zero failure count (round-1 CR2 asked
  for one). Task 4.1 and D10 carry the test, so the behaviour will be pinned; consider adding the scenario to the
  spec at archive time so the durable contract states it.
- The live claude-api-client requirement "A failed tool execution is fed back to Claude" says "the loop continues
  (consuming one hop)". It is not MODIFIED; the ADDED failure-budget requirement states the opt-in exception. That
  reads consistently, but a one-line MODIFIED clause ("unless a caller-supplied failure budget is spent") would make
  the live spec self-contained.
- Unspecified edge, harmless: after 12 executing round trips, if the 13th request trips the input guardrail it
  resolves `input_budget` rather than `hop_ceiling` (guardrail runs before the transport call). Fine either way;
  worth one sentence so a test does not encode the opposite.
- D8's ceiling note "Couldn't finish in time" describes a step limit, not a time limit; "Couldn't finish in one go"
  (matching the fallback text) would be more accurate.
- Per-call counting means one response with 3 parallel failing reads ends the turn after a single round trip. This is
  the stated D1 trade-off; mention it in the PR alongside the turn-3 note.

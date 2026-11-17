## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `4540b3c91aadc7f2b05d7799cc0fd719ed8b2b1e`. The planning artifacts are uncommitted in the worktree.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/assistant-thinking-block-roundtrip/HEL-1636`.
- **Round-1 CR1 (tools change between hops): resolved in substance.** D3a picks option (b), `stripAllThinking`, and
  records why (a) and (c) were rejected. (a) is rejected because it would break HEL-757's cross-hop cap, and that
  reasoning is correct: `toApiToolRequest` sends `WebSearch(remaining)` and drops the entry at 0 (ClaudeClient.scala:219-224).
  Test 5.6 was added, and the prefix-check rules are now in evidence/api-contract.md. I re-checked that nothing else
  in the prefix moves between hops:
  - no `system` field is sent;
  - the tools cache marker is on the last custom tool, which is stable;
  - the messages cache marker is always on the first message (ClaudeClient.scala:215-235).

  So the only per-hop prefix drift is the `web_search` entry, and D3a's serialized-tools comparison covers it.
  **However, the spec delta contradicts D3a (CR2 below).**
- **Round-1 CR2 (refusal/empty answer on `send`): mostly resolved.** D6 now covers `send`, and every `ClaudeError`
  match site gets a mapping. I grepped `main/`: the match sites are RefinementService:137, DashboardAuthoringService:314,
  ClaudeAiStepClient:40-42 and AssistantConversationRoutes:115, which are exactly the ones task 2.3 lists. `send` is
  called only from RefinementService (148, 167), DashboardAuthoringService (331, 351, 442) and ClaudeAiStepClient:38.
  **But the `stream` statement is factually wrong (CR3), and the new D6 rule on the tool loop causes a regression (CR1).**
- **Round-1 CR3 (live check web search): resolved.** D12 Conversation B requires a search followed by another hop.
  The search is confirmed from request-ids and `server_tool_use` blocks, there is one retry, and an un-searched run
  is reported as UNEXERCISED, never passed. Task 4.3 matches.
- **Round-1 non-blocking notes:**
  - note 2 is adopted as D3a's second trigger;
  - note 3 gives `pause_turn` its own message;
  - note 4 is a code comment in task 2.1;
  - note 5 is a WARN in D7;
  - note 1 is declined, with reasons, which is acceptable.
- **HEL-1639 mergeability:** I grepped HEL-1639's worktree. `oncePerResponseTools` affects only which `tool_use`
  blocks execute (ClaudeClient.scala:128,147-151 there) and adds one field to `ClaudeToolRequest`. It does not change
  the outbound `tools` between hops, so it cannot trigger D3a. C4 still keeps the hunks apart. Mergeable.
- **Docs re-fetch:** I fetched `https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons.md` today.
  It is the source for CR1.
- **Design length:** about 190 lines, which is justified by the round-1 revisions. Not a finding.

### Verdict: REFUTE

### Change Requests

1. **D6's "a response without `tool_use` has no non-empty Text → `Failed(NoAnswer)`" rule throws away valid
   proposals.** The official stop-reasons page (handling-stop-reasons, accordion "Empty responses with end_turn",
   fetched 2026-11-16) says: "Sometimes Claude returns an empty response (exactly 2–3 tokens with no content) with
   `stop_reason: "end_turn"`. This typically occurs when Claude determines that the assistant turn is complete,
   particularly after tool results."

   That is exactly the assistant's main path:
   - the model calls `propose_*`;
   - the next hop ends the turn, possibly with no text.

   Today that turn is a `FinalResponse("")`. The route persists the new turns, and the frontend extracts the proposal
   from the transcript's `tool_use`/`tool_result` blocks (`ActiveConversationPanel.tsx:160` `extractProposal(transcript)`,
   `:239` `ProposalHandoff`). Under D6 the same turn becomes `Failed(NoAnswer(end_turn))`. The route then persists
   nothing (AssistantConversationRoutes.converseFlow, `Left` branch), and the user loses a proposal that validated
   correctly, along with every tool hop of that turn. That regression is introduced by this change.

   Required revision:
   - Narrow the tool-loop rule. `sendWithTools` fails with `NoAnswer` on `stop_reason == "refusal"`, and on
     `max_tokens`/`pause_turn` with no non-empty text.
   - An `end_turn` with empty content after an earlier tool hop in the same call stays a `FinalResponse`. The
     assistant layer can turn it into an error only when `executor.proposal` is empty, or the design can state
     another rule. Either way, D6 and the spec delta must name the choice.
   - Add a fixture test: hop 1 `[thinking, tool_use propose_dashboard]`, then hop 2 `{"stop_reason":"end_turn","content":[]}`.
     Assert that the turn succeeds, that the proposal survives in the persisted transcript, and that the next
     request has no empty message. D4/D5 already handle the persisted empty assistant turn: task 2.1 keeps the
     turn count, and D5 drops the emptied message.
   - Decide separately whether `send` keeps the "no non-empty text → NoAnswer" rule. It has no tool hops, so it is
     fine as written.

2. **The spec delta contradicts D3a on what happens after a strip, and test 5.6 only checks hop 2.** D3a says the
   strip is permanent: "removes every Thinking/RedactedThinking block from the whole in-loop history, from that hop
   onward … Later hops then keep only the blocks produced after the change".
   specs/claude-api-client/spec.md says the opposite: "On every hop of a tool-use loop whose offered tools are
   unchanged from the previous hop, the client SHALL send each earlier hop's thinking … back".

   Take three hops. Hop 1 searches. Hop 2 gets a smaller `max_uses`, so the strip fires. Hop 2 does not search, so
   hop 3 has the same tools as hop 2. Read literally, the spec makes hop 3 re-insert hop 1's thinking. That breaks
   the prefix check twice:
   - hop 2's thinking was bound to a prefix without hop 1's thinking;
   - hop 1's thinking was bound to the old `tools`.

   A per-request strip (recomputed from "this hop vs previous hop" without changing `history`) is exactly what the
   spec wording leads to, and it 400s on hop 3. Required revision:
   - Reword the requirement. After a strip, no thinking block produced before the strip point is ever sent again in
     that loop. Only blocks produced after the latest strip are sent back unchanged.
   - Make D3a/task 1.6a say explicitly that the strip rewrites the loop's carried `history`, not only the outbound
     request.
   - Extend test 5.6 with a third hop: hop 2 returns `[thinking S2, tool_use]` with no search. Assert that hop 3's
     request contains S2 byte-exact and contains no hop-1 thinking.

3. **D6's `stream` paragraph describes a mechanism that does not happen, and the spec's "client never sends an empty
   text block" is not true for `send`.** On a streamed refusal, `completeStream` gets `fullText = ""`. `runStreamingRepair`
   (DashboardAuthoringService.scala ~427-431) then builds
   `initialMessages :+ ClaudeMessage(Assistant, priorResponseText = "") :+ ClaudeMessage(User, repair)` and calls `send`.
   `toApiRequest` (ClaudeClient.scala:281-295) sends string-content messages as they are. D5 normalises only
   `toApiToolRequest`. So the repair request carries an empty assistant message, which is the very shape that
   produced the prod 400. The likely result is `ApiError(400)` ("Claude API error (400): …non-empty…"), not
   `NoAnswer`. That is still an error, so it never yields an empty proposal. But:
   - the design's stated chain ("the repair attempt goes through `send`, which now returns `NoAnswer`") is wrong;
   - the user sees a raw 400 instead of the refusal message;
   - spec requirement "The client never sends an empty text block — No request the client sends SHALL contain a text
     content block whose text is empty" is violated on the `send` path.

   Test 5.7 with a mock transport would pass anyway and hide this. Required revision, pick one:
   - (a) `completeStream` treats a blank `fullText` as no-answer and emits `failStreamEvent` without a repair;
   - (b) apply D5's drop-and-merge to `toApiRequest` as well;
   - (c) narrow the spec requirement to tool-use requests and correct D6's paragraph.

   Test 5.7 must assert the actual request the repair sends, or assert that no repair call is made. A
   fail-event-only assertion is not enough.

### Non-blocking notes

1. D5's merge of same-role neighbours can put user text right after a `tool_result`. Example: a persisted empty
   assistant turn is dropped between a tool_result turn and the next user message. The stop-reasons page names that
   pattern as a cause of empty `end_turn` responses. It is rare, and it is acceptable once CR1 stops empty `end_turn`
   from being a hard error. A one-line note in D5 would help the next reader.
2. Test numbering in tasks.md runs 5.4, 5.6, 5.7, 5.5. That is cosmetic.

# HEL-1637: Assistant tool loop: budget failed tool calls (3 failures), not total hops

## Description

Owner, 2026-10-16: "Right now it's always 3, but it should be 3 failures. It seems like agents need more turns than we generally give them right now."

Today the in-app assistant's tool loop stops after a fixed number of **total** hops, whether or not those hops succeeded:

* `backend/.../services/assistant/AssistantService.scala:56`: `private val MaxHops: Int = 4`. Originally 3 (HEL-660's design); HEL-756 D3 raised it to 4 because `find -> test_connection -> propose_*` already filled 3 hops "with zero room for a `get_resource` call or a retry after a failed test". Verify the current value and that nothing else caps it lower; the owner sees it as 3 in practice.
* Hitting the cap returns `ClaudeToolOutcome.HopBudgetExhausted`, and the user sees "Reached the maximum number of tool calls (4) without a final response." A productive multi-step turn (several finds, get_resource, propose) dies just as it is about to answer.
* Separately, `CLAUDE_WEB_SEARCH_MAX_USES` (default 3) caps web searches per turn across the whole loop. That is a cost budget and stays as it is unless the design gate argues otherwise.

### Desired behaviour

* **Budget failures, not progress.** The loop continues while tool calls succeed, and stops after **3 failed tool calls** in a turn: a `tool_result` with `is_error`, a dangling or unknown tool, a propose decode or validation failure, a failed `test_connection`, and so on. Decide in design whether that is 3 consecutive failures or 3 total in the turn, and write down why. Owner wording: "3 failures".
* **Keep a hard ceiling** on total hops as a cost and latency backstop (for example 12-16; set the number from measured real turns, not a guess). Every hop is a billed Claude round trip, and the conversation grows each hop. Hitting the ceiling should be rare and should report clearly.
* **Clear user-facing stop:** when the failure budget is spent, say what failed in plain language (for example "I couldn't connect to the source after 3 tries"), not "maximum number of tool calls".
* **Telemetry:** record hops used, failures, and which budget ended the turn (`AssistantTelemetry` already tracks propose attempts and failures, so extend it).

### Constraints

* Beta tier: one turn still counts as **one** message against `HELIO_BETA_DAILY_MESSAGE_LIMIT`, regardless of hops. Confirm that's still true. (Since HEL-1755 the cap is weighted: one charge per turn at the model's weight.)
* Input-token growth: check that long loops stay within `CLAUDE_MAX_INPUT_TOKENS` (100k); the request is refused before sending if it doesn't.
* Latency: more hops means a longer wait. HEL-721 (streaming plus per-hop progress) makes long loops tolerable. This ticket doesn't depend on it, but the two together are the intended experience. Note the interaction in the PR.
* HEL-1636 touches the same `ClaudeClient` tool loop (thinking blocks). It is merged (7d9b2ea2d); build on it.

## Acceptance criteria

- [ ] A test that fails on the current code: a turn with, say, 6 successful hops followed by a final answer **completes**. Today it is cut off at `MaxHops`.
- [ ] A turn with 3 failing tool calls stops with a plain-language failure message, and the hard ceiling still stops a pathological loop (both tested).
- [ ] The web-search budget, beta daily limit and input-token limit are unchanged and still enforced (tested).
- [ ] The ceiling and failure counts are measured on a sample of real multi-step turns; the numbers and the reasoning are in the PR.

## Owner rulings and planning decisions (this run)

- **Hard ceiling = 12 hops** (owner, 2026-11-20, escalation answered via chat). Recorded turns are all censored at the old 4-hop cap, so the ceiling could not be measured from data; see `.concertino/runs/HEL-1637/evidence/turn-measurements.md` for the measured failure counts and the reasoning that goes in the PR.
- No live model call in this lane; tests use the fake transport.
- The ask loop (`POST /api/dashboards/:id/ask`, `/api/outputs/:id/ask`, HEL-1745, its own `MaxHops = 4`) is out of scope: the ticket names only the workspace assistant.
- Premise finding: the "3" the owner sees is the web client's hardcoded fallback text "I couldn't find enough in 3 lookups" in `ActiveConversationPanel.tsx`, shown on every hop-cap stop, so the web client is in scope for the stop message.

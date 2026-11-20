# HEL-1637 PR notes

## What changed
The in-app assistant's tool loop no longer stops after 4 total round trips. It stops after **3 failed tool calls
in a turn** (counted in total, not consecutively) or at a hard **ceiling of 12 round trips**, whichever comes first.
Each stop now tells the user, in plain language, what happened ("I couldn't connect to the source after 3 tries.").
"Reached the maximum number of tool calls" no longer exists, and the web client's fixed "3 lookups" text is gone.

## Measurements (no live model call; `turn-measurements.md`)
- 27 real tool-using turns persisted in local dev (gate and verification traffic, older models): hops 1:13, 2:5, 3:8,
  4:1. The distribution is **censored at the old cap of 4**, so it cannot show what an uncapped turn wants. Failed
  calls per turn never exceeded 1.
- Owner's prod transcript 2026-10-16 (haiku-4-5, 7 turns): calls per turn 2, 6, 3, 3, 8, 4, 12; failed calls per
  turn 0, 1, 3, 1, 4, 0, 12.
- **Failure budget 3** is supported by that data: productive turns show 0-3 failures, the pathological turn 7 shows 12.
- **Ceiling 12 is an owner ruling, not a measurement.** The data cannot set it (every turn was capped at 4). The
  longest productive turn observed needed at least 6 calls. Telemetry now records `hopsUsed` and `stopReason`, so the
  next decision can be made from real numbers.

## Why total, not consecutive (D1)
A consecutive count resets on every success, so "fail a propose, re-read with get_resource, fail the propose again"
(the transcript's own pattern) would never trip it and would run to the ceiling: 12 billed round trips that produce
nothing. A total count bounds wasted spend at 3 failures. The cost: a turn that recovered from 2 unrelated failures has
one left. The next user turn gets a fresh budget.

Failures are counted **per executed call**, not per round trip. Consequence: one response with 3 parallel failing
reads ends the turn after that single round trip (all 3 results are still returned). Parallel `propose_*` fan-out is
already reduced to one executed call per response by HEL-1639, and those synthetic rejections are not counted.
**Transcript turn 3** (3 failed calls out of 3) would now stop on the failure budget; that is consistent with "3 failures".

A `test_connection` that returns `ok: false` counts as a failure even though the tool call itself succeeded.

## Consequences to review
- **`input_budget` stop (D4).** An input-token overrun after at least one round trip used to discard the whole turn
  (`Left`, nothing persisted). It now ends the turn, keeps its work and persists a stop message. **Certain consequence:**
  the persisted conversation already exceeds the limit, so every later send in that conversation is refused at hop 1
  with the existing guardrail error (nothing persisted). The stop message tells the user to start a new conversation.
  A first request over the limit is still refused before sending, as before.
- **HEL-721 streaming.** Turns can now run up to 12 round trips instead of 4, so the wait for a reply grows with no
  progress indication. HEL-721 (streaming / per-hop progress) is the intended companion; this change does not add it.
- **Cost.** Each round trip is a billed model call and the conversation grows each hop. A beta turn is still **one**
  charge at the model's weight regardless of hops (tested: a 7-round-trip beta turn raises `assistant_daily_usage` by
  exactly the model's weight once). Worst case spend per turn rises from 4 to 12 round trips; the failure budget ends
  pathological turns early.
- **Ask loop untouched.** `AskDataService` keeps `MaxHops = 4`; it only gained the mechanical exhaustive-match arms.
- **No new environment variable**: both numbers are code constants.

## API / telemetry
- Converse response gains optional `stopReason` (`final | failure_budget | hop_ceiling | input_budget`) and
  `stopMessage`; both absent on GET. `hopBudgetExhausted` stays true only for `hop_ceiling`.
- `assistant_tool_loop_outcome` gains `hopsUsed` (tool-executing round trips), `failedToolCalls`, `stopReason`.
  Integers and a fixed token only; never tool input or error text.
- For `failure_budget` and `input_budget` an assistant text turn with the stop message is appended to the persisted
  transcript (its model stamp is the model that ran the turn; accepted, informational).

## Verification
Red test committed first (`red-run.txt`); seven named mutations each turn a test red (`mutations.md`).

## Prompt rule
The system prompt's hard rule said "at most 4 hops"; it now states the ceiling and failure budget, interpolated from
`AssistantStopMessages` so prompt and loop cannot drift (HEL-756 changed the same line when it raised the cap to 4).

## Follow-up (not done here)
`ClaudeClient.scala` (about 455 lines) and `AssistantServiceSpec` / `ClaudeClientSpec` / `AssistantConversationRoutesSpec`
were already over the soft file-size budget and grew. Suggested split: move the failure-budget and input-stop tests
into their own spec files, and the tool-loop helpers out of `ClaudeClient`.

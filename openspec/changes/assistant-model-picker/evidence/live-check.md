# Live check (task 5.9, C16)

Lane backend (`:10094`, dev account, `owner` tier), every converse pinned with `model`, one call at a time (never a loop).
Per-hop lines are the backend's post-parse INFO line (`Claude hop request-id=... requested=... response-model=...
stop_reason=... blocks=[...] usage=...`). The response model equalled the pinned id on every hop before it was counted
(no `Claude responded with model=` WARN in the log). Prices: `InsightPriceTable.Default` (micro-USD per MTok, read from the table).

The usage counters were added to the hop line after the first call, so that call (Haiku, conversation `2fd24761...`, ids
below) has no usage and is not in the totals; its cost is under $0.005 (two Haiku hops on a ~25k-token cached prompt).

## One short tool-using turn per model (`find` then answer)

| Model | hop | request-id | response model | stop_reason | blocks | thinking | usage in/out/cache_w/cache_r |
|---|---|---|---|---|---|---|---|
| haiku-5-5 | 1 | req_011Ch9REM9U1txmwgZ4AuqE5 | claude-haiku-5-5 | tool_use | tool_use | no | 4/46/0/25096 |
| haiku-5-5 | 2 | req_011Ch9REQR9q9unfwYsicANW | claude-haiku-5-5 | end_turn | text | no | 57/21/0/25096 |
| sonnet-5-5 | 1 | req_011Ch9REf9gkidxFKy9gLf48 | claude-sonnet-5-5 | tool_use | tool_use | no | 4/46/25089/0 |
| sonnet-5-5 | 2 | req_011Ch9REiqSawKm8DQtZM9hW | claude-sonnet-5-5 | end_turn | text | no | 57/30/0/25089 |
| opus-5-5 | 1 | req_011Ch9RF6wDoHq4zkE9M2od3 | claude-opus-5-5 | tool_use | tool_use | no | 4/46/25006/0 |
| opus-5-5 | 2 | req_011Ch9RFF8LcyEy21b3EkZZE | claude-opus-5-5 | end_turn | text | no | 57/22/0/25006 |

## One conversation Haiku -> Opus -> Haiku, every turn tool-using (`53a05c6b-...`)

| Turn (pinned) | hop | request-id | response model | stop_reason | blocks | thinking | usage in/out/cache_w/cache_r |
|---|---|---|---|---|---|---|---|
| 1 haiku | 1 | req_011Ch9RFXbHn1TdqQDbV5yhF | claude-haiku-5-5 | tool_use | tool_use | no | 4/47/107/24990 |
| 1 haiku | 2 | req_011Ch9RFaadUFJPxBxafTcZH | claude-haiku-5-5 | end_turn | text | no | 482/14/0/25097 |
| 2 opus | 1 | req_011Ch9RFnLYqVPQmhGb8ebbV | claude-opus-5-5 | tool_use | tool_use | no | 531/46/107/24900 |
| 2 opus | 2 | req_011Ch9RFsBG6gokGPb73dYwE | claude-opus-5-5 | end_turn | thinking,text | **yes** | 862/66/0/25007 |
| 3 haiku | 1 | req_011Ch9RGBETSn9cTY1ZrzNta | claude-haiku-5-5 | tool_use | tool_use | no | 911/46/0/25097 |
| 3 haiku | 2 | req_011Ch9RGE4sYdPytV74u68RP | claude-haiku-5-5 | end_turn | text | no | 964/11/0/25097 |

All six requests returned `200` (no 400) in both switch directions. The persisted transcript stamped each assistant turn
with its model (haiku, opus, haiku). Opus produced a thinking block on one hop (within its loop it is sent back unchanged;
persisted history drops it, so turn 3 on Haiku carried none). Corroborates the synthetic 5.4 fixtures for Haiku->Opus and
Opus->Haiku with tool use; a Sonnet switch pair was not run live (not required by the ruling).

## Cost (InsightPriceTable.Default)

Haiku $0.0019, Sonnet $0.0661, Opus $0.1500, total $0.218 against the $2 cap (stop at $1.50 projected was never near).
Total live hops: 12 recorded plus the 2 hops of the discarded first call.

## Conversations created and deleted by exact id

`2fd24761-d08a-4f0a-bed9-46242fc04e36` (discarded first call), `365203c8-63d5-4750-8cb4-4e38beeef1a0` (haiku),
`253b870a-bc1a-415d-8159-3c5458fc2a14` (sonnet), `71f6521c-ac61-4f6e-a581-aa2d01fcb754` (opus),
`53a05c6b-9b97-4ce5-a872-100e50941ca2` (switch conversation). The five `assistant_conversations` rows were deleted by
exact id from the dev DB. The transcript blob files under the local uploads root (`assistant-conversations/<user>/<id>.json`)
were NOT removed (a home-directory path needs explicit approval); they are orphaned, harmless local files.

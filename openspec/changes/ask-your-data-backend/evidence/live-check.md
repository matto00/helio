# Live check (task 4.10, C15)

Lane backend (`:10084`, started with `CLAUDE_MODEL=claude-haiku-5-5`, dev account, `owner` tier so uncounted), three questions,
one call at a time, Haiku only. The per-hop lines are the backend's post-parse INFO line (`Claude hop request-id=... requested=...
response-model=...`). The response model equalled `claude-haiku-5-5` on the FIRST hop of the first question and of every later
one, and there was no `Claude responded with model=` WARN anywhere in the log. Prices: `InsightPriceTable.Default`
(haiku-5-5: $0.10 input, $0.50 output, $0.125 cache write, $0.01 cache read per MTok). The API key was never printed or read.

Fixture (all created through the API under the shared dev account, deleted by exact id below): a pipeline with a static
5-row source (`region`, `revenue`), one root-bound `table` Output "Revenue by region", one dashboard with one panel on it.

| # | route | question | status | model asserted |
|---|---|---|---|---|
| 1 | `POST /api/dashboards/:id/ask` | Which region had the highest revenue, and how much was it? | 200 | first hop, before continuing |
| 2 | `POST /api/dashboards/:id/ask` | What was the revenue for West and for South? | 200 | first hop, before continuing |
| 3 | `POST /api/outputs/:id/ask` | Which two regions had the lowest revenue? | 200 | first hop, before continuing |

## Hops

Each question ran three hops: two `tool_use` hops, then the answer (the log line carries block types only, never content).

| Q | hop | request-id | response model | stop_reason | blocks | usage in/out/cache_w/cache_r |
|---|---|---|---|---|---|---|
| 1 | 1 | req_011ChA5C8ZYG15przfwBo9aY | claude-haiku-5-5 | tool_use | tool_use | 4/30/1226/0 |
| 1 | 2 | req_011ChA5CBww9vYhzfdMWnh7S | claude-haiku-5-5 | tool_use | tool_use | 112/97/0/1226 |
| 1 | 3 | req_011ChA5CFDsyB7vRXrsUPc3e | claude-haiku-5-5 | end_turn | thinking,text | 1531/182/0/1226 |
| 2 | 1 | req_011ChA5F6MAxfv16WWu7gyTq | claude-haiku-5-5 | tool_use | tool_use | 4/30/349/925 |
| 2 | 2 | req_011ChA5F9Mzuc6owiWVfBhxm | claude-haiku-5-5 | tool_use | tool_use | 112/97/0/1274 |
| 2 | 3 | req_011ChA5FCpMw7dn5qw3WgAEC | claude-haiku-5-5 | end_turn | thinking,text | 1531/76/0/1274 |
| 3 | 1 | req_011ChA5FZWYocgxnjG1TVQTj | claude-haiku-5-5 | tool_use | tool_use | 4/30/86/1190 |
| 3 | 2 | req_011ChA5FcQvzU8oqs5YNkt7n | claude-haiku-5-5 | tool_use | tool_use | 105/97/0/1276 |
| 3 | 3 | req_011ChA5FfRWCE4zYMwAsbtYu | claude-haiku-5-5 | end_turn | thinking,text | 1524/105/0/1276 |

## Answers (all validated; the citations listed are the ones the answer used)

1. "East had the highest revenue, at 1810 [c8]. The output's rank column lists North as rank 1 with 1200 [c3][c4], which conflicts with
   the revenue values, so the rank column looks wrong." Grounded, but wrong in spirit: the model took the pack's row-position `rank`
   cell for a data column. This ran against the first system prompt. I added one line to `AskPrompts.system` ("`rank` is only the row's
   position ... not a measure") and restarted the backend; questions 2 and 3 ran on the final prompt. Question 1 was NOT re-asked
   (the 3-question cap).
2. "West revenue was 640 [c10], and South revenue was 950 [c6]." Correct against the fixture.
3. "The two lowest-revenue regions are West, at 640 [c10], and South, at 950 [c6]. The table has five regions in total." Correct. "five"
   is a number word, which the validator documents it does not check.

Every response carried a non-null `pin` (owner of the pipeline), with `config.prompt` = the question, `reads.outputs` = the one cited
Output and `refresh: manual`; no answer text.

## Cost (InsightPriceTable.Default, haiku-5-5)

Q1 $0.00050, Q2 $0.00035, Q3 $0.00033; total about $0.0012 against the $1 cap (the $0.75 stop was never near). Nine hops, three questions.

## Fixture rows deleted by exact id (each `DELETE` answered 204; a following read of the Output answered 404 and the source list no longer held it)

- panel `98bc1c6b-f3e6-41c1-87b8-b9066ec0be36`
- dashboard `51418868-85a3-498e-ae1e-f17f37a7aa77`
- pipeline `192ae2dc-ff6b-4930-a4e3-ad287941d100` (its Output `17d5b845-928e-4ea0-85a6-25809bb45806` went with it)
- data source `d02a06c6-2083-4728-9faa-1fc8794abaf5`

No file landed under `~/.helio` (checked with `find /home/matt/.helio -newer <fixture ids file>`: empty). The dev account itself is shared and was not touched.

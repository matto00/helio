# HEL-1745: Insight L6: ask-your-data backend over a board's snapshots and history (read-only tools, pin as insight)

## Description

Leaf of HEL-921. Needs L3 (HEL-1741).

**Routes:** `POST /api/dashboards/:id/ask` and `POST /api/outputs/:id/ask`.

`AskDataService` runs `ClaudeClient.sendWithTools` with maxHops 4 (about 20k input tokens per hop) and
`webSearch = false`. It does not use `AssistantService.converse`, which always enables web search and the propose
tools.

**Read-only tools:**

* `list_board_outputs`
* `get_output_rows(outputId, filter, limit)`
* `get_output_history(outputId, since, limit)`
* `get_history_rows(pointId)`, offered only when the caller holds a pipeline grant

**Scope and billing:**

* On the dashboard path, every tool call re-checks access against the dashboard's panel scope. Never trust an id the
  model supplies.
* Answers carry L3 citations and pass the L3 validator.
* The asker pays, through `ChatAccessService` (owner rulings D3/D6): free tier gets 403 `TIER_FORBIDDEN`, beta is
  counted.
* Ask works only for signed-in dashboard grantees, with panel-scoped reads. Public and share-token viewers are denied
  (D8).
* Answers are not persisted.

**Pin:** `POST /api/outputs` with kind `insight`, the question as the prompt, the cited Outputs as `reads`, and
`refresh: manual`, followed by one render. It re-renders and never stores text the client supplied (D10). Pinning
needs an editor grant on the pipeline.

## Acceptance Criteria

* Fail-first: a dashboard-only viewer's tool calls cannot reach an Output that isn't placed on the board, or any
  payload row (403/404 in the tool result).
* An assertion shows the tool schema has no write or propose tool.
* On a fixture time series, the fake model's answer to "why did revenue dip on the 14th" cites the day-14 point.
* **Live check, pre-approved by the owner (D11):** 3 questions on `claude-haiku-5-5`, capped at $1. Assert the model
  id before the first call. If the run would go over the cap, escalate.

**Migration:** none. **Parallel:** can run alongside L4 and L5.

## Driver decisions binding this run (verified at Planning)

* L4 (HEL-1743, render service) is parked and not merged. Pin creates the insight Output only and does NOT render; the
  Output reads "Not yet rendered" until L4 wires render-on-pin. No render path is built here.
* Corrected at the design gate: the driver attributed a per-ask `model` field to rulings R1/R2. Those are HEL-1743
  (L4) render rulings and do not cover ask. Ask follows the ticket and epic D1 instead. It always uses the server
  `CLAUDE_MODEL`, with the catalog request rules (no sampling params, no `budget_tokens`, no forced `tool_choice`).
  The asker is charged through `ChatAccessService` at that model's catalog weight, and free tier gets 403
  `TIER_FORBIDDEN`. Whether ask should get a model choice is an open owner question.
* The ask response never carries model, token or cost fields (stricter than any ruling; mirrors R3 for viewers).
* Live check: Haiku only, `CLAUDE_MODEL=claude-haiku-5-5`, model id asserted before the first call, $1 cap. Sonnet and
  Opus shown with fakes only.

## Agent notes

* `OutputReadAccess.scala:12-27`: reading an Output needs a pipeline grant.
* `PublicPanelRowsResolver.scala:26-70`: the panel-scoped row path.
* `AssistantService.scala:91` (was cited as :86): `webSearch` is always true.
* New code goes in `services/ask/*` and `api/routes/ask/*`.

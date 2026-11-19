## Purpose

Lets an MCP agent read and refresh an insight Output's rendered narrative and ask a dashboard a grounded question,
wrapping the existing insight and ask REST routes without rendering, persisting or choosing a model itself.

## ADDED Requirements

### Requirement: get_output_insight MCP tool

The MCP server SHALL expose `get_output_insight(outputId)` that issues exactly one `GET /api/outputs/:id/insight` and
returns the backend body unchanged (`outputId`, `render`, `lastAttempt`, `canRefresh`). The tool SHALL never trigger a
render. Its description SHALL state that the response is role-shaped (an owner or editor sees model, token counts,
cost, run id, input digest and the real attempt status with `canRefresh: true`; a viewer sees none of those,
`canRefresh: false`, and a quota or budget skip as `not_updated`), that `render` is the newest successful narrative or
null, that `lastAttempt` is the newest attempt of any status, and that a non-insight, unknown or inaccessible Output is
a 404.

#### Scenario: Reading a rendered insight
- **WHEN** an agent calls `get_output_insight` for an insight Output with a successful render
- **THEN** the MCP server issues one `GET /api/outputs/<id>/insight` and returns the markdown and its citations as
  the backend wrote them

#### Scenario: Backend error surfaces as a tool error
- **WHEN** the backend answers 404
- **THEN** the tool result has `isError: true` and names the status, and no other request is issued

### Requirement: refresh_insight MCP tool

The MCP server SHALL expose `refresh_insight(outputId)` that issues exactly one `POST /api/outputs/:id/insight/refresh`
with no body and returns the backend's `{outputId, started}` unchanged. Its description SHALL state that the render is
asynchronous (the result appears later as `lastAttempt`/`render` on `get_output_insight`), that `started: false` means
a render of that Output was already in flight, that only the pipeline owner and editors may refresh (a viewer gets
403), that the refresh is charged to the pipeline owner and subject to the input-digest skip, the quota gate and its
own rate limit (429 with Retry-After).

#### Scenario: Starting a refresh
- **WHEN** an agent calls `refresh_insight` for an insight Output it can edit
- **THEN** the MCP server issues one `POST /api/outputs/<id>/insight/refresh` and returns `{outputId, started}`

### Requirement: ask_dashboard MCP tool

The MCP server SHALL expose `ask_dashboard(dashboardId, question)` that issues exactly one
`POST /api/dashboards/:id/ask` with body `{question}` and returns the backend's
`{answer, citations, citedOutputs, pin}` unchanged. The tool SHALL accept no model argument and SHALL bound `question`
to 1..2000 characters. Its description SHALL state that the server model answers from the dashboard's own Outputs
only, that every number is cited, that nothing is persisted, that a non-null `pin.request` is a body an agent may pass
to `add_output` on `pin.pipelineId` to keep the question as an insight Output, and the documented error bodies (422
`ASK_UNGROUNDED` and `ASK_ANSWER_TRUNCATED`, 403 `TIER_FORBIDDEN`, 429 `CHAT_LIMIT_REACHED`, 503 when the server has
no model key, 404 when the caller cannot ask that dashboard).

#### Scenario: Asking a question
- **WHEN** an agent calls `ask_dashboard` with a dashboard id and a question
- **THEN** the MCP server issues one `POST /api/dashboards/<id>/ask` whose body is exactly `{"question": <question>}`
  and returns the cited answer

#### Scenario: Empty question is rejected before any request
- **WHEN** an agent calls `ask_dashboard` with an empty question
- **THEN** the tool call fails input validation and no HTTP request is issued

### Requirement: Agent exit criterion is scripted against a fake model

The repository SHALL contain a test that drives the real MCP server through an MCP client against a fake Helio
backend whose response bodies are what the real backend routes write with a scripted model, so that an agent adds an
insight Output to an existing pipeline, refreshes it, reads a narrative with citations, places it on a dashboard, asks
that same dashboard a question and pins the answer, with no live model call. Every request the script issues SHALL be
a leg recorded from the real routes in one seeded world (method, path, request body, status, response body); the fake
backend SHALL refuse any unrecorded or out-of-order request. A backend test SHALL fail if the committed legs drift
from what the real routes write.

#### Scenario: Exit criterion end to end
- **WHEN** the scripted test runs
- **THEN** each MCP tool call's request matches the recorded request and each result carries the recorded body,
  including at least one citation on the narrative and on the answer

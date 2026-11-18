## Purpose

Ask a free question of a dashboard or an Output and get a cited, validated answer, computed by a read-only tool loop
that re-checks the caller's scope on every tool call and is charged to the asker.

## ADDED Requirements

### Requirement: Ask routes and access
The backend SHALL serve `POST /api/dashboards/:id/ask` and `POST /api/outputs/:id/ask` on the authenticated route tree
only. The dashboard route SHALL admit only the dashboard's owner or a user holding an explicit editor or viewer grant
row on it; a public-viewer grant or a share token SHALL NOT admit a caller, and a caller without access SHALL get the
same `404` as an unknown id. The Output route SHALL admit only a caller whom the explicit-SQL pipeline check
(`OutputReadAccess.readablePipelineId`) admits, else `404`; no access decision SHALL rest on RLS alone.

#### Scenario: Unauthenticated caller
- **WHEN** a request without a session or token posts to either ask route
- **THEN** it is rejected `401` and no model call is made

#### Scenario: Output route stranger
- **WHEN** a signed-in user with no grant on the Output's pipeline asks that Output
- **THEN** the response is `404` and no model call or charge is made

#### Scenario: Public dashboard, signed-in stranger
- **WHEN** a signed-in user with no grant asks a dashboard that has a public viewer grant, with or without `?token=`
- **THEN** the response is `404` and no model call or charge is made

### Requirement: Request and response contract
The request body SHALL be `{question}`, `question` 1..2000 characters after trimming (else `400`). Every ask SHALL use
the server `CLAUDE_MODEL`; the body has no model field. The `200` response SHALL be `{answer, citations, citedOutputs,
pin}` and SHALL NOT contain any model id, token count or cost. Neither the question nor the answer SHALL be persisted.

#### Scenario: Empty question
- **WHEN** the body is `{"question": "   "}`
- **THEN** the response is `400`, and no charge or model call is made

#### Scenario: No billing fields
- **WHEN** any ask succeeds
- **THEN** the JSON has no key named `model`, `usage`, `inputTokens`, `outputTokens` or `costMicros` at any depth

### Requirement: Tier gate and billing
Each ask SHALL be charged to the asker through `ChatAccessService` before the first model call: `free` gets `403`
`TIER_FORBIDDEN`, `beta` adds the server default model's catalog weight to the shared daily counter (a full counter is the
existing limit error), `owner` is uncounted. A corrective retry inside the same ask SHALL NOT charge again.

#### Scenario: Beta ask on a Sonnet server default
- **WHEN** the server default is `claude-sonnet-5-5` and a beta user asks
- **THEN** the daily usage counter rises by 4

#### Scenario: Free tier
- **WHEN** a free-tier grantee asks
- **THEN** the response is `403` `TIER_FORBIDDEN` and no model call is made

### Requirement: Read-only tool loop
`AskDataService` SHALL call `ClaudeClient.sendWithTools` with `maxHops = 4`, `webSearch = false`, no temperature, and
only the tools `list_board_outputs`, `get_output_rows`, `get_output_history`, and `get_history_rows`; the last SHALL be
offered only when the caller holds a pipeline grant on at least one in-scope Output. No tool SHALL write, propose or
apply anything.

#### Scenario: Tool schema has no write tool
- **WHEN** the tool list for any ask is inspected
- **THEN** every tool name is one of the four read tools and none matches `propose`, `apply`, `create`, `update`,
  `delete`, `write`, `pin` or `web_search`

### Requirement: Scope re-checked on every tool call
Every tool call SHALL resolve its scope from the database at call time and never trust a model-supplied id. On the
dashboard path an Output is in scope only while a panel of that dashboard binds it, rows SHALL be read through the
panel-scoped row path (filter gated to a binding panel's controls), history point ids SHALL be returned only to a
caller holding a pipeline grant on that Output, and `get_history_rows` SHALL require that grant on every call. An out-of-scope id SHALL return an error tool result (not found / not allowed),
never data.

#### Scenario: Dashboard-only viewer reaches for an off-board Output
- **WHEN** a dashboard viewer with no pipeline grant asks and the model calls `get_output_rows` with the id of an
  Output on the same pipeline that no panel of the board binds
- **THEN** the tool result is an error and contains no row of that Output

#### Scenario: Access removed between hops
- **WHEN** the panel binding an Output is removed after hop 1 and the model calls `get_output_rows` for it in hop 2
- **THEN** the hop-2 tool result is an error with no rows

#### Scenario: Filter through one of several panels
- **WHEN** two panels bind the same Output and only the second offers the filtered column as a control
- **THEN** `get_output_rows` with that filter returns rows through the second panel

#### Scenario: Dashboard-only viewer reaches for a payload row
- **WHEN** the same viewer's model calls `get_history_rows` with a real point id of an on-board Output
- **THEN** the tool result is an error and contains no payload row

### Requirement: Cited, validated answers
Tool results SHALL carry L3 citation cells with ids unique across the whole loop, including tool calls that run
concurrently within one model response. The final answer SHALL pass
`InsightValidator` against every citation issued in the loop (at most 6 sentences, 1200 characters). A failing answer
gets one corrective turn naming the reasons; a second failure SHALL return `422` with code `ASK_UNGROUNDED` and no
answer text. The response `citations` SHALL list exactly the citations the answer uses.

#### Scenario: Two history calls in one response
- **WHEN** one model response carries two `get_output_history` calls for different Outputs
- **THEN** their citation ids are disjoint and each id resolves to its own Output's value

#### Scenario: Revenue dip on the 14th
- **WHEN** the fake model asks for revenue history and answers "why did revenue dip on the 14th"
- **THEN** the answer cites the citation whose date is the 14th, and the response lists that citation

### Requirement: Pin hand-off without render
The response `pin` SHALL be non-null only when every cited Output is on one pipeline the caller can edit (owner or
editor grant); it SHALL carry that pipeline id, the node of the first cited Output, and a create body of kind
`insight` with `prompt` = the question, `reads.outputs` = the cited non-insight Output ids (at most 8), and
`refresh: "manual"`, and SHALL contain no answer text. Creating it through `POST /api/pipelines/:id/outputs` SHALL
NOT trigger a render in this change; render-on-pin belongs to HEL-1743.

#### Scenario: Viewer gets no pin
- **WHEN** the asker holds only a viewer grant on the cited Outputs' pipeline
- **THEN** `pin` is `null`

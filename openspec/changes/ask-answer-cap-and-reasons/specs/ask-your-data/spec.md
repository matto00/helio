## MODIFIED Requirements

### Requirement: Cited, validated answers
Tool results SHALL carry L3 citation cells with ids unique across the whole loop, including tool calls that run
concurrently within one model response. The final answer SHALL pass
`InsightValidator` against every citation issued in the loop (at most 6 sentences, 1200 characters). A failing answer
gets one corrective turn naming the reasons; a second failure SHALL return `422` with code `ASK_UNGROUNDED` and no
answer text. The `reasons` in that `422` body SHALL name only the kind of each failure and SHALL NOT contain any digit
or any value quoted from the rejected answer; the corrective turn sent to the model MAY name the values. The response
`citations` SHALL list exactly the citations the answer uses.

Each model hop SHALL allow 4096 output tokens (thinking and text combined), clamped by the server's
`CLAUDE_MAX_TOKENS`. A hop that ends the tool loop (it carries no tool call) and stops with `stop_reason: max_tokens`
SHALL end the ask with `422` code `ASK_ANSWER_TRUNCATED` and no answer text, whether the hop carried only thinking or
partial text, on the first answer and on the corrective turn alike; it SHALL NOT surface as `502` and a truncated answer
SHALL NOT be returned. It is not retried. A hop that stops at `max_tokens` while carrying a tool call is outside this
rule: the loop continues as before, and every tool call is still scope-checked.

#### Scenario: Two history calls in one response
- **WHEN** one model response carries two `get_output_history` calls for different Outputs
- **THEN** their citation ids are disjoint and each id resolves to its own Output's value

#### Scenario: Revenue dip on the 14th
- **WHEN** the fake model asks for revenue history and answers "why did revenue dip on the 14th"
- **THEN** the answer cites the citation whose date is the 14th, and the response lists that citation

#### Scenario: Ungrounded reasons carry no values
- **WHEN** the fake model answers "Revenue fell 99 percent on 2026-11-30." twice with nothing cited
- **THEN** the response is `422` `ASK_UNGROUNDED`, and no entry of `reasons` contains a digit

#### Scenario: Thinking-only hop at the cap
- **WHEN** the fake model's hop returns only a thinking block with `stop_reason: max_tokens`
- **THEN** the response is `422` `ASK_ANSWER_TRUNCATED` with no answer text, not `502`

#### Scenario: Partial answer at the cap
- **WHEN** the fake model's hop returns a text block with `stop_reason: max_tokens`
- **THEN** the response is `422` `ASK_ANSWER_TRUNCATED` and does not contain that text

### Requirement: Pin hand-off without render
The response `pin` SHALL be non-null only when every cited Output is on one pipeline the caller can edit (owner or
editor grant); it SHALL carry that pipeline id, the node of the first cited Output, and a create body of kind
`insight` with `prompt` = the question, `reads.outputs` = the cited non-insight Output ids (at most 8), and
`refresh: "manual"`, and SHALL contain no answer text. The node SHALL be `nodeStepId` when the first cited Output is on
a step, else `rootId` = its root id; an Output with neither (a null root id, which V98's backfill should have
eliminated) SHALL use the pipeline id, which is the id V98 gave each pipeline's backfilled root. Creating it through `POST /api/pipelines/:id/outputs` SHALL
NOT trigger a render in this change; render-on-pin belongs to HEL-1743.

#### Scenario: Viewer gets no pin
- **WHEN** the asker holds only a viewer grant on the cited Outputs' pipeline
- **THEN** `pin` is `null`

#### Scenario: Root id distinct from the pipeline id
- **WHEN** the first cited Output is root-bound to a root whose id differs from the pipeline id
- **THEN** the pin's `rootId` is that root id

#### Scenario: Output with no step and no root id
- **WHEN** the first cited Output has no step and no root id
- **THEN** the pin's `rootId` is the pipeline id

## ADDED Requirements

### Requirement: Thinking and unrecognised content blocks are kept exactly, never turned into text
The client SHALL decode a `thinking` block with its `thinking` text and `signature` exactly as received (an empty
`thinking` string stays empty), a `redacted_thinking` block with its `data` exactly as received, and any other
content-block type it does not model as the complete original JSON object. No such block SHALL ever become a text
block, and none SHALL contribute to the response's answer text.

#### Scenario: Haiku 5.5 thinking block followed by text
- **WHEN** a tool-use response contains `{"type":"thinking","thinking":"","signature":"S1"}` then `{"type":"text","text":"Hi"}`
- **THEN** the turn holds a thinking block with `thinking` "" and `signature` "S1", then a text block "Hi"
- **AND** the answer text is "Hi"

#### Scenario: Unknown block type
- **WHEN** a response contains a block of a type the client does not model, carrying arbitrary fields
- **THEN** the block is held as its complete original JSON object and never as a text block

### Requirement: Within one tool-use loop, model-internal blocks are sent back unchanged
A "strip point" is a hop whose offered tools differ from the previous hop's, or a hop where removing an empty
text block would alter a message that holds a thinking block. At a strip point, the client SHALL discard every
thinking and redacted-thinking block produced so far in that loop. It SHALL never send any of them again in that
loop. Every other earlier-hop thinking, redacted-thinking and unrecognised block SHALL be sent back in the same
position and order, with every field byte-equal to what the API returned.

#### Scenario: Web search shrinks the tool list
- **WHEN** hop 1 returns a thinking block, a `web_search` server-tool use and its result, and a `tool_use` block, so
  hop 2 offers `web_search` with a smaller `max_uses`
- **THEN** hop 2's request contains no thinking block from hop 1, and still contains hop 1's other blocks

#### Scenario: A later hop after a strip point
- **WHEN** hop 2 (a strip point) returns a thinking block with signature "S2" and a `tool_use`, makes no search, and
  hop 3 offers the same tools as hop 2
- **THEN** hop 3's request contains the "S2" thinking block byte-exact and no thinking block from hop 1

#### Scenario: Thinking then tool_use, second hop
- **WHEN** hop 1 returns a thinking block (empty `thinking`, signature "S1"), a `redacted_thinking` block (data "D1")
  and a `tool_use` block, and the loop makes a second request
- **THEN** that request's assistant message contains `{"type":"thinking","thinking":"","signature":"S1"}`,
  `{"type":"redacted_thinking","data":"D1"}` and the `tool_use` block, in that order

### Requirement: The client never sends an empty text block
No request the client sends SHALL contain a text content block whose text is empty, including requests built from
history that already holds empty text blocks. A message left with no blocks after removing them SHALL be dropped, and
same-role neighbours this creates SHALL be merged so roles still alternate.

#### Scenario: Single-shot request with an empty assistant message
- **WHEN** a single-shot request's messages include an assistant message with empty content between two user messages
- **THEN** the serialized request has no empty message and the two user messages are one user message

#### Scenario: Legacy history with an empty text block
- **WHEN** the history holds an assistant turn `[text "", text "Hello"]` and the next request is built
- **THEN** the serialized request contains no `{"type":"text","text":""}` block and keeps the "Hello" block

### Requirement: A refusal or a response with no answer is a typed error
In the tool-use loop, a hop with `stop_reason` `refusal`, or a response with no `tool_use` block, no non-empty text
and `stop_reason` `max_tokens` or `pause_turn`, SHALL fail. In single-shot `send`, a refusal or any response with no
non-empty text SHALL fail. Either failure SHALL be carrying the stop reason and, for a refusal, the
`stop_details.category` when present. It SHALL never be a successful empty answer.

#### Scenario: Refusal
- **WHEN** a hop returns `stop_reason: "refusal"`, empty `content` and `stop_details.category: "cyber"`
- **THEN** the loop fails with a no-answer error carrying reason `refusal` and category `cyber`

#### Scenario: Empty end_turn after a tool hop
- **WHEN** hop 1 calls a tool and hop 2 returns `stop_reason: "end_turn"` with empty `content`
- **THEN** the loop completes successfully with empty answer text and the full tool history

#### Scenario: Single-shot refusal reaches a pipeline AI step
- **WHEN** a pipeline AI step's model call is refused
- **THEN** the AI step fails with an error naming the refusal and writes no empty output

#### Scenario: Thinking only, out of tokens
- **WHEN** a hop returns only a thinking block with `stop_reason: "max_tokens"`
- **THEN** the loop fails with a no-answer error carrying reason `max_tokens`

### Requirement: Default sampling parameters are not sent
The client SHALL omit `temperature` from the request when the resolved temperature equals the API default of 1.0, and
SHALL send it only when it differs from that default. It SHALL never send `top_p` or `top_k`.

#### Scenario: Default configuration
- **WHEN** no caller override is supplied and the configured temperature is 1.0
- **THEN** neither a `send` nor a tool-use request contains `temperature`, `top_p` or `top_k`

#### Scenario: Explicit non-default temperature
- **WHEN** the configured temperature is 0.5
- **THEN** the request carries `"temperature": 0.5`

### Requirement: Each API response's request id is logged
The transport SHALL log, for every Messages API response, the HTTP status and the `request-id` response header value.
It SHALL never log the API key, the request body or the response body as part of that line.

#### Scenario: Successful response
- **WHEN** a response arrives with header `request-id: req_123`
- **THEN** one log line names `req_123` and the status, and contains no key material

## ADDED Requirements

### Requirement: Mid-stream connection failures surface as a typed error event
`ClaudeClient.stream` and `HttpClaudeTransport.stream` SHALL NOT silently hang or terminate the
`Source` with no signal when the underlying SSE connection fails or drops after streaming has
already started; a mid-stream failure SHALL surface as a `ClaudeStreamEvent.Error` element, after
which the `Source` SHALL complete.

#### Scenario: A mid-stream connection drop surfaces as an error event, not a silent hang
- **WHEN** the byte source driving an active `ClaudeClient.stream` call fails after at least one
  prior `ClaudeStreamEvent` has already been emitted
- **THEN** the resulting `Source` emits a `ClaudeStreamEvent.Error` element and then completes,
  rather than hanging indefinitely or terminating with an unhandled stream failure

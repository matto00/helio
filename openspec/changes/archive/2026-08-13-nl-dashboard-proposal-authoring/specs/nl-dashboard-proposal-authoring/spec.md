## ADDED Requirements

### Requirement: Upstream Claude API/transport failures SHALL surface as a Bad Gateway response
The authoring service SHALL surface a `502 Bad Gateway` response, for both the buffered and
streaming variants, when `ClaudeClient.send`/`ClaudeClient.stream` fails with
`ClaudeError.ApiError` or `ClaudeError.TransportFailure` (an upstream failure, not a guardrail
rejection).

#### Scenario: A buffered call maps an upstream failure to 502
- **WHEN** `ClaudeClient.send` resolves to `Left(ClaudeError.ApiError(_, _))` or
  `Left(ClaudeError.TransportFailure(_))`
- **THEN** `POST /api/authoring/dashboard` responds `502 Bad Gateway`

#### Scenario: A streaming call's terminal error event reflects the same mapping
- **WHEN** `ClaudeClient.stream` terminates with a `ClaudeStreamEvent.Error` carrying
  `ClaudeError.ApiError` or `ClaudeError.TransportFailure`
- **THEN** the SSE response's terminal `AuthoringStreamEvent.Error` carries the same
  Bad-Gateway-mapped message as the buffered path would for an identical failure

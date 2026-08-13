# nl-dashboard-proposal-authoring Specification

## Purpose
A backend endpoint that turns a user's natural-language goal into a validated, review-ready
`DashboardProposal`, grounded in the caller's real workspace context and panel capabilities via
`ClaudeClient` — never applying the proposal itself, and reusing the apply path's own validation so
an NL-authored proposal is held to the same standard as a hand-authored one.
## Requirements
### Requirement: The endpoint authors, validates, but never applies a proposal
`POST /api/authoring/dashboard` SHALL accept `{ goal: String, contextOptions: Option[...] }` and
return either `{ proposal: DashboardProposal, warnings: [String] }` on success or a structured error
response. It SHALL NOT create a dashboard, panel, or any other persisted resource — applying stays
the caller's explicit, separate action via the existing apply endpoint.

#### Scenario: A successful call returns a proposal without creating anything
- **WHEN** `POST /api/authoring/dashboard` is called with a goal against a non-empty workspace and
  the model returns a structurally valid proposal
- **THEN** the response is `200` with `{ proposal, warnings }`, and no dashboard or panel exists in
  the database as a result of this call

### Requirement: Proposal validation reuses the apply path's own checks
The authoring service SHALL validate the parsed proposal via `DashboardProposalService.validate`,
the same structural + binding checks `DashboardProposalService.apply` uses — not a divergent copy.
A proposal binding a panel to a non-pipeline-output DataType SHALL be rejected identically to how
`apply` would reject it.

#### Scenario: A binding to a source-companion type is rejected exactly as apply would reject it
- **WHEN** the model's (post-repair, if needed) proposal binds a data panel to a DataType that is not
  a pipeline output
- **THEN** the authoring call fails with the same validation error `DashboardProposalService.apply`
  would produce for an identical proposal, and `DashboardProposalService.validate` is the single
  code path both call sites share

### Requirement: Grounding uses real workspace context and the panel-capability menu
Before calling the model, the authoring service SHALL assemble the caller's real workspace context
(via `WorkspaceContextService.assemble`) and a panel-capability menu (via
`PanelCapabilityService.getCapabilities`, fanned out over the context's pipeline-output DataTypes)
into the prompt Claude is grounded with.

#### Scenario: The prompt is grounded in the caller's real data types
- **WHEN** an authoring call is made against a workspace containing at least one pipeline-output
  DataType
- **THEN** the system prompt sent to `ClaudeClient` includes that DataType's id and its
  panel-capability entry from `PanelCapabilityService`

### Requirement: An empty workspace SHALL return a clear signal, never a hallucinated proposal
The authoring service SHALL return `422 Unprocessable Entity` with a clear "nothing to build from"
message, before making any call to `ClaudeClient`, when the assembled workspace context contains
zero pipeline-output DataTypes.

#### Scenario: Empty workspace short-circuits before any Claude call
- **WHEN** `POST /api/authoring/dashboard` is called against a workspace with zero pipeline-output
  DataTypes
- **THEN** the response is `422` and the injected `ClaudeTransport` records zero invocations

### Requirement: A structurally invalid first output SHALL trigger exactly one bounded repair attempt
The authoring service SHALL re-prompt the model exactly once, including the validation/parse error
in the repair prompt, when the model's first response fails to parse as JSON or fails
`DashboardProposalService.validate`. If the repair attempt also fails, the service SHALL return
`422` without a further attempt.

#### Scenario: An invalid first attempt is repaired successfully
- **WHEN** a stub `ClaudeTransport` returns a structurally invalid proposal on its first call and a
  valid one on its second
- **THEN** the authoring call succeeds with the second call's proposal, and the transport records
  exactly two invocations

#### Scenario: Two invalid attempts fail cleanly, not a third attempt
- **WHEN** a stub `ClaudeTransport` returns a structurally invalid proposal on both its first and
  second calls
- **THEN** the authoring call fails with `422`, and the transport records exactly two invocations —
  never a third

### Requirement: A streaming variant forwards progress and a terminal result or error
`POST /api/authoring/dashboard?stream=true` SHALL return a `text/event-stream` response that
forwards the model's text-delta progress (via `ClaudeClient.stream`) as it is generated, followed by
exactly one terminal event carrying either the validated `{ proposal, warnings }` or a structured
error — never leaving the stream open with no terminal signal.

#### Scenario: A streaming call ends with a terminal result event
- **WHEN** a stub streaming `ClaudeTransport` emits text deltas that assemble into a valid proposal
- **THEN** the SSE response includes one or more progress events followed by exactly one terminal
  result event carrying the validated proposal

#### Scenario: A streaming call that needs repair still ends with exactly one terminal event
- **WHEN** a stub streaming `ClaudeTransport`'s first assembled output is structurally invalid and a
  bounded repair attempt succeeds
- **THEN** the SSE response includes the first attempt's progress events, an intermediate status
  event, and exactly one terminal result event — never two terminal events

### Requirement: Cost/token guardrails apply to every request via the underlying client
The authoring service SHALL NOT implement its own token/cost guardrail; every call to
`ClaudeClient.send`/`ClaudeClient.stream` (including a repair attempt) SHALL go through that
client's own guardrails (HEL-390) unmodified.

#### Scenario: An over-budget goal is rejected by the underlying client's own guardrail
- **WHEN** the assembled prompt's estimated input tokens exceed `ClaudeConfig.maxInputTokens`
- **THEN** the authoring call fails via `ClaudeClient`'s existing `GuardrailExceeded` path, mapped to
  a `422` response, with no authoring-service-specific guardrail logic involved

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


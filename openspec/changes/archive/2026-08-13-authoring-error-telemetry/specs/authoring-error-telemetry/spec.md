## ADDED Requirements

### Requirement: Each authoring failure mode SHALL be distinct and UI-branchable
Authoring error responses (buffered and streaming) SHALL carry a `kind` field distinguishing
`ModelFailure`, `InvalidProposal`, `EmptyWorkspace`, and `BudgetExceeded` — never a bare message the
client must string-match to determine the failure category.

#### Scenario: A model/transport failure is distinguishable from a validation failure
- **WHEN** an authoring call fails due to an upstream Claude API/transport error versus a
  repair-exhausted invalid proposal
- **THEN** the two responses carry different `kind` values (`ModelFailure` vs `InvalidProposal`)
  even though both may share the same or a similar HTTP status family

#### Scenario: A guardrail rejection and an empty workspace are distinguishable
- **WHEN** an authoring call is rejected for exceeding a token/cost guardrail versus having no
  pipeline-output DataTypes to ground against
- **THEN** the two responses carry different `kind` values (`BudgetExceeded` vs `EmptyWorkspace`)

### Requirement: Every authoring request SHALL emit a structured, privacy-safe telemetry record
The backend SHALL emit one structured JSON log line per authoring request outcome (HEL-115 format,
carrying HEL-116 trace context automatically), recording outcome, kind (on failure), panel count (on
success), model id, real token usage, and a privacy-safe representation of the goal — never the raw
goal text.

#### Scenario: A successful authoring call emits a generated-outcome record
- **WHEN** an authoring call succeeds
- **THEN** a telemetry log line is emitted with outcome `generated`, the resulting proposal's panel
  count, the model id, and real token usage from the API response

#### Scenario: A failed authoring call emits a failed-outcome record with its kind
- **WHEN** an authoring call fails with any of the defined `AuthoringErrorKind` values
- **THEN** a telemetry log line is emitted with outcome `failed` and that specific kind

#### Scenario: The goal is never recorded verbatim
- **WHEN** any telemetry log line is emitted for a request carrying a user-typed goal
- **THEN** the log line contains only the goal's length and a truncated hash, never the goal's raw
  text

### Requirement: No secret SHALL appear in any telemetry log line
Telemetry emission SHALL NOT log the configured `ANTHROPIC_API_KEY` or any other secret material, in
any field, under any outcome.

#### Scenario: A model-failure telemetry record does not leak the API key
- **WHEN** a telemetry record is emitted for a `ModelFailure` outcome (the path most likely to be
  tempted to log a raw upstream error body)
- **THEN** the resulting log output does not contain the configured API key value

### Requirement: An apply-outcome SHALL correlate back to its originating authoring request
A successful authoring response SHALL include an `authoringRequestId`; a new
`POST /api/authoring/requests/:id/outcome` endpoint SHALL accept `accepted`/`rejected` and emit a
telemetry record correlated to that id — without altering the behavior of the existing apply-proposal
endpoint in any way.

#### Scenario: Accepting a proposal emits a correlated accepted-outcome record
- **WHEN** a user accepts an AI-authored proposal in the Proposal Review UI and the apply succeeds
- **THEN** a telemetry record is emitted with outcome `accepted`, correlated to the originating
  `authoringRequestId`, and the apply-proposal call itself behaves exactly as it did before this
  change

#### Scenario: Rejecting a proposal emits a correlated rejected-outcome record
- **WHEN** a user rejects an AI-authored proposal in the Proposal Review UI
- **THEN** a telemetry record is emitted with outcome `rejected`, correlated to the originating
  `authoringRequestId`

#### Scenario: A non-AI-authored proposal never triggers the new endpoint
- **WHEN** a proposal reaches the Proposal Review UI via the pre-existing MCP hand-off or demo
  fixture path (no `authoringRequestId` present)
- **THEN** accepting or rejecting it makes no call to the new outcome endpoint, and behaves exactly
  as it did before this change

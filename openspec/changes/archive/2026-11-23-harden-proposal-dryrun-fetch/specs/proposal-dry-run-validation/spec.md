## ADDED Requirements

### Requirement: Dry-run fetch-failure text is capped
When an inline rest or sql root's propose-time schema fetch fails, the failure text the dry run carries SHALL be at most
500 characters of the connector's error, counted in Unicode code points and never splitting a surrogate pair, followed
by the marker ` … [truncated]` when it was cut. Every rejection message and every assistant `is_error` tool result that
quotes that failure SHALL quote only the capped text. Error text at or under the cap SHALL pass through unchanged.

#### Scenario: Oversized remote error body
- **WHEN** an inline REST root's fetch fails with an HTTP error whose body is 100,000 characters, and an Output maps a
  column on that root
- **THEN** propose rejects with `roots[N]: could not read the source schema (...)` whose quoted part is the first 500
  characters of the error followed by ` … [truncated]`, and the assistant's `is_error` tool_result content for that
  call is bounded the same way

#### Scenario: Short error unchanged
- **WHEN** the fetch fails with an error of 500 characters or fewer
- **THEN** the quoted text is exactly the connector's error, with no marker

### Requirement: Dry-run fetch goes through the egress guard
The propose-time schema fetch of an inline REST root SHALL be issued only through the same egress (SSRF) guard every
persisted REST fetch uses, so a destination the guard refuses (for example a loopback address) is refused before any
connection is opened.

#### Scenario: Loopback destination refused at propose
- **WHEN** a pipeline proposal has an inline REST root whose URL is a loopback address served by a live local server,
  with the default address denylist, and an Output maps a column on that root
- **THEN** propose rejects with the guard's refusal text quoted as the root's fetch failure, and the local server
  receives zero requests

### Requirement: Schema-free checks run before the charged fetch
The pipeline proposal dry run SHALL run its request-only preflight (step and Output shape checks that need no schema)
and its cross-owner reference checks before any inline root's charged schema fetch, so a proposal those checks reject
spends no source-fetch budget unit. The Output `fieldMapping` column check needs the fetched schema and runs after it.

#### Scenario: Step error refused without a fetch
- **WHEN** a pipeline proposal with an inline REST root has a step the preflight rejects
- **THEN** propose rejects with the preflight's message, no fetch is issued, and the caller's source-fetch budget is
  not charged

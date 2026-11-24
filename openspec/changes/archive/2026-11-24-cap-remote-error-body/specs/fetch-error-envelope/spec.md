## ADDED Requirements

### Requirement: REST remote error text is capped at the connector
When a REST connector request (a fetch or a connection test) receives a non-2xx response, the error text the
connector returns (`HTTP <code>: <body>`) SHALL be at most 500 Unicode code points, never splitting a surrogate pair,
followed by the marker ` … [truncated]` when it was cut. This SHALL be the same cap and marker as the propose-time
dry-run cap, implemented by one shared function. Text at or under the cap SHALL pass through unchanged. Every consumer
of that error (the assistant `test_connection` tool result, the proposal-apply blocked-run reason, source
`fetchError`, the run `error_log`) SHALL receive only the capped text.

#### Scenario: Oversized body on a connection test
- **WHEN** the assistant calls `test_connection` for an inline REST config whose endpoint returns HTTP 500 with a
  100,000-character body
- **THEN** the tool result's error text is the first 500 code points of `HTTP 500: <body>` followed by ` … [truncated]`

#### Scenario: Oversized body on proposal apply
- **WHEN** a proposal is applied with an inline REST root whose endpoint returns HTTP 500 with a 100,000-character body
- **THEN** the blocked-run reason quotes only the capped error text, not the full body

#### Scenario: Surrogate pair at the cut
- **WHEN** the 500th and 501st UTF-16 units of the error text are one astral character's surrogate pair
- **THEN** the capped text ends with whole code points (no lone surrogate) followed by ` … [truncated]`

#### Scenario: Short error unchanged
- **WHEN** the error text is 500 code points or fewer
- **THEN** it is returned exactly, with no marker

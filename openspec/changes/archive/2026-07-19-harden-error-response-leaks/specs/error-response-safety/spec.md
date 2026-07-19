## ADDED Requirements

### Requirement: Error responses never leak internal exception detail

The system SHALL NOT include raw exception text (e.g. `Throwable.getMessage` /
`getLocalizedMessage`) or raw database/driver detail (e.g. `PSQLException` message text,
JDBC/SQLSTATE, table/column/constraint names) in any HTTP error response body returned to a
client. When an error path handles an exception, the system SHALL log the full exception,
including its stack trace, server-side, and SHALL return a generic, curated client-safe message.
This invariant holds regardless of whether the response is completed directly in a route or
mapped from a `ServiceError` via the `ServiceResponse` bridge.

#### Scenario: Unexpected internal exception on any endpoint

- **WHEN** a request handler fails with an unexpected exception (e.g. a database driver error) that
  is surfaced as a `5xx` response
- **THEN** the response body contains a generic message (e.g. `"Internal server error"`) with no
  raw exception text, driver detail, or stack information
- **AND** the full exception and stack trace are logged server-side

#### Scenario: Curated validation and not-found messages are preserved

- **WHEN** an error path returns a curated, non-sensitive client message (e.g.
  `"Pipeline not found: <id>"` or a payload-size-limit message) that contains no raw exception or
  driver text
- **THEN** that message is returned to the client unchanged
- **AND** no raw `getMessage` or database-driver detail is appended to it

#### Scenario: Data-source connector failures return a generic category message

- **WHEN** a data-source connector operation (SQL execution, REST/HTTP request, file parse) fails
  and the failure is surfaced to the client
- **THEN** the client receives a generic category message (e.g. `"SQL execution failed"`,
  `"Request failed"`) with no raw driver/exception text
- **AND** the underlying exception is logged server-side

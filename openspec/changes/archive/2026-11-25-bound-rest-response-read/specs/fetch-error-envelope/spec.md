## ADDED Requirements

### Requirement: REST remote error body is read with a byte bound
When a REST connector request (a fetch or a connection test) receives a non-2xx response, the connector SHALL read at
most a small fixed number of body bytes (4 KiB) and then stop reading and release the connection, rather than reading
the whole body before capping. The resulting error text SHALL equal what `HTTP <code>: <body>` capped at 500 code points
would be for the full body, for every body the previous implementation returned capped text for. A body that is larger
than the previous whole-body read ceiling, or never ends, SHALL yield the capped text once the byte bound is reached,
instead of a generic request failure. A 2xx response's handling, size ceiling and result SHALL be unchanged.

#### Scenario: Very large error body
- **WHEN** a REST endpoint answers HTTP 500 with a body far larger than 8 MiB
- **THEN** the connector returns `HTTP 500: ` plus the head of the body capped at 500 code points with ` … [truncated]`,
  having held no more than the byte bound plus one received chunk of the body, and having stopped reading it

#### Scenario: Never-ending error body
- **WHEN** a REST endpoint answers HTTP 500 and streams body bytes slowly without ever completing
- **THEN** the connector returns the capped error text once the byte bound is reached, without waiting for the
  request timeout

#### Scenario: Ordinary error body unchanged
- **WHEN** a REST endpoint answers non-2xx with a body that is short, or long but under the old ceiling
- **THEN** the error text is identical to the text produced by capping `HTTP <code>: <full body>`

#### Scenario: Success path unchanged
- **WHEN** a REST endpoint answers 2xx with a body under 8 MiB, or over it
- **THEN** the fetch result is the same as before (parsed JSON, or `Request failed` over the ceiling), and a connection
  test's result is the same as before

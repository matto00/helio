# mcp-rate-limit-handling Specification

## Purpose
Defines how the helio-mcp server's HTTP client handles backend 429 rate-limit responses so a throttled tool call either succeeds after a short transparent wait or fails fast with an actionable rate-limit error, never with an opaque MCP request timeout.

## Requirements

### Requirement: Bounded transparent retry of rate-limited requests

The helio-mcp HTTP client SHALL retry a generic 429 response (one not carrying the `CHAT_LIMIT_REACHED` code) after waiting the server's `Retry-After` delta-seconds, or an exponential backoff when no usable `Retry-After` is present. The total time one request spends waiting across all of its retries SHALL NOT exceed a fixed wait budget, and that budget SHALL be at most half of the installed MCP SDK's default request timeout.

#### Scenario: Short Retry-After is waited out transparently

- **WHEN** the backend answers 429 with `Retry-After: 7` and then succeeds
- **THEN** the client waits 7 seconds, re-sends, and returns the successful response to the tool

#### Scenario: Cumulative waits never exceed the budget

- **WHEN** the backend keeps answering 429 with any sequence of `Retry-After` values, or none
- **THEN** the sum of all waits the client performs for that one request is no greater than the wait budget

#### Scenario: Budget stays below the SDK timeout

- **WHEN** the installed `@modelcontextprotocol/sdk` default request timeout is read
- **THEN** the wait budget is at most half of it

### Requirement: Rate-limit error instead of an over-long wait

When the wait a 429 asks for would push the request's cumulative waiting past the budget, or the retry attempts are exhausted, the client SHALL NOT sleep or re-send again. It SHALL fail the request with a rate-limit error that has status 429, carries the server's retry-after in seconds when the server sent one, and whose message states that the request was rate limited and, when the server sent a retry-after, after how many seconds to retry (otherwise that no retry-after was given). The tool result surfaced to the MCP caller SHALL be an `isError` result containing that message, returned before the caller's request timeout.

#### Scenario: Near-timeout Retry-After surfaces immediately

- **WHEN** the backend answers 429 with `Retry-After: 59`
- **THEN** the client performs no wait and no re-send, and fails with a rate-limit error reporting a retry-after of 59 seconds

#### Scenario: Tool caller sees a rate-limit error, not a timeout

- **WHEN** an MCP client with the SDK's default request timeout calls a tool whose backend request is answered 429 with `Retry-After: 59`
- **THEN** the call resolves with an `isError` result whose text names the rate limit and the 59 s retry-after, rather than rejecting with request-timeout error `-32001`

#### Scenario: Daily chat cap is still not retried

- **WHEN** the backend answers 429 with body code `CHAT_LIMIT_REACHED`
- **THEN** the client surfaces it immediately with the code, without waiting, exactly as before

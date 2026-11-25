# mcp-request-path-safety Specification

## Purpose
Keeps every helio-mcp REST request on the endpoint its tool intends: an agent-supplied id is one encoded path segment,
and no request leaves the configured API origin.

## Requirements

### Requirement: Agent-supplied ids are single encoded path segments

helio-mcp SHALL place every id it interpolates into a REST request path as exactly one path segment. An id that is
empty, equal to `.` or `..`, or contains `/`, `?`, `#` or `\` SHALL be rejected with a typed error before any request
is sent. Every other id SHALL be percent-encoded, so a valid UUID or slug produces the same URL as before.

#### Scenario: Traversal id is rejected without a request

- **WHEN** a tool is called with an id of `1/../../tokens`, `..` or `.`
- **THEN** no HTTP request is sent and the tool returns an error result naming the rejected id

#### Scenario: Query or fragment injection is rejected

- **WHEN** a tool is called with an id of `x?force=true`, `a#b`, `a\b` or the empty string
- **THEN** no HTTP request is sent and the tool returns an error result

#### Scenario: Valid ids are unchanged

- **WHEN** a tool is called with a UUID or a slug such as `top-n`
- **THEN** the request path contains that id verbatim as one segment

#### Scenario: Other characters are encoded

- **WHEN** an id contains a space, `%` or another reserved character not in the rejected set
- **THEN** the request path carries it percent-encoded inside a single segment

### Requirement: Requests never leave the configured API origin

helio-mcp's HTTP client SHALL refuse to build a request URL from a path that starts with `//`, and SHALL refuse any
built URL whose origin differs from the configured base URL's origin, with a typed error and no request sent.

#### Scenario: Protocol-relative path is refused

- **WHEN** a request is built from a path starting with `//`
- **THEN** the client throws and sends nothing

#### Scenario: Origin change is refused

- **WHEN** a path resolves to a URL whose origin differs from the base (for example `/\evil.example/x`)
- **THEN** the client throws and sends nothing

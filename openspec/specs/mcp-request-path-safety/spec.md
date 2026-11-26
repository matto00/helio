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

helio-mcp SHALL build every REST request URL (the API client, the refresh-family client and the PAT liveness check
alike) by resolving the request path beneath the configured base URL, keeping the base URL's full path prefix. A base
URL with and without a trailing slash SHALL produce identical request URLs. The client SHALL refuse a path that starts
with `//` or contains `\`, an ASCII control character or a space, any built URL whose origin differs from the base URL's origin, and any built URL whose path does not lie
beneath the base URL's path prefix, with a typed error and no request sent. A request method of the API client SHALL
report such a refusal as a rejected promise, never a synchronous throw.

#### Scenario: Path prefix is preserved

- **WHEN** the base URL is `https://h/helio` or `https://h/helio/` and a request is made to `/api/x`
- **THEN** the request is sent to `https://h/helio/api/x`

#### Scenario: Protocol-relative path is refused

- **WHEN** a request is built from a path starting with `//`
- **THEN** the request method returns a rejected promise with a typed error and sends nothing

#### Scenario: Origin change is refused

- **WHEN** a path would resolve to a URL whose origin differs from the base (for example a path starting `/https://`)
- **THEN** the request method returns a rejected promise with a typed error and sends nothing

#### Scenario: Backslash, control and space characters are refused

- **WHEN** a path contains `\`, an ASCII control character or a space (for example `/\evil.example/x` or `/\t/evil.example/x`), with a root base or a prefixed base
- **THEN** the request method returns a rejected promise with a typed error and sends nothing

#### Scenario: Dot segments cannot climb above the prefix

- **WHEN** the base URL is `https://h/helio` and a path such as `/api/../../tokens` or `/../x` resolves outside `/helio/`
- **THEN** the request method returns a rejected promise with a typed error and sends nothing

#### Scenario: No request method throws synchronously

- **WHEN** any API client request method (`get`, `post`, `patch`, `put`, `delete`, `postMultipart`) is given a path or base URL from which no URL can be built
- **THEN** the call itself returns normally with a promise, and that promise rejects with a typed error

### Requirement: The API base URL is validated at configuration load

helio-mcp SHALL reject a `HELIO_API_BASE_URL` that is not an absolute `http:` or `https:` URL, or that carries a query
string or fragment, when it loads its configuration (stdio and HTTP mode), with an error message that names
`HELIO_API_BASE_URL`. The server SHALL NOT start with such a value.

#### Scenario: Scheme-less base is rejected

- **WHEN** `HELIO_API_BASE_URL` is `localhost:8080`, `helio.test/api` or another value that is not an absolute http(s) URL
- **THEN** configuration loading fails with a message naming `HELIO_API_BASE_URL`

#### Scenario: Non-http scheme is rejected

- **WHEN** `HELIO_API_BASE_URL` is `ftp://h` or `file:///x`
- **THEN** configuration loading fails with a message naming `HELIO_API_BASE_URL`

#### Scenario: Valid bases are accepted

- **WHEN** `HELIO_API_BASE_URL` is unset (default `http://localhost:8080`), `https://h`, `https://h/helio` or `https://h/helio/`
- **THEN** configuration loads, and the prefixed forms target the same request URLs

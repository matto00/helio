## MODIFIED Requirements

### Requirement: Streamable HTTP endpoint serves the same tool set

helio-mcp SHALL provide an HTTP entry point that serves the tools and resources registered by `createServer` over
MCP Streamable HTTP at `/mcp`. Each `POST /mcp` SHALL be handled statelessly by a server and transport created for
that request, so any instance can serve any request. An authorized `GET /mcp` or `DELETE /mcp` SHALL answer `405` with
an `Allow: POST` header, as the MCP specification permits for a server that offers no server-initiated stream; an
unauthorized one SHALL answer `401`, because bearer verification runs before the method check. The stdio entry point
SHALL keep its current behaviour and configuration.

#### Scenario: Authorized client lists the same tools as stdio

- **WHEN** an authorized client sends `initialize` and then `tools/list` to `POST /mcp`
- **THEN** the returned tool names equal the tool names `createServer` registers for a stdio client

#### Scenario: GET is refused without a stream

- **WHEN** an authorized client sends `GET /mcp`
- **THEN** the response is `405` with `Allow: POST`

#### Scenario: Unauthorized GET is challenged first

- **WHEN** a client sends `GET /mcp` with no `Authorization` header
- **THEN** the response is `401`, not `405`

#### Scenario: stdio unchanged

- **WHEN** helio-mcp is started through its existing stdio entry point with `HELIO_PAT` set
- **THEN** it behaves as before and its existing tests pass unmodified

# mcp-remote-http-transport Specification

## Purpose
Defines helio-mcp's Streamable HTTP `/mcp` endpoint: stateless per-request serving of the stdio tool set as the token's Helio user, request-size bounds, HTTP-mode configuration, and its Cloud Run deploy shape.

## Requirements

### Requirement: Streamable HTTP endpoint serves the same tool set

helio-mcp SHALL provide an HTTP entry point that serves the tools and resources registered by `createServer` over
MCP Streamable HTTP at `/mcp`. Each `POST /mcp` SHALL be handled statelessly by a server and transport created for
that request, so any instance can serve any request. `GET /mcp` and `DELETE /mcp` SHALL answer `405` with an `Allow`
header, as the MCP specification permits for a server that offers no server-initiated stream. The stdio entry point
SHALL keep its current behaviour and configuration.

#### Scenario: Authorized client lists the same tools as stdio

- **WHEN** an authorized client sends `initialize` and then `tools/list` to `POST /mcp`
- **THEN** the returned tool names equal the tool names `createServer` registers for a stdio client

#### Scenario: GET is refused without a stream

- **WHEN** an authorized client sends `GET /mcp`
- **THEN** the response is `405` with `Allow: POST`

#### Scenario: stdio unchanged

- **WHEN** helio-mcp is started through its existing stdio entry point with `HELIO_PAT` set
- **THEN** it behaves as before and its existing tests pass unmodified

### Requirement: Each request acts as the token's Helio user

Every Helio API call made while serving a `/mcp` request SHALL carry the PAT bound to that request's access token,
and no PAT SHALL be shared between requests or read from the process environment in HTTP mode. The per-tool-call
rate-limit wait budget and in-flight limits SHALL apply per request exactly as they do under stdio.

#### Scenario: Two users do not cross

- **WHEN** user A's and user B's tokens each call `list_dashboards` concurrently
- **THEN** each response contains only that user's dashboards

#### Scenario: create_content_panel acts as the signed-in user

- **WHEN** an authorized client calls `create_content_panel` with type `markdown` on a dashboard the user owns
- **THEN** the panel exists on that dashboard and the backend attributes the write to that user's PAT

### Requirement: Request size and logging bounds

`/mcp` SHALL accept authorized JSON request bodies up to 32 MiB, Cloud Run's HTTP/1 request cap, and answer `413`
above it; the stdio buffer stays 64 MiB. Bodies over 8 MiB, chunked bodies and bodies with a `Content-Encoding` other
than `identity` SHALL take one of a configured, measured number of large-body slots per instance before parsing,
and SHALL receive an immediate `429` with `Retry-After` when none is free. helio-mcp
SHALL NOT write any access token, authorization code, PAT, `Authorization` header or request body to its logs,
including from error stacks.

#### Scenario: Large-body slots exhausted

- **WHEN** every large-body slot is held and another authorized request over 8 MiB arrives
- **THEN** it receives `429` with `Retry-After` and its body is not parsed

#### Scenario: Small compressed body that inflates large

- **WHEN** an authorized client posts a small gzip body that inflates past 8 MiB while every slot is held
- **THEN** it receives `429` with `Retry-After` and is not inflated

#### Scenario: Oversized body

- **WHEN** an authorized client posts a body larger than 32 MiB to `/mcp`
- **THEN** the response is `413` and no tool runs

### Requirement: HTTP mode configuration fails fast

The HTTP entry point SHALL require `HELIO_MCP_PUBLIC_URL`, `HELIO_APP_URL`, `HELIO_API_BASE_URL` and
`HELIO_MCP_TOKEN_KEY` (base64 of exactly 32 bytes), SHALL validate its optional settings
(`HELIO_MCP_LIVENESS_TTL_SECONDS` an integer 1..3600, default 300), and SHALL exit non-zero with a message naming the missing or
invalid variable, without printing any secret value. It SHALL listen on `PORT` (default `8080`).

#### Scenario: Missing key

- **WHEN** the HTTP entry point starts without `HELIO_MCP_TOKEN_KEY`
- **THEN** it exits non-zero naming `HELIO_MCP_TOKEN_KEY`

### Requirement: Deployable as its own Cloud Run service

The repository SHALL contain a container build for helio-mcp's HTTP entry point and `infra/deploy-mcp.sh`, which
deploys a Cloud Run service named `helio-mcp` with unauthenticated invocation allowed, request-based billing,
`--min-instances=0`, an explicit `--max-instances`, a dedicated service account, and without `--no-cpu-throttling`, taking `HELIO_MCP_TOKEN_KEY` from Secret Manager and requiring
an explicit `--image=` like `infra/deploy-backend.sh`. Its memory, concurrency and large-body slot count SHALL be set
from a recorded measurement of peak memory for a maximum-size request. The documented connector URL SHALL be
`https://mcp.helioapp.dev/mcp`.

#### Scenario: Script refuses an implicit image

- **WHEN** `infra/deploy-mcp.sh` runs without `--image=`
- **THEN** it exits non-zero before invoking `gcloud`

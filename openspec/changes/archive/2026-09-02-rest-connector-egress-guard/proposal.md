## Why

An authenticated caller can make the backend issue arbitrary server-side HTTP requests. `RestApiConnectorDriver` issues
every REST fetch through `Http().singleRequest` with no destination validation and no pinned transport, and
`ConnectorEntityService` accepts any non-empty `baseUrl` — so `http://169.254.169.254/` (the Cloud Run instance-metadata
endpoint) is a storable, fetchable Connector today. A materially stronger guard already exists in
`ContentSourceSupport` and is used by text/PDF/image and CSV sources; the REST path simply never adopted it.

## What Changes

- Expose `ContentSourceSupport`'s existing validate-and-pin core as a public reusable seam (returning the validated
  `InetAddress`, plus the pinned `ClientTransport`), so a caller that must build its own request — as REST must, for
  method/headers/auth/body — reuses the same guard instead of writing a second one. No behavior change for existing
  callers.
- Guard both REST request-issuing choke points (`issueAndParse`, `issueTest`). These two methods are the sole exits for
  all four REST outbound entry points (`fetch`, `testConnection`, `fetchEphemeral`, `testConnectionEphemeral`), so a
  single guard there covers the resolved and ephemeral paths structurally.
- Reject 3xx explicitly on the REST path. Pekko's `StatusCode.isSuccess` is true for redirections, so today a redirect
  response body is parsed as if it were a 200 — the same trap `ContentSourceSupport` already documents and rejects.
- Validate `baseUrl` at Connector create and update, so a disallowed destination cannot be stored.
- Record a full enumeration of backend outbound-fetch sites, each shown guarded or explicitly justified.

## Capabilities

### New Capabilities
- `outbound-egress-guard`: the shared validate-and-pin seam, the invariant that every caller-influenced outbound fetch
  routes through it, and the recorded enumeration of outbound-fetch sites.

### Modified Capabilities
- `rest-api-connector`: REST fetches reject disallowed destinations and redirect responses.
- `connectors/connector-management`: `baseUrl` is validated against the egress policy at create and update.
- `connection-test-endpoint`: `POST /api/sources/infer` and `POST /api/sources/test` reject disallowed destinations.

## Non-goals

- Changing `ContentSourceSupport`'s denylist, size cap, or scheme policy — the seam is exposed, not rewritten.
- SQL connector egress policy. `SqlConnectorDriver` builds a JDBC URL from a caller-supplied host and is a genuine
  adjacent exposure, but it is a different protocol, a different client, and no part of this ticket's fix applies to it.
  It is enumerated and justified here, and carried as a follow-up rather than fixed in this diff.
- Data migration or deletion of existing rows that would now fail validation.
- Any deploy, tag, or production database access.

## Impact

- Backend: `ContentSourceSupport`, `RestApiConnectorDriver`, `ConnectorEntityService`, `ApiRoutes` (test seam wiring).
- APIs: `POST/PATCH /api/connectors` gains a 400-class rejection for a disallowed `baseUrl`. `POST /api/sources/infer`
  and every REST source refresh/preview/pipeline-run fetch report a refusal on their existing 502-class fetch-failure
  channel, with the disallowed address named in the message; `POST /api/sources/test` reports it as it already reports
  any failed test, 200 with `ok = false`. See design.md Decision 8 for why the status is not specialised here.
- No schema migration, no frontend change, no new dependency.

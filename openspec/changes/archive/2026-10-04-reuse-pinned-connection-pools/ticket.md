# HEL-1254: REST connector and fetchUrl build a new ClientTransport and connection pool per request (pool-per-request churn)

## Description

origin_kind: followup
origin_ticket: HEL-1245

Found while probing HEL-1245 (probe-confirmed locally, not the cause of that incident).

`ContentSourceSupport.pinnedPoolSettings` builds a new `ClientTransport.withCustomResolver(...)` and
`ConnectionPoolSettings` on every call. `RestApiConnectorDriver.issueAndParse`/`issueTest` (via `guardedPoolSettings`)
and `ContentSourceSupport.fetchUrl` therefore get a brand-new, never-reused Pekko pool and a fresh TCP connection per
request. Probe: 10 sequential requests produced 10 server-side connections, all succeeding. The other `singleRequest`
callers (HttpResendEmailSender, HttpClaudeTransport) share one settings object and do not have this.

Suggested direction (a claim, verify): cache pinned `ConnectionPoolSettings` per `InetAddress` so pools/connections are
reused with pinning/SSRF behaviour unchanged; and/or consume the entity in the same stream stage as the response so
subscription cannot be delayed by a Future hop. Needs its own probe and design; must keep the DNS-rebinding pinning
guarantee (HEL-215/879).

Not urgent: HEL-1245's root cause was Cloud Run CPU throttling.

## Acceptance Criteria (derived from the ticket + driver dispatch; driver statements are claims to verify)

- AC1: Sequential outbound requests through the pinned path (REST connector `issueAndParse`/`issueTest`, and
  `ContentSourceSupport.fetchUrl`, which also serves `CsvUrlFetch` and the text/pdf/image URL paths) reuse a pool and
  its connections instead of building a new pool per request. Measured red-before-fix (server-side connection count
  under N sequential requests), green after.
- AC2: The DNS-rebinding pinning guarantee (outbound-egress-guard spec, "The connection is pinned to the validated
  address") still holds: re-resolving a host to a different address can never reuse a connection/pool pinned to the
  previously validated address, and no connection is ever made to an address that was not validated for that request.
  Proven by a test that goes red under a mutation that keys the pool by hostname (or otherwise unpins it).
- AC3: The SSRF / private-address check is unchanged and still runs before every request (no validation caching).
- AC4: design.md states whether pool-per-request has any bearing on "Response entity was not subscribed" timeouts
  (HEL-1245), without re-attributing HEL-1245 to pooling absent evidence.

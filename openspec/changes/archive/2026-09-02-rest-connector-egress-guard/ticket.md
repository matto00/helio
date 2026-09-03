# HEL-879: SSRF: REST connector fetches caller-supplied URLs with no egress guard

## Description

Found by HEL-862's design gate while tracing an assumption written into that ticket — that the REST connector already
had an egress policy CSV could reuse. It does not. Filed separately because folding a security fix into HEL-862's diff
would blow its scope, and this deserves its own review.

**This is a live, pre-existing hole, not a regression introduced by the HEL-857 epic.** It is filed Urgent because it is
reachable by an authenticated caller today and the epic is beta-readiness work.

### The gap

The REST path performs server-side fetches of caller-supplied URLs with no destination validation:

- `RestApiConnectorDriver.buildResolvedRequest` builds `Uri(joinUrl(baseUrl, endpoint))` and hands it to
  `Http().singleRequest`. Pool settings configure connect/idle timeouts only — no `ClientTransport` — so Pekko resolves
  DNS itself and connects wherever the name points.
- `buildEphemeralRequest` (line 367 on this branch; the ticket said ~374) does `HttpRequest(uri = Uri(config.url))` with
  a **bare caller-supplied URL**. This serves `POST /api/sources/infer` and `POST /api/sources/test`.
- `ConnectorEntityService` validates only `baseUrl.isEmpty`, so a Connector can be created with
  `baseUrl = http://169.254.169.254/` — the cloud instance-metadata endpoint.

The backend runs on Cloud Run, so the metadata service and any internal-only endpoint reachable from the service's
network are in scope for an authenticated caller.

### What already exists, and should be reused

`backend/src/main/scala/com/helio/services/sources/ContentSourceSupport.scala` is a materially stronger guard, already
used by `text`/`pdf`/`image` URL sources via `DataSourceService` and by `csv` via `CsvUrlFetch`:

- rejects non-`http(s)` schemes, and missing or unresolvable hosts
- rejects loopback, link-local (including `169.254.0.0/16`), RFC1918, site-local, unique-local IPv6, any-local and
  multicast
- **pins the TCP connection to the already-validated `InetAddress`** — an explicit DNS-rebinding TOCTOU fix added by a
  cold-skeptic review under HEL-215
- rejects non-2xx (so a 3xx redirect to an internal address is never followed), and caps the body at 100 MiB

The fix is to route the REST path through this guard, not to write a second one. The rebinding pin in particular is the
difference between a guard that works and one that only appears to.

### Scope

- Route every REST outbound fetch — resolved-request and ephemeral-request paths both — through `ContentSourceSupport`'s
  validation.
- Validate `baseUrl` at Connector creation and update, not only at fetch time, so a bad value cannot be stored.
- **Enumerate every outbound-fetch site in the backend** rather than fixing the three named here. This ticket exists
  because an outbound fetcher was assumed to be guarded and was not; assume there are others until enumeration proves
  otherwise. SQL and any connector added since should be checked explicitly.
- Assess stored data: identify any existing Connector or source whose URL would now be rejected, and decide deliberately
  what happens to it.
- Redirect handling must be explicit — a guard that validates the first hop and follows redirects is not a guard.

## Acceptance criteria

- [ ] A Connector cannot be created or updated with a `baseUrl` resolving to loopback, link-local, or private address
      space; rejection is tested for each class, not just one representative.
- [ ] `POST /api/sources/infer` and `POST /api/sources/test` reject the same address classes with a clear error.
- [ ] A DNS name that resolves to an internal address is rejected, and the connection is pinned so it cannot be
      re-resolved between validation and connect.
- [ ] A redirect to an internal address is not followed.
- [ ] The enumeration of outbound-fetch sites is recorded in the PR, with each site shown to be guarded or explicitly
      justified.
- [ ] Existing stored Connectors and sources are assessed against the new validation and the disposition of any that
      fail is stated.
- [ ] Legitimate external URLs continue to work — verified against the live Sleeper endpoint the epic uses.

## Related

HEL-862 (found this), HEL-215 (added the DNS-rebinding pin to `ContentSourceSupport`), HEL-857 (epic).

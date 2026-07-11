# Orchestrator follow-up — SSRF gap in URL-based ingestion (post-cycle-1)

Independently verified by reading `backend/src/main/scala/com/helio/services/ContentSourceSupport.scala`
after evaluator cycle 1 PASSed. This was missed by all three design-gate skeptic rounds (which focused
on route-dispatch/entity-materialization safety, not the URL-fetch feature's request-forgery surface)
and by evaluator cycle 1 (which focused on spec conformance, code quality, and UI, per its brief — none
of which named SSRF explicitly). This is a real defect in code already written for this ticket's
"URL-based ingestion" requirement (proposal.md/spec.md), not new scope.

## Confirmed issue

`ContentSourceSupport.fetchUrl(url: String)` (lines 63-84) builds `HttpRequest(uri = url)` from a
caller-supplied string and issues it via `Http(...).singleRequest(...)` with **no validation** of
scheme, host, or resolved IP address. Because this is reachable from `POST /api/data-sources` (any
authenticated user can supply an arbitrary `config.url`), and the backend runs on GCP Cloud Run in
production, this is a server-side request forgery vector: a caller can point ingestion at
`http://169.254.169.254/computeMetadata/v1/...` (the GCP metadata service) to attempt to exfiltrate the
backend's service-account credentials, or at RFC1918/loopback addresses to reach internal-only services.

Additionally, the failure branch (`Left(s"HTTP ${status}: ${entity.data.utf8String}")`) returns the
full upstream response body back to the API caller — an information-leak on top of the SSRF surface
(an attacker probing internal endpoints via this path gets the internal response content reflected back).

## Required for this cycle

1. **Validate the URL before requesting.** Reject non-`http`/`https` schemes. Resolve the host (e.g.
   `InetAddress.getAllByName`) and reject if any resolved address is loopback, link-local (including
   `169.254.0.0/16`), private (RFC1918), unique-local IPv6, any-local, or multicast. Reject on DNS
   resolution failure too, rather than silently proceeding.
2. **Redirects.** Either disable auto-redirect-following on the request/pool settings, or re-validate
   each redirect target's resolved address against the same denylist before following it (a permitted
   host can 3xx to an internal address — validating only the original URL is a TOCTOU gap).
3. **Stop echoing the upstream body in errors.** Replace the current error message with a generic
   `Left(s"Upstream returned HTTP ${response.status.intValue()}")` — do not include `entity.data.utf8String`.
4. **Tests.** Cover: blocked schemes, blocked address ranges (at minimum `127.0.0.1`, `169.254.169.254`,
   a `10.x`/`192.168.x` address, `::1`) all rejected before any request is issued; a normal
   (mocked/local-test-server) public-style URL still succeeds; redirect-to-internal is blocked.
5. **Keep this in `ContentSourceSupport`** (not connector-specific) — HEL-214/HEL-216 will also do
   URL-based ingestion and must reuse the same guard. Note this explicitly as an addition to the
   "Reusable seam #2 — URL fetch-and-store" decision already in `design.md`.

Everything else from cycle 1 (ADT closure points, pipeline row-loading, route-dispatch safety,
`PayloadTooLarge`/413) was independently re-verified by evaluator cycle 1 and does not need rework.

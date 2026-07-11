## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth re-established**
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/text-file-connector/spec.md`,
  `orchestrator-security-followup.md`, `files-modified.md` (treated `evaluation-1.md`/`evaluation-2.md`
  as claims only, per brief).
- `git log --oneline`: confirmed `1e748ed` (cycle 1) and `d108f12` (cycle-2 SSRF fix) are on top of
  `6ea75a1` (HEL-217, prerequisite).
- Read the actual current `ContentSourceSupport.scala`, `DataSourceService.scala`, `ApiRoutes.scala`,
  `Main.scala`, `ContentSourceSupportSpec.scala` in full (not summaries).

**Acceptance criteria traced**
- File upload creates a `"text"` source: verified live, `POST /api/data-sources` (multipart,
  `type=text`) → `201 {"config":{"path":"text/155da971....md"},...,"type":"text"}`.
- URL ingestion creates a `"text"` source: verified live against a real public URL
  (`https://raw.githubusercontent.com/github/gitignore/main/README.md`) → `201` with `sourceUrl`
  recorded in `config`.
- Content stored via `StringBodyType`: confirmed in the running UI's "Inferred schema" panel —
  `content: string-body`, `filename: string`, `sizeBytes: integer`, all `nullable: no`.
- Pipeline-bindable, single-row `{content, filename, sizeBytes}` shape: created a pipeline against
  each of the two sources above and ran both — `POST /api/pipelines/:id/run` returned `rowCount: 1`
  with exactly those three keys for both the uploaded file and the URL-fetched file.
- `.txt`/`.md` accepted: `ContentSourceSupport.TextExtensions = Set("txt", "md")`, enforced by
  `validateExtension`, unit-tested in `ContentSourceSupportSpec`.
- Reusable connector seam: `ContentSourceSupport.metadataFields`/`fetchUrl`/`validateExtension` are
  content-type-agnostic (parameterized on `DataFieldType`), matches `design.md`'s documented seams.

**Gates re-run myself**
- `sbt testOnly com.helio.services.ContentSourceSupportSpec com.helio.services.DataSourceServiceSpec com.helio.api.DataSourceRoutesSpec com.helio.domain.InProcessPipelineEngineSpec com.helio.domain.DataSourceSpec com.helio.api.protocols.DataSourceProtocolSpec` → **160/160 passed**, 0 failures (fresh run, this session).
- `scripts/concertino/assert-phase.sh servers` → `PASS` (backend process confirmed started *after*
  the `d108f12` commit timestamp — not a stale process).
- Live SSRF probes via `POST /api/data-sources` (authenticated, fresh dev server):
  - `http://169.254.169.254/computeMetadata/v1/` → `502` `"URL host '169.254.169.254' resolves to a disallowed address"`, no data source created.
  - `http://127.0.0.1:8295/health` → `502` `"URL host '127.0.0.1' resolves to a disallowed address"`.
  - `file:///etc/passwd` → `502` `"Unsupported URL scheme: file..."`.
  - Confirmed via `GET /api/data-sources` that none of the three probes created a row.
- UI/design judgment: screenshotted `TextSourceForm` (upload and URL sub-modes) in both dark and
  light themes. Token usage, spacing, and toggle-group styling are consistent with sibling
  `CsvForm`/`RestApiForm` patterns (shared `SourceTypeToggle`, same modal chrome); no hardcoded
  colors observed; light/dark parity holds; 0 console errors.

### A genuine, unaddressed SSRF bypass: DNS-rebinding TOCTOU between validation and connection

This is exactly the class of bypass the orchestrator's brief asked me to check for
("DNS rebinding between validation and request"), and it is real and unmitigated.

`ContentSourceSupport.fetchUrl` (`backend/src/main/scala/com/helio/services/ContentSourceSupport.scala:138-177`)
does:

```scala
validateUrl(url, resolveHost) match {          // line 145 — resolves `host` via `resolveHost`
  case Left(err) => Future.successful(Left(err))
  case Right(()) =>
    ...
    Http(system.classicSystem)
      .singleRequest(HttpRequest(uri = url), settings = poolSettings)   // line 157 — re-resolves the SAME hostname independently
```

`validateUrl` resolves the hostname via the injected/`defaultResolveHost` function purely to make a
policy decision. The address(es) it obtains are **discarded** — the subsequent
`Http().singleRequest(HttpRequest(uri = url), ...)` call passes the original URL string, and Pekko
HTTP performs its **own, independent** DNS resolution of the same hostname when it opens the TCP
connection. Nothing pins the actual connection to the address that was validated.

This means a caller who controls DNS for a hostname (e.g. `attacker.example` with TTL=0, or any
"rebinding" DNS provider) can pass validation with a first resolution to a public/permitted IP, then
have the *second*, independent resolution performed by Pekko's connection layer a few hundred
milliseconds later return `169.254.169.254` (or any RFC1918/loopback address) — a classic DNS-rebinding
SSRF bypass. All the address-range checks in `isBlockedAddress` are irrelevant if the attacker can make
the two resolutions disagree.

**This is not a hypothetical — the codebase's own test proves the decoupling.**
`ContentSourceSupportSpec.scala:64-66` defines:
```scala
private def permissiveResolver(host: String) =
  if (host == "localhost") Success(Array(InetAddress.getByName("93.184.216.34")))  // a PUBLIC address
  else ContentSourceSupport.defaultResolveHost(host)
```
and the `"succeed against a permitted (test-injected) host"` test (line 204-207) calls
`fetchUrl(urlFor("ok.txt"), permissiveResolver)` and asserts the fetch **succeeds**, returning the
local test server's real content. The only way this test can pass is if `validateUrl` is told
`"localhost"` resolves to `93.184.216.34` (allowed) while the *actual* connection Pekko opens for
`"localhost"` resolves — via the JVM's real, un-overridden resolver — to `127.0.0.1`, where the test
server is actually listening. I.e., the test itself demonstrates that the validated address and the
connected-to address are two independent resolutions of the same hostname, and the guard's decision
has zero bearing on where the real TCP connection lands. Substitute an attacker-controlled
rebinding domain for `"localhost"` and the same mechanism defeats the guard against
`169.254.169.254`/loopback/RFC1918 in production.

I also independently checked the more "exotic" bypasses named in the brief and found them **not**
exploitable (Java's `InetAddress` resolution is consistent between the validation call and what a
correctly-pinned connection would use, so these are moot once the rebinding gap above is fixed, but
recorded for completeness):
- IPv4-mapped IPv6 (`[::ffff:169.254.169.254]`) → resolves to an `Inet6Address` with
  `isLinkLocalAddress = true` — correctly blocked.
- Decimal IP literal (`http://2130706433/`) → `InetAddress.getAllByName` resolves it to `127.0.0.1`,
  `isLoopbackAddress = true` — correctly blocked.
- Hex/octal literal hostnames (`0x7f000001`, `017700000001`) → `UnknownHostException` under Java's
  resolver (not interpreted as those bases) → rejected via the "could not resolve host" branch.
- Bare (unbracketed) IPv6 literal as URL host → `URI.getHost()` returns `null` → rejected via
  "missing a host".

The redirect-to-internal-address handling (task 8.2) is genuinely closed: confirmed Pekko HTTP's
`Http().singleRequest` does not auto-follow 3xx (verified via the `ContentSourceSupportSpec` redirect
test, which shows the redirect's `Location` is never dereferenced), and the `isSuccess()` → explicit
2xx-range fix is correctly probe-documented in `files-modified.md` and present in the code
(`ContentSourceSupport.scala:170-172`).

The `resolveHost` test-injection parameter is genuinely unreachable from any externally-callable path
with attacker-controlled input: `Main.scala` constructs `ApiRoutes` without the
`dataSourceUrlResolveHost` parameter (confirmed by `grep` — no match in `Main.scala`), so production
always uses `ContentSourceSupport.defaultResolveHost` (real DNS). This is not the source of the bug —
the bug exists even with the real-DNS default, because `validateUrl` and the connection each call DNS
resolution independently and nothing forces them to agree.

### Verdict: REFUTE

### Change Requests

1. **Close the DNS-rebinding TOCTOU in `ContentSourceSupport.fetchUrl`**
   (`backend/src/main/scala/com/helio/services/ContentSourceSupport.scala:138-177`). Validating a
   hostname's resolved address and then issuing the request against the *hostname string again* (a
   second, independent resolution) does not prevent SSRF — it only prevents SSRF against hosts whose
   DNS answer doesn't change between the two lookups. Pin the actual connection to the address(es)
   that were validated, e.g.:
   - Resolve the host once (already done in `validateUrl`), pass the validated `InetAddress` through
     to the request path, and use Pekko HTTP's `ClientTransport.connectTo(...)` (or an equivalent
     custom `ConnectionPoolSettings.withTransport(...)`) to force the TCP connection to that specific
     IP, while still sending the original hostname as the `Host` header (and for TLS SNI, if `https`).
   - Add a regression test that models rebinding directly: inject a `resolveHost` that returns a
     public address on the first call, and have the (fake) transport/connection layer attempt to
     connect to a *different* (blocked) address on the actual request — assert the request is
     rejected rather than silently succeeding. The existing `permissiveResolver` test in
     `ContentSourceSupportSpec.scala:64-66,204-207` should be re-examined once the fix lands: it
     currently passes because of this exact gap (see report body above) — after the fix, either the
     test needs a real pinned-connection mechanism to stay green, or it needs restructuring so it no
     longer relies on the hostname resolving differently for validation vs. connection.
   - This is squarely in the code path the ticket flagged as reusable for HEL-214/HEL-216
     ("Reusable seam #2"), so the fix belongs in `ContentSourceSupport`, not per-connector.

### Non-blocking notes

- UI (`TextSourceForm`, `SourceTypeToggle` "Text/Markdown" entry, `AddSourceModal` text branch)
  matches sibling connector forms and design tokens in both themes — no notes.
- Error-message wording (`"URL host '...' resolves to a disallowed address"`) is appropriately generic
  and does not leak internal topology beyond confirming the host was resolved and blocked — fine as is.
- Everything else claimed in `files-modified.md`'s cycle-2 section (redirect handling, error-body
  leak fix, `resolveHost` non-overridability in prod, address-range coverage for the *originally
  requested* host) checked out under independent re-verification.

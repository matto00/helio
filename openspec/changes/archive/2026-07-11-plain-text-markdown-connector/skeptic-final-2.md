## Skeptic Report — final gate (round 2)

### What I verified (with evidence)

**Ground truth re-established (cold, not trusting prior reports)**
- Read `design.md` (cycle-3 addendum), `tasks.md` (task group 9), `files-modified.md` (cycle-3
  section), and `skeptic-final-1.md` fresh from disk.
- `git diff d108f12 d9c1559 --stat` and full diffs of `ContentSourceSupport.scala`,
  `DataSourceService.scala`, `ApiRoutes.scala`, `ContentSourceSupportSpec.scala`,
  `DataSourceServiceSpec.scala`, `DataSourceRoutesSpec.scala` — read in full, not summarized.
- Read the actual current `ContentSourceSupport.scala` (267 lines) end-to-end, including the new
  `resolveValidated`, `pinnedTransport`, and updated `fetchUrl`.

**1. Pinning mechanism verified against Pekko HTTP's own source (not just the executor's doc comments)**
- Downloaded and read `pekko-http-core_2.13-1.1.0-sources.jar`'s `ClientTransport.scala`:
  `ClientTransport.TCP`'s doc comment confirms the default deliberately builds an *unresolved*
  `InetSocketAddress` so "DNS resolution is performed for every new connection" — exactly the
  independent-resolution behavior the cycle-3 fix defeats. `withCustomResolver`'s
  `ClientTransportWithCustomResolver.connectTo` calls the injected `lookup(host, port)` and passes
  its result straight to `connectToAddress` (`Tcp().outgoingConnection`) — since
  `pinnedTransport` always returns `Future.successful(new InetSocketAddress(pinnedAddress, port))`
  (an already-resolved address), no further DNS lookup occurs; the real TCP connection is forced to
  exactly the validated `InetAddress`, for both `Inet4Address` and `Inet6Address` (the constructor is
  family-agnostic).
- Read `Http.scala:476-499` (`_outgoingConnection`/`_outgoingTlsConnectionLayer`): the TLS stage
  (`sslTlsClientStage(connectionContext, host, port)`, which drives SNI/hostname verification) and the
  `Host` header (`hostHeader = Host(host, ...)`) are both built from the plain `host` string derived
  from the request's URI — completely independent of `settings.transport.connectTo(host, port,
  settings)`, which is the only thing the custom transport overrides. This confirms the design.md/code
  comment claim that Host header and TLS SNI are unaffected by the pin — verified from the library's
  own source, not asserted.
- No other network-reaching code path exists in `fetchUrl`: the single `Http(...).singleRequest(...,
  settings = poolSettings)` call is the only place a connection is opened, and `poolSettings` always
  carries `.withTransport(pinnedTransport(pinnedAddress))` on the success branch; the failure branch
  (`Left(err)`) never reaches the network at all.
- Multiple-address resolution (brief's concern #5): `resolveValidated` rejects if **any** resolved
  address is blocked (`addresses.exists(a => isBlocked(host, a)) => Left(...)`), only then pins to
  `addresses.head` — since every returned address was individually checked before any pin decision is
  made, picking `.head` is safe by construction; there's no way for an attacker to hide a blocked
  address behind a permitted one in a multi-A-record response.

**2. Regression test verified — read it myself, not the report's summary**
- `ContentSourceSupportSpec.scala:275-292` ("pin the real TCP connection..."): uses
  `rebind-test.invalid` as the un-resolvable hostname. `.invalid` is an RFC 2606-reserved TLD
  specifically guaranteed to never resolve in any environment (not an accidental choice that could
  become resolvable) — this is a sound, non-flaky choice, not "happens to not resolve today."
  `rebindingResolver` maps this literal hostname to `localhost`'s real address (this suite's own test
  server); `admitRebindHost` admits it past the denylist. Traced the mechanism against the Pekko source
  above: if `.withTransport(...)` were absent, the pool would independently re-resolve
  `rebind-test.invalid` at connect time and get `UnknownHostException` (matches the `files-modified.md`
  probe-output claim); with it present, the connection is forced to the already-resolved loopback
  address and the fetch succeeds. `resolveCallCount shouldBe 1` is also correct — `pinnedTransport`'s
  closure never calls `resolveHost` again. This test has genuine discriminating power, not a tautology.

**3. Host header / TLS SNI claim — verified two ways**
- Statically, via the Pekko source trace above (independent code paths).
- Live, dynamically: with a freshly-restarted backend built from `d9c1559` (see below), issued
  `POST /api/data-sources` with `type: text`, `config.url:
  https://raw.githubusercontent.com/github/gitignore/main/README.md` → `201`, source created
  successfully. This is a real HTTPS fetch through the pinned-transport code path; if SNI/hostname
  verification had silently changed to the raw IP, TLS handshake/hostname verification against
  GitHub's certificate would fail (Pekko's default `HttpsConnectionContext` verifies the peer
  hostname). Success here is corroborating live evidence the SNI/Host-header claim holds, not just a
  reading of the source.

**4. Previously-verified SSRF protections re-confirmed intact, live, against fresh code**
- Discovered the backend process serving port 8295 predated the `d9c1559` commit (started 13:00:12,
  commit at 13:27:57) — killed and restarted it via `scripts/concertino/start-servers.sh`, confirmed
  `assert-phase.sh servers` → `PASS` and the new process (13:32:10) postdates the commit, before
  trusting any live probe.
- Re-probed via authenticated `POST /api/data-sources` (type=text, URL config):
  - `http://169.254.169.254/computeMetadata/v1/` → `502` "resolves to a disallowed address"
  - `http://127.0.0.1:8295/health` → `502` "resolves to a disallowed address"
  - `file:///etc/passwd` → `502` "Unsupported URL scheme: file..."
  - `http://[::1]:8295/health` → `502` "resolves to a disallowed address"
  - `http://0x7f000001/` → `502` "Could not resolve host..."
  - `GET /api/data-sources` afterward confirmed none of the five probes created a row (deleted my own
    legitimate positive-path probe afterward for cleanliness).

**5. Test suite, re-run fresh myself**
- `sbt "testOnly ...ContentSourceSupportSpec ...DataSourceServiceSpec ...DataSourceRoutesSpec"` →
  78/78 passed.
- `sbt "testOnly"` on the same six suites the round-1 report cited → 161/161 passed (was 160 in round
  1; +1 matches the new regression test).
- Full `sbt test` → **1094/1094 passed**, exactly matching the count `files-modified.md` claims for
  the cycle-3 fix ("Full backend suite re-run afterward (1094 tests) passed with 0 failures").

**6. Cross-checked `files-modified.md`/`tasks.md` claims against the actual diff**
- `git diff d108f12 d9c1559` for `ApiRoutes.scala`/`DataSourceService.scala`: confirmed the new
  `dataSourceUrlIsBlocked`/`isBlocked` constructor parameters exist exactly as documented, default to
  the host-agnostic `isBlockedAddress`, and `Main.scala` does not override either the resolver or the
  new `isBlocked` parameter (`grep` — no match) — production always uses the strict, real-DNS,
  real-denylist defaults.
- Test-file diffs (`ContentSourceSupportSpec`, `DataSourceServiceSpec`, `DataSourceRoutesSpec`) match
  the claimed "lying resolver → hostname-keyed isBlocked" restructuring exactly, file-by-file.

### No remaining bypass found

I looked specifically for: redirect/connection-reuse paths that could re-resolve (none — the custom
transport is baked into the pool settings for the entire request, and redirects are still never
auto-followed, unchanged from cycle 2); IPv4-vs-IPv6 handling in the pin (family-agnostic
`InetSocketAddress` constructor); multiple-A-record bypass (blocked if *any* address is disallowed,
before picking one to pin to); and any code path in `fetchUrl` that reaches the network without going
through `poolSettings`/`pinnedTransport` (there is none). All are sound.

### Verdict: CONFIRM

### Non-blocking notes

- Each `fetchUrl` call builds a fresh `ConnectionPoolSettings` with a new transport closure
  (referentially distinct per call), so Pekko's pool cache likely treats each call as a distinct pool
  (no connection reuse across separate `fetchUrl` invocations to the same host). This is a minor
  efficiency point, not a correctness or security issue, and was already effectively true pre-fix
  (`poolSettings` was rebuilt per call before cycle 3 too).
- The dev backend process on port 8295 was stale (predated this round's commit) when I started
  verification — I restarted it and re-confirmed `assert-phase.sh` before trusting any live probe.
  Worth a reminder in the orchestrator's server-lifecycle handling for future rounds so this doesn't
  silently mask a regression.

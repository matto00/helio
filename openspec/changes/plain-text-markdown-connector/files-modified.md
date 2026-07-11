# Files Modified — HEL-215 plain-text-markdown-connector

## Backend: domain + persistence

- `backend/src/main/scala/com/helio/domain/DataSource.scala` — added `TextSourceConfig`/`TextSource` case classes and `DataSourceKind.Text`.
- `backend/src/main/resources/db/migration/V47__add_text_source_type.sql` — new Flyway migration extending `data_sources_source_type_check` to allow `'text'`.
- `backend/src/main/scala/com/helio/api/protocols/DataSourceConfigCodec.scala` — added `decodeText`/`encodeText` for `TextSourceConfig`.
- `backend/src/main/scala/com/helio/infrastructure/DataSourceRepository.scala` — wired `TextSource` into `rowToDomain`/`domainToRow`/`update`'s closed matches.
- `backend/src/main/scala/com/helio/services/ServiceError.scala` — added `PayloadTooLarge` variant for the 413 path.
- `backend/src/main/scala/com/helio/api/routes/ServiceResponse.scala` — wired `PayloadTooLarge` to `StatusCodes.RequestEntityTooLarge`.

## Backend: content connector shared helpers

- `backend/src/main/scala/com/helio/services/ContentSourceSupport.scala` — new file: `metadataFields` (reusable `{content, filename, sizeBytes}` builder for HEL-214/HEL-216), `fetchUrl` (raw-bytes URL fetch), `validateExtension`, `filenameFromUrl`.

## Backend: service + wire protocol

- `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala` — added `TextSourceConfigPayload`, `TextSourceUrlConfigPayload`, `TextSourceUrlRequest`, `TextSourceResponse`; extended the `DataSourceResponse` discriminated-union format for `type = "text"`.
- `backend/src/main/scala/com/helio/api/package.scala` — re-exported the new protocol types (`com.helio.api` package object mirrors `com.helio.api.protocols`).
- `backend/src/main/scala/com/helio/services/DataSourceService.scala` — added `createTextUpload`/`createTextUrl`/private `ingestText`; added `TextSource` cases to `update`/`delete`/`refresh` (new `refreshText`/`finishTextRefresh` helpers); added `TEXT_MAX_FILE_SIZE_BYTES` env-driven max.

## Backend: routes

- `backend/src/main/scala/com/helio/api/routes/DataSourceRoutes.scala` — replaced `createCsvRoute` with `createMultipartUploadRoute` (single route, branches internally on `type` part); replaced `createStaticRoute`'s `entity(as[StaticDataSourceRequest])` with `entity(as[JsValue])` + discriminator dispatch to Static or `TextSourceUrlRequest`.

## Backend: pipeline row-loading

- `backend/src/main/scala/com/helio/domain/InProcessPipelineEngine.scala` — added `case t: TextSource` to `loadRows` (single-row loader) + `loadTextRowFromBytes` helper.

## Frontend

- `frontend/src/features/sources/types/dataSource.ts` — added `"text"` to `DataSourceKind`, `TextSourceConfig`/`TextSource` types, `isTextSource` guard.
- `frontend/src/features/sources/services/dataSourceService.ts` — added `createTextSourceUpload`/`createTextSourceUrl`.
- `frontend/src/features/sources/ui/TextSourceForm.tsx` — new file: upload/URL sub-mode form (mirrors `CsvForm.tsx`/`RestApiForm.tsx`).
- `frontend/src/features/sources/ui/SourceTypeToggle.tsx` — added `"text"` toggle entry ("Text/Markdown").
- `frontend/src/features/sources/ui/AddSourceModal.tsx` — added `"text"` `SourceType` branch (self-contained form/footer, mirrors Static/SQL) and `handleCreateText`.
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx` — added `"text"` case to `labelForKind` (exhaustive-switch fix from widening `DataSourceKind`).
- `frontend/src/features/pipelines/ui/BoundSourceBar.tsx` — same `labelForKind` exhaustive-switch fix.

## Tests

- `backend/src/test/scala/com/helio/domain/DataSourceSpec.scala` — `TextSource` kind + exhaustive-match coverage.
- `backend/src/test/scala/com/helio/api/protocols/DataSourceProtocolSpec.scala` — `TextSourceResponse` round-trip + `TextSourceConfig` codec round-trip tests.
- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — `TextSource` `loadRows` tests (single row, missing-path diagnostic).
- `backend/src/test/scala/com/helio/services/ContentSourceSupportSpec.scala` — new file: `metadataFields`/`validateExtension`/`filenameFromUrl` unit tests.
- `backend/src/test/scala/com/helio/services/DataSourceServiceSpec.scala` — `createTextUpload`/`createTextUrl`/refresh/delete/update coverage (extension, size, UTF-8, BadGateway, PayloadTooLarge); added a local Pekko HTTP test server for URL-ingestion scenarios.
- `backend/src/test/scala/com/helio/api/DataSourceRoutesSpec.scala` — multipart `type=text` upload, JSON URL creation, and CSV/explicit-`type=csv` regression coverage; added a local Pekko HTTP test server.
- `frontend/src/features/sources/ui/TextSourceForm.test.tsx` — new file: upload/URL sub-mode unit tests.
- `frontend/src/features/sources/ui/AddSourceModal.test.tsx` — new file: text-source create flow (upload + URL) integration tests.

## Root-cause bug fixed during implementation (cycle 1)

- **Root cause:** `ContentSourceSupport.fetchUrl`'s `response.entity.toStrict(30.seconds)` (no explicit byte limit) defaults to the actor system's `pekko.http.parsing.max-to-strict-bytes` (8 MiB) — a different config key from `max-content-length` (which is `infinite` on the client side by default and doesn't gate `toStrict`). This caused any URL-ingested content between 8–10 MB to surface as a generic `BadGateway` instead of the intended `ServiceError.PayloadTooLarge`.
- **Probe:** isolated `ProbeSpec` (throwaway, not committed) binding a local Pekko HTTP server serving 10,485,761 bytes and calling `ContentSourceSupport.fetchUrl` directly, with/without the fix.
- **Probe output (before fix):** `Left(Request failed: Request too large: Request of size 10485761 was longer than the maximum of 8388608)` — confirmed the 8 MiB `max-to-strict-bytes` default was the active limiter, not our per-connector `TEXT_MAX_FILE_SIZE_BYTES` check.
- **Fix:** pass an explicit `maxBytes` argument to the `toStrict(timeout, maxBytes)` overload (`fetchSizeLimitBytes = 104857600L`, 100 MiB), bypassing the config-driven default so the per-connector service-layer check is what actually enforces the 10 MB user-facing limit.
- **Probe output (after fix):** `Right(10485761)` — confirmed fixed; full test suite (`DataSourceServiceSpec`/`DataSourceRoutesSpec`) subsequently passed with 0 failures.

## Cycle 2: SSRF guard fix (orchestrator follow-up, post-evaluator-1 PASS)

The orchestrator independently found that `ContentSourceSupport.fetchUrl` issued a
caller-supplied URL fetch with zero scheme/host/address validation — a server-side
request forgery (SSRF) vector reachable via `POST /api/data-sources`'s text-connector
URL ingestion, notable because prod runs on GCP Cloud Run (unvalidated fetch = a path
to the `169.254.169.254` cloud metadata service). See
`openspec/changes/plain-text-markdown-connector/orchestrator-security-followup.md` for
the full write-up and `design.md`'s updated "Reusable seam #2" decision.

- `backend/src/main/scala/com/helio/services/ContentSourceSupport.scala` — added the SSRF guard: `isBlockedAddress` (loopback/link-local incl. `169.254.0.0/16`/RFC1918-private/unique-local-IPv6 `fc00::/7`/any-local/multicast), `validateUrl` (scheme + host-resolution + denylist check, run before any request is issued), `defaultResolveHost` (public, real-DNS default). `fetchUrl` now takes an optional `resolveHost` param (defaults to `defaultResolveHost`) and calls `validateUrl` first. Also replaced the leaked-upstream-body error message with a generic `Upstream returned HTTP <status>`, and fixed a related root-cause bug (see below): the success/failure branch now checks the response is strictly in the 2xx range instead of relying on Pekko HTTP's `StatusCode.isSuccess` (which is `true` for 3xx too), so a redirect response's body is never mistaken for successfully-fetched content. Also fixed a pre-existing inline-FQN violation in `filenameFromUrl` (now uses the `Try`/`URI` imports added for the guard).
- `backend/src/main/scala/com/helio/services/DataSourceService.scala` — added an optional `resolveHost` constructor parameter (default: `ContentSourceSupport.defaultResolveHost`, i.e. real DNS in production) forwarded to both `fetchUrl` call sites (`createTextUrl`, `refreshText`). Production wiring never overrides this; it exists so tests can unblock a known local-test-server hostname without weakening the guard for any other host.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — added the matching optional `dataSourceUrlResolveHost` constructor parameter, forwarded to `DataSourceService`'s constructor. `Main.scala` and every other spec constructing `ApiRoutes`/`DataSourceService` are unaffected (default kicks in).
- `backend/src/test/scala/com/helio/services/ContentSourceSupportSpec.scala` — new "SSRF guard" test blocks: pure `isBlockedAddress` coverage (loopback, `169.254.169.254`/link-local, RFC1918, `fc00::/7` ULA IPv6, any-local, multicast, and a non-blocked public address); `validateUrl` coverage (blocked scheme rejected before any resolution attempt, missing host, DNS-resolution failure, blocked-address rejection, permitted-address acceptance); `fetchUrl`-level tests using a local Pekko HTTP test server (default resolver blocks the server's own loopback hostname; an injected resolver lets a normal fetch succeed; a redirect to `169.254.169.254` is not followed and not treated as success; a non-success response's body is never echoed).
- `backend/src/test/scala/com/helio/services/DataSourceServiceSpec.scala` — added a `testResolveHost` resolver (special-cases only the literal `"localhost"` hostname the suite's own test server uses; every other host — including literal blocked IPs — still goes through the real `ContentSourceSupport.defaultResolveHost`) and passed it into the `DataSourceService` constructor so the existing URL-ingestion/refresh success tests keep exercising real business logic under the now-guarded `fetchUrl`. Added new tests proving `createTextUrl` still rejects `127.0.0.1`, `169.254.169.254`, and a `file://` scheme even with that resolver override in place.
- `backend/src/test/scala/com/helio/api/DataSourceRoutesSpec.scala` — same `testResolveHost` pattern, passed into `ApiRoutes`'s new constructor param in `routesWith`. Added new route-level tests proving `POST /api/data-sources` (text URL ingestion) returns 502 with a generic (non-body-echoing) message for a loopback URL, the GCP metadata address, and a `file://` scheme.
- `openspec/changes/plain-text-markdown-connector/tasks.md` — added task group 8 (cycle-2 SSRF fix), all checked off.

### Root cause: 3xx responses misclassified as success (found while fixing the guard)

- **Root cause:** Pekko HTTP's `StatusCode.isSuccess` is `true` for any non-4xx/5xx status — `Redirection` (3xx) extends the same `HttpSuccess` marker trait as `Success` (2xx), distinguished only by a separate `isRedirection` flag (confirmed by reading `pekko-http-core`'s `StatusCode.scala` sources). `fetchUrl`'s original `if (response.status.isSuccess()) Right(...)` therefore treated a 3xx redirect-stub response body as successfully-fetched content.
- **Probe:** added a temporary `println` in the new "redirect to internal address" test plus a raw `Http().singleRequest` call bypassing `fetchUrl` entirely, against a local test route that issues `redirect("http://169.254.169.254/...", StatusCodes.Found)`.
- **Probe output (before fix):** `PROBE raw status = 302 Found, isSuccess = true, ...` / `PROBE fetchUrl result = Right([B@...)` — confirmed `isSuccess()` was `true` for the 302 and `fetchUrl` was returning the redirect stub's HTML body as `Right`, not treating it as blocked/non-success.
- **Fix:** replaced the `isSuccess()` check with an explicit 2xx range check (`code >= 200 && code < 300`).
- **Probe output (after fix):** the "not follow a redirect..." test passes; full backend suite re-run afterward (1093 tests) passed with 0 failures.

## Cycle 3: DNS-rebinding TOCTOU fix (skeptic final-gate round 1 REFUTE)

A cold-skeptic final-gate review (`openspec/changes/plain-text-markdown-connector/skeptic-final-1.md`)
found the cycle-2 SSRF guard had a genuine bypass: `validateUrl` resolved a hostname to make its
permitted/blocked decision, but `fetchUrl` then re-issued the HTTP request against the *hostname
string*, letting Pekko HTTP's connection pool re-resolve that same hostname a second time,
independently, when it opened the TCP connection. A DNS-rebinding attacker (first answer public, a
second, later answer 169.254.169.254/loopback/RFC1918) could pass validation and still land the real
connection on a disallowed address. See `design.md`'s "Reusable seam #2" cycle-3 addendum for the full
mechanism and `tasks.md`'s task group 9 for the checklist.

- `backend/src/main/scala/com/helio/services/ContentSourceSupport.scala` — factored `validateUrl`'s resolution+denylist logic into a private `resolveValidated(url, resolveHost, isBlocked): Either[String, InetAddress]` that returns the validated address instead of discarding it; added a private `pinnedTransport(pinnedAddress): ClientTransport` (via `ClientTransport.withCustomResolver`) that always connects to an already-resolved `InetSocketAddress` built from that address, applied to `fetchUrl`'s `ConnectionPoolSettings` via `.withTransport(...)` — this is what actually pins the TCP connection, bypassing Pekko's own connection-layer DNS lookup entirely (its default `ClientTransport.TCP` deliberately re-resolves per connection; passing an already-resolved address skips that). Added a second, hostname-keyed `isBlocked: (String, InetAddress) => Boolean` parameter to `validateUrl`/`fetchUrl` (default: the real, host-agnostic `isBlockedAddress`) — the seam that replaces the old "resolver lies about the resolved address" test pattern, which stopped being safe to use once the real connection pins to whatever `resolveHost` returns. `Host` header / TLS SNI are untouched (derived from the request's `Uri`, not the transport).
- `backend/src/main/scala/com/helio/services/DataSourceService.scala` — added an `isBlocked` constructor parameter (default: `ContentSourceSupport.isBlockedAddress`, host-agnostic) forwarded to both `fetchUrl` call sites, mirroring the existing `resolveHost` parameter's production-unreachability guarantee.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — added the matching `dataSourceUrlIsBlocked` constructor parameter, forwarded to `DataSourceService`'s constructor. `Main.scala` and every other spec constructing `ApiRoutes`/`DataSourceService` are unaffected (default kicks in).
- `backend/src/test/scala/com/helio/services/ContentSourceSupportSpec.scala` — replaced the "permissiveResolver" pattern (lied about `"localhost"`'s resolved address) with `admitLocalhost: (String, InetAddress) => Boolean`, which admits the *real* address `defaultResolveHost` returns for `"localhost"` past the denylist, keyed on the hostname (not the address) so it can't be tricked into admitting an attacker-supplied literal loopback/`169.254.x.x` host. Added a new regression test ("pin the real TCP connection...") that fetches a URL whose hostname is not a real, resolvable DNS name — an independent second resolution (the pre-fix behavior) would fail with `UnknownHostException`, so the fetch can only succeed if the connection is pinned to the `resolveHost` answer; also asserts `resolveHost` is invoked exactly once. Probe-confirmed: temporarily commenting out the new `.withTransport(...)` call made this exact test fail with `Left("Request failed: ... UnknownHostException: rebind-test.invalid")`; restoring it made the test (and the full 24-test suite) pass again.
- `backend/src/test/scala/com/helio/services/DataSourceServiceSpec.scala` — replaced `testResolveHost` (the lying resolver) with `testIsBlocked: (String, InetAddress) => Boolean`, admitting `"localhost"` past the denylist; dropped the now-unnecessary `resolveHost` override from the `DataSourceService` construction (real DNS already resolves `"localhost"` correctly). Removed now-unused `Success`/`Try` imports.
- `backend/src/test/scala/com/helio/api/DataSourceRoutesSpec.scala` — same `testIsBlocked` replacement, passed as `dataSourceUrlIsBlocked` in `routesWith`; dropped the `resolveHost` override. Removed now-unused `Success`/`Try` imports.
- `openspec/changes/plain-text-markdown-connector/tasks.md` — added task group 9 (cycle-3 DNS-rebinding TOCTOU fix), all checked off.
- `openspec/changes/plain-text-markdown-connector/design.md` — added a cycle-3 addendum to "Reusable seam #2" documenting the pinning fix and the test-seam restructuring.

### Root cause: DNS-rebinding TOCTOU between `validateUrl`'s resolution and the real connection

- **Root cause (per skeptic report, probe-confirmed by re-tracing Pekko HTTP's own source):** `ClientTransport.TCP` (Pekko HTTP's default transport) builds an *unresolved* `InetSocketAddress` from the request's hostname string (`InetSocketAddress.createUnresolved`) — Pekko's own source comment on that default explains this is deliberate, "so that DNS resolution is performed for every new connection." Since `fetchUrl` issued `Http().singleRequest(HttpRequest(uri = url), ...)` with the plain hostname string and no custom transport, this second, independent resolution happened for every fetch, completely decoupled from `validateUrl`'s earlier resolution — the address that had been validated was simply discarded.
- **Probe:** wrote a regression test using a hostname that is not a real, resolvable DNS name (`rebind-test.invalid`), with an injected `resolveHost` that maps it to the real address of this suite's own local test server (for validation), and ran it against the code *before* adding `.withTransport(pinnedTransport(...))`.
- **Probe output (before fix):** `Left("Request failed: Tcp command [Connect(rebind-test.invalid/<unresolved>:PORT,...)] failed because of java.net.UnknownHostException: rebind-test.invalid")` — confirmed Pekko HTTP was attempting its own, independent real-DNS resolution of the hostname at connect time, exactly as the skeptic's report described, and that this hostname (deliberately non-existent) caused it to fail rather than silently landing elsewhere — proving the second resolution was live and disconnected from the first.
- **Fix:** `resolveValidated` returns the validated `InetAddress`; `fetchUrl` builds a `pinnedTransport` via `ClientTransport.withCustomResolver` that always returns that already-resolved address (skipping Pekko's own DNS lookup for the connection), applied via `ConnectionPoolSettings.withTransport(...)`.
- **Probe output (after fix):** the same test now returns `Right("hello")` (the real test server's content) — the connection succeeded despite the hostname being genuinely unresolvable via real DNS, which is only possible if the connection was pinned to the validated address and never re-resolved. Full backend suite re-run afterward (1094 tests) passed with 0 failures.

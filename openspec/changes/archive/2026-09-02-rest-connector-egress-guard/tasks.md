## 1. Backend — shared seam

### Backend

- [x] 1.0 Read design.md Decision 2's `fetchOverride` note and Decision 8's error-channel trade-off before writing any test; verify by stating in files-modified.md which egress tests set `fetchOverride = None`
- [x] 1.1 Publish `ContentSourceSupport.resolveValidated` as public `validateAndResolve(url, resolveHost, isBlocked): Either[String, InetAddress]`, keeping one implementation; verify `sbt "Test/compile"` succeeds and existing `ContentSourceSupport` specs still pass
- [x] 1.2 Publish a pinned-connection accessor built from `pinnedTransport` (address in, `ClientTransport`/pool settings out) so a caller building its own request can pin to the validated address; verify by unit-asserting the transport resolves to the pinned address and ignores the supplied host
- [x] 1.3 Refactor `fetchUrl` to call 1.1/1.2 rather than the private originals, changing no signature or behavior; verify every existing text/pdf/image/csv URL spec still passes unchanged

## 2. Backend — REST driver guard

### Backend

- [x] 2.1 Add `resolveHost`/`isBlocked` constructor params to `RestApiConnectorDriver` with the real defaults, appended last so every existing positional construction still compiles; verify `sbt "Test/compile"`
- [x] 2.2 Guard `issueAndParse` on `request.uri.toString` via 1.1, returning the disallowed-address error before any connection, and issue the request with per-request pool settings carrying the pinned transport; verify a loopback-resolving destination is refused with no outbound request
- [x] 2.3 Apply the identical guard and pinning to `issueTest`; verify the same for `testConnection`/`testConnectionEphemeral`
- [x] 2.4 Replace `response.status.isSuccess()` in both issuers with the explicit 2xx-range check `ContentSourceSupport.fetchUrl` uses (`val code = response.status.intValue(); code >= 200 && code < 300`) so a 3xx is an error and its body is never parsed; verify a stubbed 302 yields an error
- [x] 2.5 Wire the real `resolveHost`/`isBlocked` defaults into the driver at its only production construction site, `Main.scala:165` (NOT `ApiRoutes`, which receives a ready-made driver at line 73); verify by grepping `new RestApiConnectorDriver` across main and confirming that is the sole non-test construction

## 3. Backend — Connector write-time validation

### Backend

- [x] 3.1 Add the same injected `resolveHost`/`isBlocked` to `ConnectorEntityService`; verify `sbt "Test/compile"`
- [x] 3.2 Validate `baseUrl` via 1.1 in `create` after the non-empty check, returning `ServiceError.BadRequest` and persisting nothing on refusal; verify no Connector row is created for a loopback base URL
- [x] 3.3 Apply the same validation in `update`, leaving the stored row unchanged on refusal; verify by asserting the row is byte-identical after a refused update
- [x] 3.4 Wire the seam into `ConnectorEntityService`'s construction in `ApiRoutes` (line 472), alongside the existing `dataSourceUrl*` params at lines 104-111; verify the route-level spec exercises the real default in production configuration

## 4. Tests

### Tests

- [x] 4.1 Spec each blocked address class independently (loopback, link-local incl. 169.254.169.254, RFC1918, IPv6 site-local, IPv6 unique-local, any-local, multicast) against Connector create; verify one assertion per class, not one representative
- [x] 4.2 Spec the same class-by-class rejection for Connector update, asserting the stored row is unchanged
- [x] 4.3 Spec `POST /api/sources/infer` (502-class, message names the disallowed address) and `POST /api/sources/test` (200 with `ok = false` and the reason in `error`) refusing each class and issuing no outbound request; respect that `fetchEphemeral` consults `fetchOverride` while `testConnectionEphemeral` does not
- [x] 4.4 Spec the REST source refresh/preview/pipeline-run path refusing a disallowed destination with a 502-class error naming it, proving the guard is reached from an entry point other than infer/test; the driver MUST be constructed with `fetchOverride = None` or the assertion never reaches the guard
- [x] 4.5 Spec DNS-rebinding: a resolver answering public-then-internal must still connect to the validated address, modelled on `ContentSourceSupportSpec.scala:249-265`'s unresolvable-hostname pattern; verify the test fails if the pinned transport is removed
- [x] 4.6 Spec a 302 response to a REST fetch being an error whose body is not parsed
- [x] 4.7 Spec that an allowed external REST destination still succeeds carrying its method, headers, injected credential and body, with `fetchOverride = None` so it runs through the real guarded issuer, using the hostname-keyed `isBlocked` seam and never widening an address class
- [x] 4.8 Spec a stored Connector whose destination is disallowed being refused at fetch time independently of create-time validation
- [x] 4.9 Run the full backend suite plus `npm run lint`/`typecheck` and record results; verify all gates green before commit

## 5. Evidence

### Tests

- [x] 5.1 Record the outbound-fetch-site enumeration from design.md Decision 6 in the PR body, each entry marked governed or exempt with its justification
- [x] 5.2 Query the dev database for existing Connectors/sources whose destination would now be refused, state the count and the no-migration disposition in the PR body, and make no production database access
- [x] 5.3 Verify a real external endpoint (the Sleeper API the epic uses) still fetches successfully through the guarded path, and record the observed result
- [x] 5.4 Filed follow-up tickets HEL-952 (`SqlConnectorDriver` egress) and HEL-953 (typed connector-driver error channel so an egress refusal surfaces as 4xx instead of the 502 accepted in design.md Decision 8); both referenced in the PR body

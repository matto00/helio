## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Decision 1 (validateUrl returns Unit → TOCTOU) — TRUE.** `ContentSourceSupport.validateUrl` is
  `resolveValidated(url, resolveHost, isBlocked).map(_ => ())`; `resolveValidated` is `private` and
  returns `Either[String, InetAddress]`; `pinnedTransport` is `private`. Publishing the core is the
  right seam, and the rejected alternative (b) is correctly rejected.
- **Decision 2 (issuers are a superset of the builders) — TRUE for production, with one unmentioned
  bypass.** Read `RestApiConnectorDriver.scala`: `fetch`→`doFetch`→`issueAndParse` (228/273/279),
  `testConnection`→`issueTest` (323/304), `fetchEphemeral`→`issueAndParse` (384-407),
  `testConnectionEphemeral`→`issueTest` (408). Only two `singleRequest` calls exist in the file
  (281, 306). BUT `fetchOverride` (constructor param 1, line 45) short-circuits `fetch` (228) and
  `fetchEphemeral` (385) *before* the issuers — it opens no socket (it is an injected stub, default
  `None`, and `Main.scala:165` does not set it), so the security superset claim survives; it is a
  **test-integrity** hole, and design.md never mentions it. See CR 3.
- **Decision 6 enumeration — verified by my own grep**, not taken on trust:
  `grep -rn "singleRequest|superPool|outgoingConnection|openStream|openConnection|HttpClient|Source.fromURL|okhttp" backend/src/main/scala`
  returns exactly the sites in the table and nothing else; the JDK/third-party client patterns
  return nothing. The four exempt sites are hard-coded literals as claimed: `OAuthRoutes.scala:61`
  (`"https://oauth2.googleapis.com/token"`), `:83` (`.../oauth2/v3/userinfo`),
  `HttpResendEmailSender.scala:77` (`private val EmailsUri`), `HttpClaudeTransport.scala:135`
  (`private val MessagesUri`, used by all three `singleRequest` calls at 72/95/115). `SqlConnectorDriver`
  exists and is correctly listed as exposed-but-out-of-scope.
- **Decision 7 (no migration) — defensible.** An unfetchable row is inert, deletion is irreversible,
  and task 5.2 records the observed count and disposition, satisfying the ticket's assessment AC.
- **Task 4.5 (rebinding) is achievable and discriminating** — `ContentSourceSupportSpec.scala:249-265`
  already uses the "unresolvable hostname + injected resolver" pattern, which fails without the pin.
  Reuse it explicitly (non-blocking note 1).
- **Wiring — CONTRADICTED.** `grep -rn "new RestApiConnectorDriver" backend/src/main/scala` → only
  `Main.scala:165`. `ApiRoutes` *receives* the driver as a constructor param (`ApiRoutes.scala:73`),
  it does not construct it. The `dataSourceUrl*` seam lives at `ApiRoutes.scala:104-111`.
  `ConnectorEntityService` IS constructed in `ApiRoutes.scala:472`, so task 3.4 is fine.
- **Error classification — CONTRADICTED.** Every REST driver `Left` is mapped by `SourceService` to
  `ServiceError.BadGateway` (502): `refreshRest` (~:291), `previewRest` (~:333), and the same
  pass-through pattern for infer/test. The plan adds the refusal into that same `Left(String)`
  channel, so it surfaces as 502.

### Verdict: REFUTE

### Change Requests

1. **The specs demand a client error; the design produces a 502.**
   `specs/rest-api-connector/spec.md` requires "The refusal SHALL be reported as a client error
   naming the reason, not as an upstream fetch failure, so a caller can distinguish a destination
   that is not permitted from one that is unreachable", and
   `specs/connection-test-endpoint/spec.md` requires "a clear error naming the reason rather than an
   unexplained upstream failure". But `SourceService.refreshRest`/`previewRest` (and the sibling
   infer/test paths) blanket-map every driver `Left(String)` to `ServiceError.BadGateway` — the
   design's guard, returning a plain `Left` from inside `issueAndParse`/`issueTest`, will be
   indistinguishable from an upstream failure and will surface as 502. Resolve this explicitly in
   design.md and tasks.md: either (a) give the egress refusal a distinguishable channel (a typed
   error the service layer maps to `BadRequest`/`UnprocessableEntity`) and add tasks covering every
   `SourceService` call site that maps driver `Left`s, or (b) amend both spec files to state the
   refusal is reported as a 502-class upstream error whose message names the disallowed address, and
   drop the "client error, not an upstream fetch failure" wording. As written the change cannot
   satisfy its own spec, and task 4.3/4.4 have no stated expected status code.

2. **Decision 5 and task 2.5 wire the driver seam from a place that does not construct it.**
   design.md Decision 5 says the driver's `resolveHost`/`isBlocked` are "wired from `ApiRoutes`
   alongside the existing `dataSourceUrl*` parameters", and task 2.5 says "wire ... from `ApiRoutes`
   into every `RestApiConnectorDriver` construction site". `ApiRoutes` takes the driver as a
   ready-made constructor param (`ApiRoutes.scala:73`); the only production construction is
   `Main.scala:165`. Correct both artifacts to name `Main.scala` as the production wiring site, and
   state how a route-level spec (tasks 4.3/4.4/4.7) gets an admitting `isBlocked` into the driver
   instance the fixture builds and hands to `ApiRoutes` — the ApiRoutes-level `dataSourceUrlIsBlocked`
   seam cannot reach it. This is the seam the security tests depend on; leaving the executor to
   improvise it is exactly how a test ends up admitting an address class instead of a hostname.

3. **`fetchOverride` is unaddressed, and it silently disarms tasks 4.4 and 4.7.**
   `fetchOverride` (`RestApiConnectorDriver.scala:45`) bypasses `issueAndParse` in `fetch` (:228) and
   `fetchEphemeral` (:385) — and is the codebase's standard REST test fixture (~20 constructions per
   the `Main.scala:159` comment). A 4.7 test ("an allowed external destination still succeeds
   carrying its method, headers, credential and body") written with `fetchOverride` never reaches the
   guard and proves nothing; 4.4 likewise. Add to design.md Decision 2 an explicit statement that
   `fetchOverride` bypasses the issuers, that it is test-only and never set in production (cite
   `Main.scala:165`), and amend tasks 4.4/4.7 to require `fetchOverride = None` so the assertion runs
   through the real guarded issuer. Note also the asymmetry that `testConnectionEphemeral` (:408)
   does not consult `fetchOverride` while `fetchEphemeral` does, so 4.3's two endpoints do not
   behave identically under a fixture.

4. **Decision 3 misquotes the code it cites and prescribes the formulation that code warns against.**
   design.md says `ContentSourceSupport` "rejects on `isSuccess && !isRedirection`" and task 2.4
   prescribes that expression. The actual implementation (`ContentSourceSupport.scala`, in `fetchUrl`)
   is `val code = response.status.intValue(); if (code >= 200 && code < 300)`, with a comment stating
   "Checking the 2xx range explicitly is what actually fixes this (not a cosmetic rename of
   `isSuccess`)". Correct the citation and change task 2.4 to use the same explicit 2xx-range check,
   so the two REST issuers and the shared helper share one idiom rather than two.

### Non-blocking notes

- Task 4.5: name `ContentSourceSupportSpec.scala:249-265`'s unresolvable-hostname pattern as the
  model, so "verify the test fails if the pinned transport is removed" has a known-discriminating
  construction rather than being re-derived.
- Decision 2 keys the guard on `request.uri.toString`. On the resolved path `injectAuthQueryParam`
  may have placed a credential in that URI; `resolveValidated`'s messages only echo the host, which
  is safe, but the executor must not log the URI on refusal (HEL-311 convention).
- Decision 6's table is accurate as verified, but says nothing about `backend/src/test`; that is the
  right scope, and worth stating so a reader does not read the table as repo-wide.

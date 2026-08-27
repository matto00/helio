## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

**(a) Are `buildResolvedRequest`/`buildEphemeralRequest` genuinely the only request-issuing
choke points for these configs? — YES, confirmed.**

`grep -rn "buildResolvedRequest\|buildEphemeralRequest\|HttpRequest(" backend/src/main` returns,
inside `RestApiConnectorDriver.scala`, exactly two `HttpRequest(...)` constructions (`:149` in
`buildResolvedRequest`, `:303` in `buildEphemeralRequest`). The only two request-issuing functions
(`issueAndParse` `:227`, `issueTest` `:251`, each a single `Http(...).singleRequest`) are reachable
only from `doFetch` (`:222`), `testConnection` (`:273`), `fetchEphemeral` (`:317`),
`testConnectionEphemeral` (`:321`) — all four fed solely by those two builders.
`inferSchema`/`fetch(config, maxRows, …)`/`inferSchemaEphemeral` are transitive over `fetch`/
`fetchEphemeral`, never direct. Other `HttpRequest(` hits in the tree (`OAuthRoutes`,
`HttpResendEmailSender`, `HttpClaudeTransport`, `ContentSourceSupport.fetchUrl:224`) take no
`RestApiConfig`/`EphemeralRestConfig` and cannot carry a source body. The only bypass is
`fetchOverride` (`:213`, `:314`), which is the documented test-only stub hook. The structural
framing of Decision 3 holds.

**(b) Does `toDomain` staying permissive resolve the round-4 finding? — YES for `body`.**

`DataSourceConfigCodec.decodeRest` (`DataSourceConfigCodec.scala:56`) calls
`RestApiConfigPayload.toDomain` on every read, and `DataSourceRepository.rowToDomain:45-55` maps a
`Left` to a `__malformed__` sentinel config. A permissive `toDomain` therefore leaves stored
GET+body rows decoding normally; the guard fires at first fetch instead. tasks.md 2.2 correctly
encodes this as a positive test. Round-4's finding is genuinely closed for `body`.

**(c) Other gaps — one real defect found (below); the toRows call-site enumeration checks out.**

`grep -rn "\.toRows(" backend/src/main` yields only `SourceService.scala:312` (rest) and `:298`
(sql), plus the three in-driver call sites; task 4.1's enumeration matches exactly.
`resolveTemplatedRequestParts` exists at `RestApiConnectorDriver.scala:159` with the tuple shape
task 3.1 assumes.

### Verdict: REFUTE

### Change Requests

1. **`design.md` Decision 2 reintroduces round-4's exact defect, one field over — for
   `bodyContentType` instead of `body`; and it directly contradicts Decision 3's own cycle-5 rule
   and tasks.md 2.2.**

   Decision 2 (design.md:73-74) still says: *"a present value is parsed via Pekko's
   `ContentType.parse` — parse failure is a curated 400 at `RestApiConfigPayload.toDomain`, never
   reaches `buildResolvedRequest`."* Decision 3 (design.md:76-95) and tasks.md 2.2 now state
   `toDomain` must **never** reject, precisely because `decodeRest` shares it on the read path.
   These cannot both be implemented.

   This is not merely a wording contradiction — the rejecting variant is reachable and destructive:
   - The **only live source-creation UI path** is the bare-`url` branch,
     `SourceService.scala:117-122`, which constructs `RestApiConfig(...)` **directly and never calls
     `toDomain`** (verified: `SourceService.scala:93-125`). Task 2.3 adds `bodyContentType`
     forwarding here with no `ContentType.parse` validation.
   - So an unparseable `bodyContentType` from the real UI is **persisted**.
   - On the next read, `DataSourceRepository.rowToDomain:45` → `decodeRest` → `toDomain` →
     `Left("malformed…")` → the source is replaced by the `__malformed__` sentinel
     (`DataSourceRepository.scala:53-55`), permanently bricking a source the user just created.
     That is strictly worse than round 4's case (which only affected pre-existing rows).

   Required revision: make Decision 2 consistent with Decision 3 — `toDomain` stays permissive for
   `bodyContentType` too (store the raw string, never parse there), and move the `ContentType.parse`
   to the same structural choke points as the GET/HEAD guard.

2. **tasks.md 3.2 / 3.3 leave `ContentType.parse` failure behavior unspecified.** Both say
   *"using `bodyContentType.getOrElse("application/json")` parsed via `ContentType.parse`"* with no
   stated outcome on parse failure, while design.md Decision 2 asserts that failure "never reaches
   `buildResolvedRequest`" — which CR1 shows is false. Specify the behavior explicitly and
   symmetrically in 3.2 and 3.3: a `ContentType.parse` failure short-circuits to
   `Left("<curated message>")` before the `HttpRequest` is built (the same shape as
   `rejectBodyOnSafeMethod`), never a silent fallback to `application/json` that would send a body
   under a content type the user did not ask for. Add a unit test for it alongside 3.2/3.3's
   existing cases.

3. **Add the create-time content-type check to the belt-and-braces set (optional-but-recommended,
   same framing as 2.3).** Once CR1/CR2 land, note in Decision 3's belt-and-braces paragraph and in
   task 2.3 that the create-time immediate-400 courtesy covers *both* `rejectBodyOnSafeMethod` and
   the content-type parse, so a typo'd content type surfaces at submit rather than at first fetch.
   Explicitly non-load-bearing, exactly like the existing GET+body create-time call.

### Non-blocking notes

- Decision 3's parenthetical "covers create-time fetch, infer, test, refresh, AND `PipelineService`'s
  inline `rest_api` `connectorId` branch" is an enumeration again, but here it is only *explanatory*
  — the guarantee rests on the two builders, which I verified independently. No action needed.
- `fetchEphemeral`'s `fetchOverride` branch (`RestApiConnectorDriver.scala:314-316`) synthesizes a
  `RestApiConfig` that drops `body`/`bodyContentType`/`rootSelector`. Test-only, so not a safety
  issue, but a test written through that hook will silently not exercise the body — worth a line in
  task 3.4 so the echo-endpoint test is not accidentally routed through the override.

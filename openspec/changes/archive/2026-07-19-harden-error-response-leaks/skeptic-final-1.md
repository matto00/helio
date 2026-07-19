## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **Independent grep + reachability trace of every `getMessage`/`getLocalizedMessage` site.**
   Ran `grep -rn "getMessage\|getLocalizedMessage" backend/src/main/scala/com/helio/` cold — 16
   residual lines, identical to `audit.md`'s re-grep confirmation:
   - `PanelConfigCodec.scala:97` — read the file; confirmed `DeserializationException` arm is
     reachable only via `deserializationError(...)` calls under `domain/panels/*`. Sampled all 53
     `grep -rn "deserializationError"` hits — every message is static/curated (field name/value
     text), never a wrapped raw exception.
   - `InProcessPipelineEngine.scala:151` — read the file; the `IllegalArgumentException` this
     throws is only caught by `PipelineRunService.previewStep`/`executeRun`, both of which discard
     the incoming message entirely (verified those two sites directly, see below) — unreachable.
   - `OAuthRoutes.scala:160` — read the file; `Option(ex.getMessage)` is used only inside
     `isUpstreamOAuthError` for `.contains`/`.startsWith` pattern matching to select a route
     branch — never placed in a response body.
   - `SourcePreviewRoutes.scala:42,49`, `DataSourceRoutes.scala:110,118,126,134`,
     `SourceRoutes.scala:42,50` — read all three files plus `DataSourceProtocol.scala`; every
     request type deserialized here (`SqlInferRequest`, `RestApiConfigPayload`,
     `TextSourceUrlRequest`, `PdfSourceUrlRequest`, `ImageSourceUrlRequest`,
     `StaticDataSourceRequest`, `SqlCreateSourceRequest`, `CreateSourceRequest`) is a plain
     `jsonFormatN`-auto-derived format over simple field types (String/nested case classes), no
     custom `read` override with embedded business logic — `DeserializationException.getMessage`
     here is always spray-json's own curated text.
   - `LocalFileSystem.scala:114` — read the file; only called from `Main.scala` at process boot;
     a failure here crashes startup, never reaches an HTTP response.
   - `PipelineStepRepository.scala:221`, `PipelineService.scala:210` — read both; each throws an
     uncaught `IllegalStateException`. Downloaded and read Pekko HTTP 1.1.0's
     `ExceptionHandler.scala` source directly (`org/apache/pekko/http/scaladsl/server/ExceptionHandler.scala`,
     `default(settings)`, `NonFatal(e)` branch): confirmed it calls `ctx.log.error(e, ...)`
     (server-side only) then `ctx.complete(InternalServerError)` — a **bare** 500 with no body,
     never `e.getMessage`. This independently verifies the audit's "unreachable to body" claim at
     the library-source level, not just by trusting the audit's assertion.
   - `PanelService.scala:262` — read `PanelPatchApplier.scala:52-53`: the only construction site
     of this `IllegalArgumentException` wraps `PanelConfigCodec.applyConfigPatch`'s `Left(err)`,
     which is safe by construction (see above) — traced myself, not just cited.
   - `PipelineService.scala:430` — read the file; `msg` is used only for `.contains(...)`
     classification inside `classifyDbError`, never returned to the caller.
2. **Independent grep of `PSQLException`** — matches audit.md exactly:
   `PermissionService.scala:47`, `PipelinePermissionService.scala:52` (static `Conflict` message,
   no raw text extracted), `PipelineService.scala:429` (the fixed `classifyDbError`).
3. **Read every production diff hunk** (`git diff main...HEAD` — 13 backend `main` files) and
   confirmed each matches its audit.md before/after claim exactly: `OAuthRoutes.scala:140-141`,
   `ApiRoutes.scala:164-166,199-201`, `PipelineService.scala` (`classifyDbError` companion object,
   `addStep`/`updateStep` decode arms), `PanelService.scala:219-222`, `PipelineRunService.scala`
   (`previewStep`, `executeRun`'s single-point `errMsg`), `SourceService.scala` (4 `BadGateway`
   arms simplified, not double-wrapped), `SqlConnector.scala:88`, `RestApiConnector.scala:56,62`
   (line 58's `HTTP <status>: <body>` correctly left alone — that's the *user's own* configured
   endpoint's response body, not internal exception detail), `ContentSourceSupport.scala:133,234`,
   `PdfTextSupport.scala:44`, `PanelConfigCodec.scala` (`safe`'s `Throwable` arm),
   `PipelineAnalyzeService.scala` (5 sites), `SparkJobSubmitter.scala:94-105` (defense-in-depth,
   confirmed dead code — see below).
4. **Confirmed the `SparkJobSubmitter` dead-code reachability claim myself**, not just by citing
   the audit: `grep -rn "\.submit(" backend/src/main/scala/com/helio/` → only
   `PipelineRunSubmitRoutes.scala:27` matches, calling `PipelineRunService.submit` (a different
   method) — `SparkJobSubmitter.submit` is never invoked from any route. `grep -rn
   "cache\.\(put\|update\)"` → only 4 hits, all inside `SparkJobSubmitter.scala` itself — no other
   producer populates `PipelineRunCache`. So `GET /pipelines/:id/runs/:runId`
   (`PipelineRunStatusRoutes`) is unreachable via the shipped in-process engine today; fixing it
   anyway is correctly justified as defense-in-depth for HEL-202.
5. **Re-ran `sbt test`** (backend/) fresh, from a cold shell: `Total number of tests run: 1395` /
   `Tests: succeeded 1395, failed 0, canceled 0` / `All tests passed.` — matches audit.md's and
   evaluation-1.md's claim exactly.
6. **Re-ran `openspec validate harden-error-response-leaks --strict`**: `Change
   'harden-error-response-leaks' is valid`.
7. **Re-ran `npm run check:scala-quality`**: `Scala code-quality check: clean (44 soft
   warning(s))` — 0 inline-FQN violations; the 44 warnings are pre-existing file-size soft
   budgets, none newly introduced by this change's touched files exceeding a hard threshold.
8. **Read all five new/strengthened test files in full** and confirmed they assert the actual
   invariant, not merely a status code:
   - `GoogleOAuthRoutesSpec.scala` (new test) — injects a unique secret string as the failure
     exception's message, asserts the response body `should not include secret` and `should
     include "Internal server error"`, and separately asserts (via a logback `ListAppender`
     attached to `OAuthRoutes`'s logger) that an event was logged whose `getThrowableProxy`
     message equals the secret. This is a genuine two-sided assertion (client-safe AND
     server-logged), not a hollow 500-status check.
   - `ApiRoutesSpec.scala` (new test, `GET /api/auth/me`) — identical secret-injection +
     `ListAppender` pattern, using a subclassed `UserRepository` whose `findById` fails.
   - `PanelServiceBatchUpdateErrorSpec.scala` (new file) — mocked `PanelRepository.batchUpdate`
     failure, asserts `ServiceError.message shouldBe "Batch update failed"` (exact match, not
     `include`) plus the same secret/`ListAppender` pattern.
   - `PipelineRunRoutesSpec.scala` (strengthened, 3 tests) — real end-to-end HTTP/SSE tests
     (embedded Postgres, live in-process engine) exercising all three fan-out surfaces of
     `PipelineRunService.executeRun`'s single `errMsg`: the direct 422 body, the SSE `errorLog`
     event, and the persisted `PipelineRunRecord.errorLog` via run-history — each asserts the
     exact generic string plus `should not include <missingSourceId>` / `should not include
     "DataSource not found for join"` (the real leaked text pre-fix).
   - `SparkJobSubmitterSpec.scala` (strengthened) — real-Spark integration test, asserts both the
     persisted `errorLog` and the `PipelineRunCache` entry's `error` are the exact generic string
     with `should not include "nonexistent_column"` (the real Spark analysis-exception detail).
9. **Confirmed the spec deltas match the implementation.** `specs/error-response-safety/spec.md`'s
   three scenarios (generic 5xx body + server-side log; curated 4xx messages preserved; connector
   category messages) and `specs/google-oauth-login/spec.md`'s scenario (exact `{"error": "Internal
   server error"}` body, full exception+stack logged) are both traced to the `OAuthRoutes.scala`
   diff and the `GoogleOAuthRoutesSpec` test read above — no divergence found.
10. **Confirmed no scope drift**: `git diff main...HEAD --stat` shows only `backend/**` and
    `openspec/changes/harden-error-response-leaks/**` — zero `frontend/**` or `schemas/**` files.
    This is a backend-only security sweep; no UI review applicable (confirmed via the diff stat
    myself, not merely citing evaluation-1.md's claim).
11. **Traced all three ticket ACs** (`ticket.md`) to evidence: (a) `OAuthRoutes.scala:134`'s old
    `ex.getMessage` no longer present, replaced by `log.error(...)` + generic body — verified by
    reading the file; (b) `audit.md` present, exhaustive, independently spot-verified above; (c)
    `GoogleOAuthRoutesSpec`'s new test asserts exactly the described generic-body-plus-server-log
    invariant — verified by reading the test.

### Verdict: CONFIRM

The Option C full-sweep scope (a deliberate, recorded human decision from the design gate) is
implemented completely and correctly. I independently re-traced every reachable
`getMessage`/`getLocalizedMessage`/`PSQLException` site in the current backend source — including
verifying the two "unreachable to client body" claims against Pekko HTTP 1.1.0's actual
`ExceptionHandler` source rather than trusting the audit's assertion — and found no residual
leak. Both gates (`sbt test`, `openspec validate --strict`) reproduce clean from a cold shell. The
new/strengthened tests assert the real invariant (generic client body AND server-side log of the
raw detail) via logback `ListAppender` captures and explicit `should not include <secret>`
checks, not merely a status code — these would catch a real regression.

### Non-blocking notes

- `PipelineAnalyzeService`'s genericized `"<op> config error"` messages lose some previously
  available diagnostic specificity (the raw parse-failure reason) for legitimate misconfigured
  pipelines. This is an explicit, documented trade-off in `design.md`'s Risks section (only the
  raw tail is dropped, the op-scoped category is kept) and is the correct call for a security
  ticket — noting it only as context, not a defect.
- `tasks.md` 6.4's deviation (testing the two live fan-out surfaces instead of the dead
  `RunStatusResponse.error` surface, plus fixing `SparkJobSubmitter` defense-in-depth with a
  spinoff note for HEL-202 re-verification) is well-reasoned and independently confirmed reachable
  via my own `grep -rn "\.submit("` check — no action needed now.

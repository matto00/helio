## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every claim below is derived from the worktree tree, the actual diff, a fresh
full `sbt test` run I executed myself, and a runtime probe against the real pekko-http jar —
not from `evaluation-1.md` or the executor's narrative.

### What I verified (with evidence)

**Diff scope** — `git diff main...HEAD --stat` at `ac70e824`: 5 production files
(`TemplateInterpolator.scala` new, `RestApiConnectorDriver.scala`, `DataSourceProtocol.scala`,
`DataSourceConfigCodec.scala`, `model.scala`) + 1 test file + planning artifacts. Matches
`files-modified.md`. No scope creep, no unrelated refactors.

**1. Templating wired only into `buildResolvedRequest`; `buildEphemeralRequest` untouched — TRUE.**
Read the full diff of `RestApiConnectorDriver.scala`. `resolveTemplatedRequestParts` is called
only from `buildResolvedRequest` (inside `credentialFut.map`, before `HttpRequest` construction).
`buildEphemeralRequest`'s body is byte-identical to `main` — the only change is a scaladoc
comment pointing at design.md Non-Goals. `grep`-confirmed: no `TemplateInterpolator` reference
anywhere in the ephemeral path. Test 4.9 asserts the literal passthrough end-to-end against the
embedded echo server and correctly expects `/echo/%7B%7BuserId%7D%7D` (URI-level percent-encoding,
not resolution) — exactly the assertion shape skeptic-design-2's non-blocking note asked for.

**2. Wire shape — TRUE and correct.** `DataSourceProtocol.scala:154`:
`parameters: Option[Map[String, String]] = None`, positioned last, with an in-source comment
naming the spray-json default-value trap. Both `jsonFormat8`→`jsonFormat9` sites updated:
`DataSourceProtocol.scala:397` and `DataSourceConfigCodec.scala:20` (both read in the diff).
`toDomain` uses `.getOrElse(Map.empty)`; `fromDomain` emits `None` when empty, matching the
existing `queryParams`/`headers` idiom, so encode-side output is byte-identical for every
pre-existing source. Test 4.6a calls the real `DataSourceConfigCodec.decodeRest` on a literal
blob with no `parameters` key and asserts `Right(RestApiConfig(..., parameters = Map.empty))` —
the exact regression CR2 of the design gate existed to prevent, and it exercises real code.

**3. Endpoint encoding is RFC-3986, not `URLEncoder` — TRUE, verified by runtime probe.**
`TemplateInterpolator.encodePathSegment` is `Uri.Path.Segment(value, Uri.Path.Empty).toString`;
no `java.net.URLEncoder` anywhere in the diff. I ran the real pekko-http-core 1.1.0 jar directly:
`new Uri$Path$Segment("New York*", Empty).toString` → `New%20York*`. Space → `%20` (not `+`),
`*` correctly left literal as a sub-delim. Test 4.4 asserts `%20` present and `+` absent.

**4. Credential unreachability — TRUE, structurally, by code read.** `credentialValue`
(`RestApiConnectorDriver.scala:126`) flows only into `injectAuthQueryParam` and
`buildAuthHeaders`. `resolveTemplatedRequestParts(config)` takes only `config` and interpolates
against `config.parameters` exclusively — `credentialValue` is not in scope of any map passed to
`TemplateInterpolator`. There is no name a template could use to reach it. This is a structural
guarantee, not a comment.

**5. Tests exercise what they claim — mostly TRUE.**
- Real HTTP: `beforeAll` binds a real pekko `Http().newServerAt("localhost", 0)` echo route and
  asserts on the path/raw query/headers the server actually received. Not a stub.
- Real run-time path (4.2): constructs a real `InProcessPipelineEngine` and calls
  `engine.loadRows(ds, null)`; I read `InProcessPipelineEngine.scala:127-138` and confirmed the
  `case r: RestSource =>` arm calls `connector.fetch(..., ConnectorResolveContext.Internal)` —
  the genuine run-time path, distinct from the 4.1 `Owned` authoring path. The AC's
  "demonstrated on both paths" is genuinely met.
- Real credential decrypt: DB-backed `ConnectorRepository`/`ConnectorCredentialRepository` with a
  real `EncryptedSecretBackend`/`EnvMasterKeyProvider`; test 4.8 proves the decrypted
  `the-real-token` really does reach the wire under `bearer`, so decryption is genuinely
  exercised.
- Fail-loud tests assert `Left("Unresolved template variable: <name>")` — I confirmed the
  short-circuit happens in the `for`-comprehension before `HttpRequest` construction.
- I re-ran the suite in isolation: `RestApiConnectorDriverTemplatingSpec` passes with 0 failures.

**6. HEL-822 regressions — none found.** The auth-header-collision filter
(`authHeaderNames`/`filterNot`) is unchanged, only relocated inside the new `Right` branch and
now operating on resolved values; test 4.8 proves a templated `Authorization` source header is
still dropped in favour of the real bearer header. Dual-support/no-auth paths untouched.

**7. Full gate chain — re-run by me, not trusted.** `cd backend && sbt -batch test`:
`Total number of tests run: 3552 / succeeded 3539, failed 13`, suites `SourceServiceSpec`,
`DataSourceRoutesSpec`, `PipelineApplyProposalRollbackSpec`, `ApiRoutesSpec`,
`AuditMutationInstrumentationSpec`. I re-ran `SourceServiceSpec` with full output: every failure
is `ConnectorCredentialEncryptionFailed: Failed to encrypt connector credential: NoKeyConfigured`.
`grep -i CONNECTOR_MASTER_KEY backend/.env` → not set in this worktree. Root cause is
environmental and independent of this diff (which touches no credential/encryption code); the
evaluator's claim is **confirmed**. No frontend gates apply (zero `frontend/**` changes), so no
UI review — Phase 3 N/A is correct.

### Verdict: REFUTE

One reproduced, blocking defect in newly added code. Everything else in this change is sound —
the templating boundary, wire shape, RFC-3986 encoding, credential unreachability, and test
quality all survive adversarial checking, and the design-gate CRs are genuinely resolved in code
rather than in prose.

### Change Requests

1. **An empty parameter value substituted into an endpoint throws an uncaught
   `IllegalArgumentException` instead of returning a curated `Left`.**
   `TemplateInterpolator.scala` (`encodePathSegment`, the `Uri.Path.Segment(value, Uri.Path.Empty)`
   line) passes the resolved value straight to `Uri.Path.Segment`, which rejects an empty head.
   Verified two ways, not inferred:
   - pekko-http-core 1.1.0 source, `Uri.scala:640`:
     `if (head.isEmpty) throw new IllegalArgumentException("Path segment must not be empty")`
   - Runtime probe against the actual jar on this machine:
     `new Uri$Path$Segment("", Empty).toString` → `THREW: java.lang.IllegalArgumentException: Path segment must not be empty`
     (the same probe returned `New%20York*` for the non-empty case, so the probe itself is sound).

   Reachability: `RestApiConfig(endpoint = "/x/{{v}}", parameters = Map("v" -> ""))` is accepted —
   there is no validation of `parameters` values anywhere (`grep` across
   `api/`/`services/sources/` shows `parameters` only in the payload/`toDomain`/`fromDomain`
   plumbing). The throw happens inside `credentialFut.map { ... }` in `buildResolvedRequest`, so
   it produces a **failed `Future`**, not a `Left`: `doFetch`'s `flatMap` propagates it, and
   `issueAndParse`'s `.recover` is in the `Right` branch and never runs. Result is a raw exception
   escaping to the route (500) on the authoring path and a raw pipeline-run failure on the
   run-time path.

   This directly violates the contract this very file states about itself — "produce the same
   curated `Left`, **never a raw exception** (task 2.3)" (`RestApiConnectorDriver.scala:70-71`) —
   and the ticket's fail-loud posture, on an ordinary, entirely plausible input (an optional
   filter parameter whose value happens to be empty).

   Fix (one line plus a test): make `encodePathSegment` total, e.g.
   `if (value.isEmpty) "" else Uri.Path.Segment(value, Uri.Path.Empty).toString`
   (an empty substitution should splice as empty text — it cannot introduce a path segment, so
   this is safe), or, if an empty value should be rejected, return a curated
   `Left` from `resolveEndpoint` naming the variable. Add a test in
   `RestApiConnectorDriverTemplatingSpec` under 4.4 covering
   `parameters = Map("v" -> "")` with `endpoint = "/echo/{{v}}"`, asserting a completed result
   (or a curated `Left`) rather than a thrown exception — demonstrate it red first.

### Non-blocking notes

- `evaluation-1.md` overstates test 4.5: it says the credential-never-appears assertion runs
  "even under a real bearer auth flow", but that test constructs the connector with
  `authConfig = {"authType":"none"}`. The test's own in-source comment is honest about this and
  the choice is defensible (under `bearer` the credential legitimately *does* appear in the
  header, so "never appears" is unassertable there), and test 4.8 covers the real bearer decrypt
  separately. No code change needed; the evaluator's wording is the only thing that is wrong.
- Still open from skeptic-design-1/2: `parameters` is stored plaintext in `data_sources.config`
  JSONB and is echoed back unredacted (`HasSecrets[RestApiConfigPayload] = HasSecrets(Set.empty)`,
  `DataSourceProtocol.scala:381`). One sentence on the field's scaladoc saying `parameters` is
  explicitly **not** secret storage would close it. Cheap to fold into the CR1 commit.
- `resolve`/`resolveEndpoint`/`resolveJsonBody` are three near-identical copies of the same
  `replaceAllIn` + `firstUnresolved` scaffolding differing only in a `String => String`
  value transform. The evaluator flagged this too. Worth folding into one private helper when
  CR1 is fixed — note that doing so would fix CR1 in exactly one place instead of leaving the
  encoding-specific arm as the odd one out.
- Environmental (not blocking, but worth an operator note): `backend/.env` in this worktree has
  no `CONNECTOR_MASTER_KEY`, so 13 connector-credential tests fail in every local run here. The
  failures are genuinely pre-existing, but they make the backend gate permanently red locally and
  will mask a real regression in a future ticket touching these suites.

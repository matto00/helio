## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Gate chain, re-run by me (not trusted from evaluation-1.md):**
- `npm run lint` → exit 0 (`eslint . --max-warnings=0`).
- `npm run typecheck` → exit 0 (`tsc --noEmit`).
- `sbt -batch test` → `[info] Total number of tests run: 3521` / `Tests: succeeded 3521, failed 0` / `[success] Total time: 197 s`. Green.
- No frontend files in `git diff main...HEAD --stat` → no UI/design-judgment surface for this change; `DESIGN.md` review is N/A. I did not start the dev servers: every remaining AC is provable from code + the integration specs below, and there is no rendered view to look at.

**Acceptance criteria traced:**
- *"A REST source references a Connector and supplies endpoint/method/params/body"* — MET. `model.scala` `RestApiConfig(connectorId, endpoint, method, queryParams, headers, body)`; `RestApiConnectorDriver.buildResolvedRequest` composes them.
- *"No credential remains on the source"* — MET. `RestApiConfigPayload.toDomain` (`DataSourceProtocol.scala:332-334`) hard-rejects any `auth` field with 400; `fromDomain` never emits `auth`; `hasSecrets = HasSecrets(Set.empty)` with a comment explaining why the empty instance is retained.
- *"Every pre-existing REST source still fetches successfully after migration — by running real sources"* — MET, and this is the strongest part of the change. `RestSourceConnectorMigrationSpec` binds a **real** Pekko HTTP server that actually validates the credential (401 otherwise), against **real** embedded Postgres + Flyway + real `EncryptedSecretBackend`, records a pre-migration baseline response, runs the migration, and asserts the post-migration `driver.fetch` result equals the baseline — for both bearer and the api-key-in-query case. That is genuine round-trip evidence, not row inspection.
- *"Header precedence (Connector vs source) is documented **and tested**"* — **NOT MET.** See CR2.
- *"The migration is reversible, or its irreversibility is stated explicitly with reasoning"* — MET. `RestSourceConnectorMigration.scala` scaladoc carries the explicit "NOT automatically reversible" statement with reasoning, durable outside design.md (task 4.7).
- *"Wire contract updated in all four places"* — **PARTIALLY MET.** `RestApiConfigPayload`/`toDomain`/`fromDomain`, `DataSourceConfigCodec.decodeRest`/`encodeRest`, and `CreateSourceRequest` are all updated. The fifth place this ticket's own task 1.7 added — `AssistantProposalToolSchemas.scala` — is untouched. See CR1.
- *`dependentCount` genuinely reachable* — MET, and well done. `ApiRoutes.scala:449` wires `dataSourceRepo.countRestSourcesReferencing(id)`, and `ConnectorRepositorySpec.scala:337-407` exercises the real query end to end (create → dependent source → 409 `ConnectorHasDependents` → delete source → success → cross-connector isolation asserted at :407). The HEL-821 always-zero stub is genuinely retired on the live path.
- Task 5.1 (HEL-842 same-PR contract) — no new table is created by this change (application-level migration, no Flyway file in the diff), so the `RlsPolicyGuardSpec` allowlist correctly needs no edit. Confirmed, as the task asked, rather than left silent.

**Independent re-derivation of the evaluator's two non-blocking findings:** both are real, and one of them is worse than "non-blocking". Details below. Each was reproduced twice (`grep` on the file, then `git diff main...HEAD --name-only` filtered — the files return **zero** diff lines, i.e. entirely untouched).

### Verdict: REFUTE

Three tasks are marked `[x]` in `tasks.md` but are not implemented at all. This is the falsely-complete-checkbox pattern, and one of the three is a live-surface regression rather than a missing nicety.

### Change Requests

1. **`AssistantProposalToolSchemas.scala` is entirely untouched — task 1.7 is falsely marked `[x]`, and the staleness is now an active regression, not dead code.**
   `git diff main...HEAD -- backend/src/main/scala/com/helio/api/protocols/assistant/` returns **0 lines**. The file still advertises to Claude, in three places:
   - `:122-124` — `"the per-kind config payload selected by type: rest_api {url, method?, auth?, headers?}"`
   - `:305` — the same string on `test_connection`'s schema
   - `:145`, `:177`, `:276` — three worked examples whose rest config is `{ "url": ..., "method": "GET" }`

   Why this is not benign: `auth` on a REST payload is now a **hard 400** on every path this ticket touched — `RestApiConfigPayload.toDomain` (`DataSourceProtocol.scala:333`), `SourceService.testRest` (`SourceService.scala:199-200`), and `PipelineService.resolveInlineSourceSchema` (the new `case Some(payload) if payload.auth.isDefined` guard). The assistant is a live prod surface (HEL-659, real `ANTHROPIC_API_KEY` provisioned). Before this change, `auth` on an inline rest source worked; after it, the tool schema still instructs Claude to send it and the request now fails. The assistant's ability to author *any* authenticated REST source is removed with nothing telling the model. Separately, `connectorId` is advertised nowhere, so the assistant can never author a Connector-referencing source at all.

   Why the green suite did not catch it: `AssistantProposalToolSchemasSpec.scala:39-45` pins the examples only through `convertTo[RestApiConfigPayload]` (a spray-json *decode*), never through `RestApiConfigPayload.toDomain`. `url` is still an `Option` field on the payload, so the stale examples decode fine and the pin stays green while the semantics have inverted. This is evidence-shaped non-evidence — the pin does not exercise the thing that broke.

   Required: update the advertised schema/description strings and examples to the `{connectorId, endpoint, method?, queryParams?, headers?}` shape (dual-support `url` may be documented as the legacy alternative, but `auth?` must go), and extend `AssistantProposalToolSchemasSpec` to pin each rest example through `RestApiConfigPayload.toDomain` (or the executor's own conversion path) so a `Left` fails the suite — a decode-only pin will not hold this.

2. **Header precedence is documented but has zero test coverage — the AC says "documented *and* tested".**
   `grep -rn "defaultHeaders" backend/src --include=*.scala` returns matches only in `ConnectorAuthShape.scala`, `RestApiConnectorDriver.scala:124`, and `ImplicitConnectorConfig.scala:37` — **no test file anywhere references it.** Meanwhile the spec delta `specs/rest-api-connector/spec.md:114-126` asserts two concrete scenarios ("Non-colliding headers are both applied", "Source header overrides Connector default on collision") that nothing verifies.

   The implementation itself is **correct** — I read it: `RestApiConnectorDriver.scala:124`, `val mergedHeaders = authShape.defaultHeaders ++ config.headers`. Scala `Map.++` is right-biased, so the source's value wins on a key collision, exactly per design.md Decision 4. So this is not a behavior refutation; it is an unmet AC. Given that the *only* thing standing between "source wins" and "Connector wins" is the argument order of a `++`, and a future refactor would flip it silently, the AC's demand for a test is well-founded.

   Required: add the two spec-delta scenarios as real tests in `RestApiConnectorDriverSpec` (assert the composed `HttpRequest.headers`, both the non-colliding and the colliding case).

3. **`ConnectorEntityService.scala` is entirely untouched — tasks 1.2b and 2.1b are both falsely marked `[x]`.**
   `git diff main...HEAD -- .../ConnectorEntityService.scala` returns **0 lines**.
   - Task 2.1b required relaxing the empty-credential rejection to apply only when `config.authType != "none"`. `ConnectorEntityService.scala:40-41` still reads `else if (cred.isEmpty) ... BadRequest("credential is required")` unconditionally. Consequence: **there is no way to create a no-auth Connector through `POST /api/connectors`.** Since the new REST source shape is `connectorId`-based, a user pointing a source at a public/unauthenticated API cannot create the Connector it needs and is forced onto the legacy bare-`url` dual-support path — which task 6.3 records is slated for retirement. The design named this CR6 for a reason.
   - Task 1.2b required stripping/ignoring a client-supplied `config.implicit`. `ConnectorEntityService.scala:47` does `req.config.getOrElse(JsObject.empty).compactPrint` — the client's config, including any `implicit: true`, is persisted verbatim; `update` at `:69` full-replaces `config`, so a `PATCH` can flip the flag too. `ConnectorAuthShape.scala:11-12` documents the exact opposite ("never read from client-supplied config on either `POST /api/connectors` or `PATCH`; both strip/ignore any `implicit` key") — a confidently-false doc comment, the failure mode this repo has been burned by repeatedly. Impact today is low (nothing yet branches on `implicit`), so the flag is a latent, not active, defect — but it is latent *only until HEL-824's CRUD UI ships*, which is precisely when a spoofable server-owned flag matters.
   - No test anywhere covers either behavior: `grep -rn "authType" backend/src/test` returns only three unrelated hits. Both tasks' stated tests do not exist.

   Required: implement both, with the tests the tasks specify, or — if the executor believes either is genuinely out of scope — un-check the task and say so explicitly rather than leaving a `[x]` on unwritten code.

### Non-blocking notes

- `RestApiConnectorDriver.buildResolvedRequest` emits `headers = authHeaders ++ baseHeaders`. If a *source* supplies a header colliding with the auth header (`Authorization`, or the Connector's `apiKeyName`), the request carries **both** — the merge at `:124` only dedupes against `defaultHeaders`, not against the auth headers built at `:128`. Design Decision 4 arguably doesn't cover this case, so I'm not blocking on it, but "source wins on collision" is not what happens for that particular collision. Worth either deduping or documenting the carve-out.
- `RestSourceConnectorMigration.run` fires `Future.sequence(rows.map(migrateOne))` — unbounded concurrency over every `rest_api` row at boot, each doing an encrypt + two DB round-trips. Fine at current row counts; consider a bounded/sequential fold before this meets a large tenant.
- `splitUrl` uses `uri.query().toMap`, which silently collapses repeated query keys (`?tag=a&tag=b` → one entry). A legacy URL using repeated params would migrate lossily. Narrow, but it is the silent-corruption class the ticket explicitly asked to design against.
- Positive: the `__unmigrated__`/`__malformed__` sentinel bypass is genuinely closed *structurally* at `DataSourceProtocol.scala:317/341`, not by convention — round-3 CR2 landed properly.

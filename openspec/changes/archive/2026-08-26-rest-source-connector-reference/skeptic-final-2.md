## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Spawned cold. Every conclusion below is derived from the files/commands named, not from
`evaluation-1.md`, the commit message, or `tasks.md` checkboxes.

### Gate chain — re-run by me

- `sbt -batch test` → `Total number of tests run: 3535` / `Suites: completed 227, aborted 0` /
  `Tests: succeeded 3535, failed 0` / `[success] Total time: 196 s`, exit 0.
- `npm run lint` → exit 0. `npm run typecheck` → exit 0.
- The full-suite log is quiet (28 lines, no per-test names), so "3535 green" alone would not
  prove the *new* tests ran. I re-ran the four relevant suites verbosely
  (`testOnly ... -- -oD`) and read each test name execute: 31/31 succeeded, including all
  four `RestApiConnectorDriverConnectorResolutionSpec` cases, all five
  `ConnectorAuthShapeSpec` cases, `AssistantProposalToolSchemasSpec`'s new `toDomain` case,
  and all four new `ConnectorEntityRoutesSpec` cases. The tests are executed, not merely
  present.
- `git diff main...HEAD --stat` contains **zero** `frontend/` entries → no UI surface, no
  design-standard judgment applicable; `DESIGN.md` review is N/A and servers were not started.

### Round-1 findings — verified against source, not against claims

**CR1 (assistant tool schema) — FIXED, genuinely.**
`git show c2750fa0 -- .../AssistantProposalToolSchemas.scala` shows real edits.
`grep -n 'auth?' src/main/scala/com/helio/api/protocols/assistant/` returns **exit 1 / zero
matches**; the only remaining `"url"` in the file is `ProposalPanelSchema`'s image-panel URL
property (line 57), unrelated. Both description strings (`:120-126`, `:305-312`) now advertise
`{connectorId, endpoint?, method?, queryParams?, headers?}` and state auth lives on the
Connector. All three worked examples (`:147`, `:179`, `:277`) now carry
`{connectorId, endpoint, method}`.
The pin is real, not decode-only: `AssistantProposalToolSchemasSpec` now asserts
`RestApiConfigPayload.toDomain(payload) shouldBe a[Right[_,_]]` plus `payload.auth shouldBe
None` on the `test_connection` example, and a new case pins `propose_pipeline`'s inline rest
example through `toDomain` as well. I checked this is discriminating: `toDomain`
(`DataSourceProtocol.scala:333-354`) returns `Left` for a present `auth`, `Left` for a bare
`url` ("legacy-url: caller must resolve…"), and `Left` for both-present — so a regression to
either of the previously-shipped example shapes turns the pin red.

**CR2 (header precedence tested) — FIXED, with better evidence than I asked for.**
`RestApiConnectorDriverConnectorResolutionSpec` (new, 176 lines) binds a **real local Pekko
HTTP echo server** that returns every received header as JSON, against **real embedded
Postgres + Flyway + a real `EncryptedSecretBackend`/`ConnectorCredentialRepository`**, and
asserts the actually-composed request:
- non-colliding: Connector `X-Env: prod` and source `X-Request-Id: abc123` both arrive;
- colliding: Connector `Accept: application/xml` vs source `Accept: application/json` → the
  server observes `application/json` (source wins, spec-delta scenario 2).
This exercises `buildResolvedRequest` for real, not a `fetchOverride` stub. The two assertions
are value-discriminating by construction (the two merge orders yield different literals).
It also adds real bearer coverage: the credential is decrypted via `decryptForUse` and observed
as `Authorization: Bearer real-decrypted-token`.

**CR3 (`ConnectorEntityService`) — FIXED.**
- `create` (`:44`): `else if (cred.isEmpty && authType != "none")`, with `authType` read from
  the request's own `config.authType`. Absent config ⇒ `authType = ""` ⇒ credential still
  required (conservative default; correct). Covered both ways by two new route tests
  (`none` → 201, `bearer` + empty → 400), both observed passing.
- `implicit` is now server-owned through a single private helper
  `withServerOwnedImplicit(config, flag)` that both call sites funnel through:
  `JsObject(config.fields - "implicit" + ("implicit" -> JsBoolean(flag)))`. `create` pins
  `false`; `update` pins `ConnectorAuthShape.parse(existing.config).implicit`, i.e. it
  **preserves** the existing value rather than resetting to `false` — which is the correct
  behaviour for a migration-synthesized `implicit: true` Connector, and is the specific thing
  I checked for. Two new route tests observe a client-supplied `implicit: true` overridden to
  `false` on POST and a PATCH failing to flip it.

### Item 4 — the `ConnectorAuthShape` spray-json claim: verified, and the fix is right

The claim holds. The pre-fix line was `jsonFormat5(ConnectorAuthShape.apply)`; `defaultHeaders`
and `implicit` are non-`Option` fields with Scala defaults, and spray-json's derived formats do
**not** consult Scala default values — a missing key throws on read. `implicit` is introduced by
this very ticket, so **every** HEL-821-era `connectors.config` row lacks it; the throw would be
swallowed by `parse`'s outer `try` and silently coerced to `authType = "none"` with empty
`defaultHeaders`, discarding a real Connector's auth shape. That is exactly the repo's tracked
silent-corruption class. The hand-rolled `read` defaults each field explicitly, `parse`'s
scaladoc was corrected to stop over-claiming, and `ConnectorAuthShapeSpec` pins the pre-HEL-822
blob, the both-absent case, a full round-trip, and the two genuinely-malformed fallbacks. All
five observed passing.

### Independent pass (things round 1 did not cover)

- **Boot-time migration ordering claim is true, not aspirational.** `Main.scala:136` creates
  `migrationDone`; `:210-214` does `migrationDone.recover{…}.flatMap(_ => HttpServer.start(…))`
  — the server genuinely does not bind until the migration completes, and an unexpected
  migration failure logs and still starts rather than hanging boot. The comment matches the code.
- **`EnvMasterKeyProvider` resolves lazily** (`MasterKeyProvider.scala:74-85`, inside
  `wrapDataKey`/`unwrapDataKey`), so wiring it at boot cannot crash startup on a missing key.
- **Cross-tenant reachability of `ConnectorResolveContext.Internal`** (the ownership bypass) —
  checked, and it is contained. `Internal` is used only by `InProcessPipelineEngine` and the
  SQL/internal infer paths; every user-facing path (`SourceService.createRest`/`testRest`/
  `refresh`/`fetch`, `CreateSourceEnvelope`, `PipelineService`'s rest infer) passes
  `Owned(user)`, which routes to `findByIdOwned`. A foreign `connectorId` therefore cannot be
  persisted in the first place: `CreateSourceEnvelope:40` runs `inferSchema` under `Owned`
  before create. There is no source-config update route at all —
  `grep -rn updateConfigInternal src/main/scala` returns exactly two hits, the definition and
  the migration's own call — so a persisted `connectorId` cannot later be repointed at another
  tenant's Connector.
- **Sentinel bypass** stays structurally closed: `ReservedConnectorIds` is rejected inside
  `toDomain`, not by convention.
- Ticket AC "`schemas/` question resolved either way" — resolved explicitly in design.md
  Decision 9 (confirmed absent repo-wide, deliberately not added). Traced.
- No unchecked task remains in `tasks.md` (52 `[x]`, zero `[ ]`), and this round I confirmed
  each of the three previously-false checkboxes now has real code and real executed tests
  behind it.

### Verdict: CONFIRM

The three round-1 refutations are closed against source, each with executed test evidence, and
the fix cycle additionally root-caused and fixed a real silent-corruption defect of its own
plus both of round 1's non-blocking notes. The gate chain reproduces green independently. I
found nothing new that I would block on.

### Non-blocking notes

1. **Deployment prerequisite that is now genuinely due (flag to the human before the next
   `release/**` cut — not a code defect, and not a merge blocker).** This ticket is the first
   consumer that *requires* `CONNECTOR_MASTER_KEY`/`_ID` at runtime: the startup migration
   writes a `connector_credentials` row for every legacy `rest_api` source, including no-auth
   ones. Without the key, `connectorRepo.create` fails, `migrateOne`'s `.recover`
   (`RestSourceConnectorMigration.scala:161`) logs and skips, the row stays legacy, and
   `DataSourceRepository.rowToDomain:53` maps it to the `__unmigrated__` sentinel — i.e. every
   pre-existing REST source hard-fails on fetch until an operator provisions the key.
   `grep -rn CONNECTOR_MASTER infra/` returns **zero** hits (exit 1), and
   `docs/secrets-inventory.md:73-89` still reads "Provisioning still required (not done by this
   change)… Add `--set-secrets` wiring for it in `infra/deploy-backend.sh`". Not a merge
   blocker: `.github/workflows/cd-backend.yml` triggers only on `push: branches: ["release/**"]`,
   so merging to `main` deploys nothing, and the failure mode is loud (per-row `logger.error`)
   rather than silent. But the release cut must not happen before steps 1–4 of that checklist
   are done.
2. Relatedly, `CLAUDE.md`'s `CONNECTOR_MASTER_KEY` row still says "Required only once a caller
   actually writes a `connector_credentials` row (no route consumes this yet — see
   HEL-536/HEL-821)". After this change the boot-time migration is such a caller on every
   start, so that sentence is now stale. A one-line doc edit, worth folding into this PR or the
   release prep.
3. `ConnectorEntityService.create:36` / `update:81` now call `.asJsObject` on a
   `config: Option[JsValue]`. A client sending a non-object `config` (e.g. `"config": "x"`)
   previously got a 201 with the blob stored verbatim; it now throws `DeserializationException`
   into `TopLevelErrorHandlers.topLevelExceptionHandler` → 500 rather than a 400. Garbage input,
   loud failure, no route consumer yet (HEL-824 owns the UI) — but a `case o: JsObject` guard
   returning `BadRequest("config must be a JSON object")` would be strictly better.
4. `RestSourceConnectorMigration.run` still fires `Future.sequence(rows.map(migrateOne))` with
   unbounded concurrency across every `rest_api` row at boot (encrypt + two DB round-trips
   each). Fine now; consider a bounded fold before a large tenant.
5. The assistant's worked examples use the literal placeholder `"conn_example_from_find"`. A
   model copying it verbatim gets a clean curated "Connector not found", so this is safe — but
   the description could say more explicitly that the id must come from a prior `find`/
   `get_resource` result rather than being invented.

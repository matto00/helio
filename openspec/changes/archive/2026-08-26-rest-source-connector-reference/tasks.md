## 1. Domain model + wire contract

- [x] 1.1 `RestApiConfig` (model.scala): replace `url`/`auth` with `connectorId`/`endpoint`/
      `queryParams`/`body: Option[String]`; keep `method`/`headers`. Remove `RestApiAuth` usage
      from `RestApiConfig` entirely (type stays for the Connector's own stored auth shape).
- [x] 1.2 `RestApiConfigPayload`/`toDomain`/`fromDomain` (DataSourceProtocol.scala): new wire
      shape carries **both** halves of the dual-support decision (design.md Decision 1
      revised, CR3) — `connectorId` (Option, the new path) OR `url` (Option, the legacy
      bare-URL path), `endpoint`/`queryParams`/`headers`/`body` for the new path. Reject a
      request containing an auth/credential field (400) instead of ignoring it. Reject a
      request carrying **both** `connectorId` and `url` (400, "provide exactly one of
      connectorId or url" — the ambiguity guard design.md names explicitly).
- [x] 1.2a `SourceService` create path: a bare-`url` request synthesizes an implicit
      no-auth Connector (design.md Decision 1 revised) — `name = s"Auto: $sourceName"`,
      `authType: "none"`, server-owned `implicit: true` in `connectors.config` (Decision 1a
      revised, CR5) — via `ImplicitConnectorConfig.forLegacySource` (Decision 1/CR4 revised,
      shared with task 4.1) persisted through **`ConnectorRepository.create` directly**, not
      `ConnectorEntityService.create` (round-2 CR4 correction — there is no incoming
      `ConnectorCreateRequest` to validate for a server-synthesized value). Test: `POST
      /api/sources` with only `url` succeeds (matching today's `RestApiForm` behavior
      byte-for-byte), and the resulting source's config references a real, `implicit:
      true`-flagged Connector.
- [x] 1.2b `ConnectorEntityService.create`/`update`: strip/ignore any client-supplied
      `config.implicit` field and set it server-side instead (round-2 CR5) — test that a
      `POST /api/connectors` body containing `config: {implicit: true, ...}` persists
      `implicit: false` (the real default for a user-initiated create), and that `PATCH` cannot
      flip an existing Connector's `implicit` flag via a client-supplied `config`.
- [x] 1.3 `CreateSourceRequest`: update format (jsonFormat) for the new `RestApiConfigPayload`
      shape (both halves — `connectorId` and legacy `url` present as sibling `Option` fields).
- [x] 1.4 `DataSourceConfigCodec.decodeRest`/`encodeRest`: implement Decision 6's three-way
      `Either` (valid / legacy-unmigrated / malformed). Update every call site to handle it
      explicitly — never `.getOrElse` back to a zero-value config.
- [x] 1.5 Remove the now-dead `HasSecrets[RestApiConfigPayload]` auth-token/api-key secret
      fields (SecretField wiring) — no secret lives on the source payload anymore. Confirm
      whatever consumed `HasSecrets` for rest sources (e.g. audit-log scrubbing) is not left
      silently no-op'd; if it now has nothing to redact for rest_api, that's correct, not a gap
      — verify by reading the consumer, don't assume.
- [x] 1.6 `DataSourceRepository.rowToDomain`: implement the sentinel-`connectorId` handling for
      a `decodeRest` `Left` (Decision 6 revised, CR5) — `"__unmigrated__"`/`"__malformed__"`,
      once-per-source `warn` logging, row still appears in list results. Test: a legacy-shaped
      row still appears in `GET /api/sources`, and a fetch attempt against it fails with the
      curated Connector-not-found error rather than succeeding against nothing.
- [x] 1.7 `AssistantProposalToolSchemas.scala` + `AssistantToolExecutor.test_connection` (round-1 CR4):
      update the advertised `rest_api` tool schema to `{connectorId, endpoint, method?,
      queryParams?, headers?}`; update `test_connection`'s inline-config path to require a
      `connectorId`. Confirm `AssistantProposalToolSchemasSpec`/`PipelineProposalProtocol.scala`
      compile and pass against the new shape — this is a compile-breaking dependency, not a
      deferrable HEL-828 concern.
- [x] 1.8 `PipelineService.resolveInlineSourceSchema`/`resolveProposalSourceSchema` (round-3
      CR3 — a third live consumer neither round 1 nor round 2 named): thread the acting user
      (already held at line 292) down to `resolveInlineSourceSchema`; route a bare-`url` inline
      rest source through task 2a.2's `EphemeralRestConfig` path (never persists a Connector —
      a pipeline proposal is provisional), a `connectorId`-carrying one through the real
      Connector resolution. Confirm `POST /api/pipelines/apply-proposal` and
      `.../analyze-proposal` still compile and pass against the new payload shape.
- [x] 1.9 `RestApiConnectorDriver.metadata.requiredFields` (round-3 CR4, design.md Decision
      10): update to `Vector("connectorId")`; update `ConnectorRegistrySpec`'s pinned
      assertion (`rest.requiredFields.map(_.name) shouldBe Vector("url")` → `Vector
      ("connectorId")`) in this same PR rather than leaving it stale.

## 2. Connector-side request composition

- [x] 2.1 `RestApiConnectorDriver.buildRequest`: resolve `connectorId` → `Connector` (via
      injected `ConnectorRepository`) → decrypt credential (`ConnectorCredentialRepository.
      decryptForUse`) → compose `baseUrl` + `endpoint` via a normalizing join (Decision 3, not
      naive concatenation) + `queryParams` + merged headers (Decision 4: source wins on
      collision) → apply auth per Decision 3's `ConnectorAuthShape` (`authType`/`apiKeyName`/
      `apiKeyPlacement` from `connectors.config`, credential value from `decryptForUse`).
- [x] 2.1a Define `ConnectorAuthShape` (Decision 3 revised) as the JSON shape for
      `connectors.config` when `kind = "rest_api"`. Unit test: creating a bearer/api-key
      Connector never writes the string `token`/`value` as a JSON key anywhere in
      `connectors.config` (CR2 — proves the credential never lands in the non-secret column).
- [x] 2.1b Relax `ConnectorEntityService.create`'s empty-credential rejection to allow it only
      when `config.authType == "none"` (CR6) — test both the allowed no-auth case and that
      `bearer`/`api_key` with an empty credential still 400s unchanged.
- [x] 2.2 Every `ConnectorDriver[RestApiConfig]` call site (`fetch`, `testConnection`,
      `inferSchema`) now needs the acting user (to scope the Connector lookup) — thread it
      through from `SourceService`/routes; confirm the existing "own connector only" ownership
      check is exercised (`findByIdOwned`), not a raw unscoped lookup.
- [x] 2.3 Failure mode: `connectorId` resolves to nothing (deleted, wrong owner) → clear,
      curated error (never a raw exception leaking the id or an internal message), same
      curated-message convention as HEL-311's existing "Request failed"/"Failed to parse JSON
      response".

## 2a. `infer`/`test` dual-support — the UI's other two legs (design.md Decision 1c, round-2 CR1/CR2/CR3)

- [x] 2a.1 `SourceService.inferRest`/`testRest`: add an `AuthenticatedUser` parameter (round-2
      CR3 — both currently take only a payload, unlike `createRest`). Thread it from
      `SourcePreviewRoutes` (`user` is already a constructor field there — a threading fix, not
      a new capability).
- [x] 2a.2 Define `EphemeralRestConfig(url, method, headers)` (round-3 CR1/CR2 — a
      structurally distinct type, never `RestApiConfig`, never persisted, never reachable from
      `ConnectorRepository`/`DataSourceRepository`) and a
      `RestApiConnectorDriver.fetchEphemeral`/`inferSchemaEphemeral`/`testConnectionEphemeral`
      overload set that builds the request directly from it — no Connector lookup, no
      normalizing join (no `baseUrl` to join against), no auth. Bare-`url` requests to
      `/api/sources/infer`/`/api/sources/test` route through this. **Never** persists a
      Connector — this is the trap round-2 CR2 flagged (routing through Decision 1's
      create-time synthesis would create a new `connectors` row on every "Test
      connection"/"Preview schema" click).
- [x] 2a.2a `RestApiConfigPayload.toDomain` (create/update path only — not infer/test):
      validate `connectorId` is well-formed and never a reserved sentinel value
      (`__unmigrated__`, `__malformed__`) before it reaches `findByIdOwned` (round-3 CR2 —
      closes the bypass structurally: a client-supplied `connectorId` can never collide with
      an internal sentinel, and `EphemeralRestConfig` from task 2a.2 never touches
      `connectorId` at all, so there is no shared namespace to bypass). Test: `POST
      /api/sources` with `config.connectorId = "__unmigrated__"` (or any non-resolving
      sentinel-shaped string) is rejected exactly like any other unresolvable connector id —
      never silently accepted as a bypass path.
- [x] 2a.3 `connectorId`-carrying request to `/api/sources/infer` or `/api/sources/test`:
      resolve the real Connector via `findByIdOwned` (ownership-scoped, using task 2a.1's
      threaded user) — same resolution as create/fetch, still never persisting anything new.
- [x] 2a.4 Test: `POST /api/sources/infer` and `POST /api/sources/test` with only `url` (no
      `connectorId`) succeed unchanged, and assert **zero** new `connectors` rows are created
      by either call — the concrete evidence for the "ephemeral, never persisting" contract.
- [x] 2a.5 Test: `AddSourceModal`'s full existing flow (`handlePreview` → `handleCreate`) still
      works end-to-end against the new backend — this is the UI regression round-2 CR1 named
      explicitly (the precondition for ever reaching create).

## 2b. Pipeline-run connector resolution (design.md Decision 11, round-4 CR1 — a fourth live consumer)

- [x] 2b.1 `ConnectorRepository.findByIdInternal(connectorId: ConnectorId):
      Future[Option[Connector]]` — no ownership check, `ctx.withSystemContext`, mirroring
      `DataSourceRepository.findByIdInternal`'s existing, already-reviewed precedent and its
      ACL argument (the pipeline itself is the access boundary for a run, not per-artifact
      ownership).
- [x] 2b.2 Thread the new Connector-resolving `fetch` shape: `InProcessPipelineEngine`'s
      `RestSource` case → `PipelineRunService` (already holds the context needed at
      `submit`/`previewStep`/`executeRun`) → update `fetchOverride`/test seams to match. Use
      `findByIdInternal` (task 2b.1), **never** `findByIdOwned`, on this path specifically —
      `SourceService`/routes/`ConnectorEntityService` keep using `findByIdOwned` unchanged.
- [x] 2b.3 Regression test: an HEL-279 editor grantee (not the pipeline/source owner) runs a
      shared pipeline whose source is a `rest_api` referencing a Connector owned by the
      pipeline's actual owner — assert the run still succeeds (this is the capability round-4
      CR1 found would otherwise silently break, live since HEL-758).
- [x] 2b.4 Regression test: a `PipelineSchedulerService` cron-fired run (`AuthenticatedUser =
      pipeline.ownerId`) against a `rest_api` source succeeds identically to today.

## 3. `dependentCount` seam (highest-risk item — HEL-821's stub)

- [x] 3.1 `DataSourceRepository`: `countRestSourcesReferencing(connectorId: ConnectorId):
      Future[Int]` — **no `user` parameter** (round-4 CR2 correction — see design.md Decision
      5's revised reasoning: ownership is already guaranteed by the time this runs, so no
      user-scoping is needed or possible at the construction site). JSONB-extract
      `config->>'connectorId'` on `rest_api` rows, count matches, running under
      `ctx.withSystemContext`.
- [x] 3.2 Wire it into `ConnectorEntityService`'s construction at **`ApiRoutes.scala:432-439`**
      (round-4 CR2 correction — not `Main.scala`; that was wrong in the original design),
      replacing the always-zero default with `(id: ConnectorId) =>
      dataSourceRepo.countRestSourcesReferencing(id)`. Confirm `dataSourceRepo` is already in
      scope at that construction site (it is).
- [x] 3.3 Test: create Connector → create dependent rest_api source → `DELETE
      /api/connectors/:id` → assert 409 `ConnectorHasDependents`, Connector still exists.
- [x] 3.4 Test: delete the dependent source → `DELETE /api/connectors/:id` → assert success.

## 4. Migration

- [x] 4.0 Extract a shared **pure** `ImplicitConnectorConfig.forLegacySource(name, baseUrl,
      auth)` helper (round-2 CR4 correction of the original "one shared helper" framing) —
      returns the name/`ConnectorAuthShape` JSON/credential plaintext/credential name to use,
      shared by **both** task 1.2a's create-time path and task 4.1's migration path so the
      naming convention, auth shape, and `implicit: true` flag can never drift between them.
      Each call site then persists through its **own** layer (both land on
      `ConnectorRepository.create` directly, per design.md's corrected Decision 1/CR4 — neither
      goes through `ConnectorEntityService.create`, since the migration has no
      `AuthenticatedUser`/request context and the create path has no `ConnectorCreateRequest`
      to validate).
- [x] 4.0a Add `DataSourceRepository.updateConfigInternal(id: DataSourceId, config: String):
      Future[Boolean]` (round-3 CR6 — corrects the earlier design's reference to a
      non-existent `updateConfig`), running under `ctx.withSystemContext` (privileged pool, no
      request-scoped user available) — used **only** by the startup migration, never by any
      request-driven path (those go through `update(source, user)` under `withUserContext` as
      today).
- [x] 4.1 `RestSourceConnectorMigration` service: iterate `rest_api` data_sources rows, branch
      on `decodeRest`'s three outcomes (Decision 6/7) **plus a fourth: `owner_id IS NULL`**
      (round-3 CR5 — `data_sources.owner_id` is nullable, `connectors.owner_id` is not; an
      ownerless legacy row is logged at `error` and skipped, identically to the malformed
      branch, never attempted and never mis-owned). Legacy (owned) → parse via a private
      `LegacyRestApiConfigPayload`, split URL into `baseUrl`/`endpoint`+`queryParams` (reuse
      Pekko's `Uri` parser, round-tripped through Decision 3's normalizing join), synthesize a
      Connector via task 4.0's shared helper (1:1, no dedup — Decision 1; `name = s"Migrated:
      $sourceName"`, distinct from the create-path's `"Auto: ..."` prefix — Decision 1a) with
      `config` populated as Decision 3's `ConnectorAuthShape` (`authType`/`apiKeyName`/
      `apiKeyPlacement` derived from the legacy `auth` discriminator — never `"{}"`, CR1),
      rewrite the source's config via task 4.0a's `updateConfigInternal`.
- [x] 4.1a Test: seed a legacy `rest_api` row with `owner_id = NULL`; run migration; assert it
      is skipped (logged, untouched, no Connector created), never crashes startup.
- [x] 4.2 NoAuth legacy sources get an empty-string credential (Decision 7) — confirm
      `ConnectorCredentialRepository.create("")` round-trips (encrypt then decrypt back to `""`,
      not `None`/error).
- [x] 4.3 Wire into `Main.scala`'s guardian setup, after `Database.initApp`, before
      `HttpServer.start`.
- [x] 4.4 Idempotency test: run migration twice against the same seeded legacy rows; assert
      the second run creates zero new Connectors and leaves already-migrated rows unchanged.
- [x] 4.5 **Real round-trip proof (AC requirement — not a fixture-only test; CR7 methodology):**
      seed a representative legacy-shape `rest_api` source pointed at a real reachable endpoint
      (a local test HTTP server is acceptable as "real" here — dev DB has zero pre-existing
      rows to migrate against, per design.md Context) with a bearer token the endpoint actually
      validates. Fetch through the **legacy** path first and record the response (the
      pre-migration baseline). Run the migration. Fetch again through the new path and assert
      the response matches the baseline. Repeat for an **api-key-in-query** legacy source (the
      case CR1 showed was most likely to migrate into a silently-broken request) — this is the
      concrete evidence for "every pre-existing REST source still fetches successfully after
      migration."
- [x] 4.6 Malformed-row test: seed a `rest_api` source whose config is neither legacy nor new
      shape; run migration; assert it's skipped (logged, untouched), not crashed or corrupted.
- [x] 4.7 Document Decision 8's explicit irreversibility statement somewhere durable beyond
      design.md — a short note in the migration service's own scaladoc is sufficient (don't
      bury the "not automatically reversible" statement only in a planning doc that gets
      archived).

## 5. HEL-842 same-PR contract

- [x] 5.1 Confirm (per design.md Decision 2) this ticket adds no new RLS-protected table — if
      that changes during implementation, add the new table to `RlsPolicyGuardSpec`'s allowlist
      in this same PR. If it truly doesn't change, state that confirmation in the evaluator/
      final report rather than silently saying nothing.

## 6. Out-of-scope findings (record only — do not fix, do not file tickets)

- [x] 6.1 Record: `schemas/` has no per-connector-kind JSON Schema for any kind, not just
      `rest_api` (Decision 9) — a repo-wide gap, out of scope here.
- [x] 6.2 Record any other out-of-scope finding surfaced during implementation (e.g. a gap in
      HEL-826/827/828's future territory noticed along the way) for the human to triage.
- [x] 6.3 Record (design.md Decision 1b, coordinator-directed): retiring the `POST
      /api/sources` bare-`url` dual-support path, once `RestApiForm` gains a real Connector
      picker, belongs to **HEL-827** — do not file this ticket, the coordinator triages it.

## 7. Verification

- [x] 7.1 `sbt test` green, including all new tests above.
- [x] 7.2 Full-stack dev-server verification (per evaluator's own gates): create a Connector,
      create a `rest_api` source referencing it, fetch/preview/refresh all succeed; confirm no
      credential appears in any response body (browser network tab or curl).
- [x] 7.3 `openspec validate --change rest-source-connector-reference` exits 0.

## 8. Non-blocking cleanup (skeptic round 5 CONFIRM notes — small, do inline, no re-gate needed)

- [x] 8.1 Delete/requalify the stale "Missing connectorId returns 400" scenario in
      `specs/rest-api-connector/spec.md` (rest-api-connector) — it contradicts the sibling
      dual-support scenario. Keep "Missing required fields returns 400" (neither connectorId
      nor url) as the correct statement.
- [x] 8.2 Task 7.3 / any validate invocation: use `npx openspec validate
      rest-source-connector-reference` (this repo's CLI rejects `--change`), not `--change`.
- [x] 8.3 Task 2.1: wire the injected `ConnectorRepository` at `Main.scala:117` (`ctx` already
      in scope there), as an optional/defaulted constructor parameter so the 20
      `fetchOverride`-based test constructions of `RestApiConnectorDriver` keep compiling
      unchanged.
- [x] 8.4 Confirm `jsonPath` (sent by `RestApiForm.tsx` on every infer/test/create body) is
      still silently ignored by the new `RestApiConfigPayload`/`EphemeralRestConfig` readers,
      not rejected as an unknown field — task 2a.5's end-to-end check depends on this.
- [x] 8.5 `AssistantToolExecutor.VerifiedConfig.Rest(config: RestApiConfigPayload)` — confirm
      the verified-before-apply `Set` membership check still holds under the new payload shape
      (task 1.7's scope).

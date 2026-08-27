## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

Read `ticket.md`, `proposal.md`, revised `design.md` (Decisions 1, 1a, 1b, 1c, 2–9),
`tasks.md` (sections 1, 2, 2a, 3–7), both spec deltas, and `skeptic-design-1.md` /
`skeptic-design-2.md`. Then re-derived from source in the worktree.

**Round-2 CR fixes — checked against source, not prose:**

- **CR1/CR2 (infer/test dual-support)** — Decision 1c + tasks 2a.1–2a.5 now name
  `/api/sources/infer` and `/api/sources/test` explicitly and choose a non-persisting
  resolution. `SourcePreviewRoutes.scala:32-50,56-78` confirms both routes decode
  `RestApiConfigPayload` directly, so task 1.2's `url: Option` / `connectorId: Option`
  payload does reach them. **Addressed in principle** — but see CR1/CR2 below for what
  the fix left undefined.
- **CR3 (user threading)** — `SourcePreviewRoutes.scala:19-22` really does carry
  `user: AuthenticatedUser` as a constructor field, and `SourceService.scala:113,134`
  really do take only a payload. Task 2a.1 is feasible exactly as written. **Closed.**
- **CR4 (shared helper cannot be one path)** — design now states both halves persist via
  `ConnectorRepository.create`. Verified `ConnectorRepository.scala:57-66`: signature is
  `create(ownerId: UserId, name, kind, baseUrl, config, credentialPlaintext, credentialName)`
  — matches Decision 7 / task 4.0's call verbatim, and it mints the credential itself.
  The corrected claim is accurate. **Closed.**
- **CR5 (`implicit` client-settable)** — Decision 1a revised + task 1.2b make it
  server-owned on both `create` and `update`, and Decision 3's `ConnectorAuthShape` block
  now lists `implicit` in the one place the shape is defined. **Closed.**

**Fresh ground truth gathered this round:**

- `grep -rn "RestApiConfigPayload" --include=*.scala` surfaced
  `services/pipelines/PipelineService.scala:7,343` — a live consumer neither round named.
  `PipelineService.scala:338-355` (`resolveInlineSourceSchema`) calls
  `RestApiConfigPayload.toDomain(payload)` then `c.inferSchema(domainConfig)`, reached from
  `resolveProposalSourceSchema(proposal, user)` (line 306), reached from
  `POST /api/pipelines/apply-proposal` (`PipelineProposalRoutes.scala:36`) and
  `analyze-proposal` (`PipelineRoutes.scala:45`).
- `RestApiConnectorDriver.scala:23-37` — `metadata.requiredFields = Vector(url)`; served to
  clients by `ConnectorRoutes.scala:21` (`ConnectorRegistry.all`), and **pinned by a test**:
  `ConnectorRegistrySpec.scala:62-67` asserts `rest.requiredFields.map(_.name) shouldBe
  Vector("url")`.
- `DataSourceRepository.scala:81-190` — methods are `findAll(ownerId,…)`, `findByIdInternal`,
  `findByIdOwned`, `insert`, `update(source, user)`, `updateStaticPayload`, `readRawConfig`,
  `delete`. There is **no `updateConfig`**. `DbContext.scala:50,63` offers
  `withUserContext` / `withSystemContext`.
- `V35__rls_owner_only_tables.sql:34-35` — "`data_sources` (direct owner_id, **nullable**) …
  owner_id is NULLABLE (V14)". `V93__…:18` — `connectors.owner_id UUID **NOT NULL**
  REFERENCES users(id)`.

### Verdict: REFUTE

All five round-2 CRs are genuinely addressed (CR3/CR4/CR5 cleanly; CR1/CR2 partially).
Decisions 2, 4, 5, 8, 9 and the round-1 CR1/CR2/CR6/CR7 revisions still hold up against
source. But round 2's own fix (Decision 1c) introduced an underspecified sentinel that has
nowhere to carry its data and no guard against being persisted, and two live consumers plus
one migration case remain uncovered.

### Change Requests

1. **Decision 1c's ephemeral value has no field to carry the URL.** Decision 3's target
   `RestApiConfig` is `(connectorId, endpoint, method, queryParams, headers, body)` — there
   is **no `url` field**. Decision 1c (design.md:141-146) says the ephemeral path is "a
   sentinel `RestApiConfig` with `connectorId = "__ephemeral__"` … build the request as
   `url` + no auth", and task 2a.2 says "(or equivalent)". As written an implementer cannot
   construct that value: the bare URL must go somewhere (a distinct `EphemeralRestConfig`
   type, or `endpoint` carrying the absolute URL with `buildRequest` skipping the
   normalizing join against a `baseUrl` it doesn't have). Pick one concretely and say which
   — and if it is `endpoint`-carries-absolute-URL, state that the normalizing join
   (Decision 3) is bypassed in that branch, or the join will silently mangle
   `https://host/x`.

2. **The `__ephemeral__` sentinel is a resolution/ownership bypass with nothing stopping it
   from being persisted.** Decision 6's `__unmigrated__`/`__malformed__` sentinels are safe
   because they fail closed (`findByIdOwned` → `None` → curated error, design.md:342-345).
   `__ephemeral__` is the opposite: `buildRequest` special-cases it to **skip Connector
   resolution entirely**, i.e. skip the ownership check. Task 1.2 accepts any non-empty
   `connectorId` on `POST /api/sources`, and Decision 2's "referential integrity … enforced
   at the application layer (service/route, on create/update)" (design.md:222-225) has **no
   task implementing it** anywhere in tasks.md. So a client can create a source with
   `config.connectorId = "__ephemeral__"` and obtain a stored, repeatedly-fetchable
   arbitrary-URL request path that never resolves or owns a Connector. Resolve both halves:
   (a) add an explicit create/update-time task validating `connectorId` resolves via
   `findByIdOwned`, and (b) make the reserved sentinel namespace (`__ephemeral__`,
   `__unmigrated__`, `__malformed__`) unwritable from the wire — rejected at
   `RestApiConfigPayload.toDomain`, with a test.

3. **`PipelineService.resolveInlineSourceSchema` is a live, uncovered consumer.**
   `PipelineService.scala:343` calls `RestApiConfigPayload.toDomain` and
   `c.inferSchema(domainConfig)` for an inline `rest_api` pipeline-proposal source —
   reachable from `POST /api/pipelines/apply-proposal` (`PipelineProposalRoutes.scala:36`)
   and `analyze-proposal` (`PipelineRoutes.scala:45`). It breaks at compile time when the
   payload changes, and `inferSchema` will now need the acting user for connector
   resolution — which `resolveProposalSourceSchema` **has** (line 292) but does not pass
   down (line 306). Neither design.md nor tasks.md mentions `PipelineService` anywhere;
   task 1.7 covers only `AssistantProposalToolSchemas`/`AssistantToolExecutor`, and task 2.2
   says "thread it through from `SourceService`/routes". Add it explicitly, and decide what
   an inline bare-`url` rest source in a pipeline proposal now means (ephemeral, like
   infer/test? rejected? synthesized?) — this is the same decision Decision 1c had to make
   for the preview routes.

4. **`RestApiConnectorDriver.metadata.requiredFields` is test-pinned and client-facing, and
   no task updates it.** Round 1 filed this as non-blocking; it is not. `ConnectorRegistrySpec
   .scala:62-67` asserts `rest.requiredFields.map(_.name) shouldBe Vector("url")` — a test
   that must be updated or deliberately kept, and `ConnectorRoutes.scala:21` serves
   `ConnectorRegistry.all` (including these descriptors) to clients as the advertised
   required-field contract for `rest_api`. The ticket's AC is "wire contract updated in all
   four places"; this is a fifth place the contract is published. Add a task deciding what
   `requiredFields` advertises post-change (`connectorId`/`endpoint`, and whether legacy
   `url` stays listed while dual-support lives) and updating the spec accordingly.

5. **The migration has no branch for `data_sources.owner_id IS NULL`.**
   `V35__rls_owner_only_tables.sql:34-35` states plainly that `data_sources.owner_id` is
   **nullable** (since V14), while `V93` line 18 makes `connectors.owner_id` **NOT NULL**.
   Decision 7 synthesizes a Connector per legacy row via
   `ConnectorRepository.create(ownerId: UserId, …)` — there is no owner to supply for an
   ownerless legacy row, and `ctx.withUserContext(ownerId.value)`
   (`ConnectorRepository.scala:78`) has no user id to set. The ticket explicitly requires
   handling "a source whose config has no credential, a malformed one, or one already
   migrated"; this is the fourth case and it is unhandled — the row will either throw
   during startup migration or be silently mis-owned. Name the behavior (skip + `error`
   log, like the malformed branch, is the obvious choice) and add a task/test.

6. **The migration's write path is unnamed and references a method that doesn't exist.**
   Decision 7 / task 4.1 say the migration overwrites the source config "via
   `DataSourceRepository.updateConfig`". No such method exists — `DataSourceRepository`
   has `update(source, user)` (line 140), which requires an `AuthenticatedUser` the
   migration does not have (the same problem CR4 already forced you to resolve on the
   Connector side). `DbContext.withSystemContext` (`DbContext.scala:63`) is the available
   privileged path. State concretely which new repository method the migration adds and
   which context it runs under — RLS-context choice on a credential-bearing migration is
   not something to leave to implementer inference.

### Non-blocking notes

- Round 2's `jsonPath` note still stands: `RestApiForm.tsx` sends `jsonPath` on every
  infer/test/create body and today's `jsonFormat4` silently drops it. With the payload being
  rewritten (task 1.2) it is worth one explicit line confirming the new reader still ignores
  unknown fields rather than 400-ing.
- Decision 1c's "byte-for-byte what today's driver already does" claim is right only
  because the ephemeral path skips auth; once CR1 above picks a concrete carrier type, a
  test asserting the produced `HttpRequest` matches the pre-change one would make that
  claim evidence rather than assertion.

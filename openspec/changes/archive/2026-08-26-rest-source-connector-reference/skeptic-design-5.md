## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Read `ticket.md`, `proposal.md`, the full `design.md` (Decisions 1–11), `tasks.md` (sections
1, 2, 2a, 2b, 3–7), both spec deltas, and `skeptic-design-1/2/3/4.md`. Every claim below was
re-derived from source in the worktree, not from the prior reports.

### What I verified (with evidence)

**Round-4 CR1 (pipeline-run connector resolution → Decision 11 / tasks 2b.1–2b.4):**
- `InProcessPipelineEngine.scala:127-138` — `case r: RestSource => connector.fetch(r.config,
  maxRunRows)`, still no `AuthenticatedUser`. The premise holds.
- `DataSourceRepository.scala:105-107` — `findByIdInternal(id): Future[Option[DataSource]]`
  = `ctx.withSystemContext(...)`. The precedent Decision 11 mirrors is real and verbatim.
- `DbContext.scala:63-64` — `withSystemContext[R](action) = privilegedDb.run(...)` exists.
- `ConnectorRepository.scala` public methods are exactly `create`(57), `findByIdOwned`(90),
  `findAll`(97), `update`(107), `delete`(124) — **no** internal lookup today, so task 2b.1 is
  genuinely additive, not a duplicate.
- `PipelineRunService.scala:85,145,173,327` — `submit`/`executeRun`/`previewStep` all hold a
  user; `engine.loadRows(dataSource, dataSourceRepo)` (203, 360) is the seam. Threading is
  mechanical and the semantic rule (internal on this path, owned everywhere else) is pinned
  per-call-site by tasks 2b.2/2.2/2a.3. **Fix holds.**

**Round-4 CR2 (`dependentCount` → Decision 5 / tasks 3.1–3.4):**
- `ConnectorRepository.scala:124-141` — read in full: `delete(id, user, dependentCount:
  ConnectorId => Future[Int] = _ => Future.successful(0))` calls `findByIdOwned(id, user)`
  **first** and reaches `dependentCount(id)` only inside the `Some(existing)` branch. The
  revised reasoning ("ownership already verified by the time it runs") is literally true of
  this control flow.
- `api/ApiRoutes.scala:432-438` — `connectorEntityServiceOpt` really is the construction site
  (`new ConnectorEntityService(connectorRepo)`), and `dataSourceRepo` is a constructor
  parameter at line 73, in scope there. Task 3.2's corrected file/site is right. (Path is
  `api/ApiRoutes.scala`, not `api/routes/ApiRoutes.scala` — trivial.)
- The collaborator type is unchanged, so no HEL-821 edit is needed. **Fix holds.**

**Is the no-user reasoning airtight (question 1)?** I probed for a hole and found the design
is safe even where the invariant is imperfect:
- Paths that can put a `connectorId` on a source: `POST /api/sources` (ownership-validated,
  Decision 2 / task 2a.2a), the startup migration (synthesizes a Connector under the *source's*
  own `owner_id`), and `PipelineProposalService.resolveRestSource`
  (`PipelineProposalService.scala:208-216`) which routes through the same
  `SourceService.createRest`. No other writer exists: the only source mutation route is
  `PATCH /api/sources/:id` (`DataSourceRoutes.scala:81-87`), whose body is
  `UpdateDataSourceRequest(name: Option[String])` (`DataSourceProtocol.scala:107`) — **name
  only**, no config channel. Copy/rename paths (`DataSourceService.scala:498`,
  `PatchSetPreviewProjection.scala:219`) are `r.copy(name = ...)` within the same owner.
- More importantly, the query is **unscoped** (`withSystemContext`), so it can only ever
  *over*-count, never under-count. A hypothetical cross-owner reference would block the
  delete (conservative, correct) rather than allow an orphaning delete. The 409 guard is
  therefore sound independent of the invariant.

**Broad fresh grep (question 2)** over `backend/src/main` for `RestApiConfig|RestApiConfigPayload|
RestApiAuth|RestSource|decodeRest|encodeRest` produced 18 files. Every one is either covered
by a task or provably inert:
- Covered: `model.scala` (1.1), `DataSourceProtocol.scala` (1.2/1.3), `DataSourceConfigCodec`
  (1.4), `SecretField.scala` (1.5), `DataSourceRepository` (1.6/3.1/4.0a),
  `AssistantProposalToolSchemas`+`AssistantToolExecutor`+`PipelineProposalProtocol` (1.7),
  `PipelineService` (1.8), `RestApiConnectorDriver` (1.9/2.1/2a.2), `SourceService` (1.2a/2.2),
  `SourcePreviewRoutes` (2a.1 — confirmed `user` is a constructor field at
  `SourcePreviewRoutes.scala:19-22`), `InProcessPipelineEngine`+`PipelineRunService` (2b).
- **Newly checked and inert:** `api/package.scala:181-182` (type alias re-export — no field
  reference), `ConnectorDriver.scala:67,84` (scaladoc prose only), `DataSource.scala:49-55,170`
  (the `RestSource` case class wrapping `RestApiConfig` + the `"rest_api"` kind constant —
  changes with 1.1 automatically), `PatchSetPreviewProjection.scala:219` and
  `DataSourceService.scala:498` (`copy(name = ...)`, field-agnostic),
  `PipelineProposalService.scala:134,184,208-216,444` (passes the payload straight to
  `createRest`; compiles unchanged and inherits the dual-support create semantics).
  **No sixth uncovered consumer found.** Five rounds have now converged.
- `decodeRest`'s current silent degrade is real and as described
  (`DataSourceConfigCodec.scala:42-49`: `.getOrElse(RestApiConfig(url = ""))` plus two swallowed
  exception arms) — Decision 6 is fixing an actual defect, not a hypothetical one.

**Wiring reality-check on the driver (not previously examined by any round):**
`RestApiConnectorDriver` has exactly **one** production construction site
(`Main.scala:117`, where `ctx` is already in scope) and 20 test files that construct it via
`fetchOverride`, which short-circuits before any Connector resolution. Injecting a
`ConnectorRepository` (task 2.1) is therefore a one-line prod wiring change plus a
defaulted/optional parameter — not the 20-file break it could have been. `ConnectorDriver[Config]`
(the shared SPI, `ConnectorDriver.scala:91-103`, also implemented by `SqlConnectorDriver`) does
**not** need to change, because every holder (`SourceService.scala:34`,
`PipelineRunService.scala:49`, `ApiRoutes.scala:77`) types the field as the concrete
`RestApiConnectorDriver`. No cross-connector SPI blast radius. Noted below as a non-blocking
clarification, not a gap.

**Implementability as a whole (question 3):** `openspec validate rest-source-connector-reference`
→ `Change 'rest-source-connector-reference' is valid` (exit 0). Every AC traces to tasks:
connector reference (1.1/2.1), no credential on source (1.1/1.5 + spec delta), pre-existing
sources still fetch (4.5's baseline→migrate→re-fetch comparison, incl. api-key-in-query),
header precedence documented + tested (Decision 4 + spec delta scenarios + 2.1),
reversibility stated (Decision 8 + 4.7), wire contract in all four (five, per Decision 10)
places (1.2/1.3/1.4/1.9), `schemas/` resolved (Decision 9 + 6.1), `dependentCount` real
(3.1–3.4), HEL-842 contract addressed (5.1). The three reserved-value schemes
(`__unmigrated__`/`__malformed__` sentinels, the never-`RestApiConfig` `EphemeralRestConfig`,
and the decode-boundary sentinel rejection) still compose without collision. I found no
remaining reference to a method, file, or signature that does not exist.

### Verdict: CONFIRM

The two round-4 fixes are correct against source, the ownership reasoning behind
`dependentCount`'s unchanged signature is not merely plausible but fail-safe by construction,
and a sixth broad grep pass turned up no new live consumer. The design is coherent and
buildable by an executor without further orchestrator intervention.

### Non-blocking notes

1. **Stale spec scenario that contradicts its own requirement — fix in the implementing PR.**
   `specs/rest-api-connector/spec.md`, "Scenario: Missing connectorId returns 400" (`WHEN …
   no connectorId in config` → `THEN 400`) is a leftover from the pre-dual-support draft and is
   strictly satisfied by the WHEN of "Scenario: Legacy bare-url create still succeeds
   (dual-support)" (→ 201). The sibling "Scenario: Missing required fields returns 400"
   (*neither* `connectorId` nor `url`) is the correct statement and makes the stale one
   redundant. Not blocking — the requirement prose in the same section, proposal.md,
   Decision 1, and task 1.2a all unambiguously say bare-`url` must return 201 — but the
   executor should delete or requalify that one scenario rather than write a test from it.
2. Task 7.3 says `openspec validate --change <name>`; this repo's CLI rejects `--change`
   (`Did you mean --changes?`). The working invocation is
   `npx openspec validate rest-source-connector-reference`.
3. Task 2.1 says the driver resolves via an "injected `ConnectorRepository`" without naming
   the wiring site: it is `Main.scala:117` (`ctx` in scope there), and the parameter should be
   optional/defaulted so the 20 `fetchOverride`-based test constructions keep compiling.
   Note that `ApiRoutes.scala:432-438` already builds its own `ConnectorRepository` inside
   `connectorEntityServiceOpt`; a second instance from `Main` is harmless (stateless wrapper
   over `ctx`), but reusing one is tidier.
4. `RestApiConnectorDriver` lives in `domain.connectors` and would gain a dependency on
   `infrastructure.persistence.sources.ConnectorRepository`. `SourceService`/`PipelineService`
   already cross that boundary, so this is consistent with the codebase, but it is worth one
   sentence in the implementation notes rather than passing silently.
5. Round 2/3's `jsonPath` observation still stands: `RestApiForm.tsx` sends it and spray-json
   silently ignores unknown fields today. The new reader must keep ignoring rather than 400ing,
   or task 2a.5's end-to-end UI check will fail.
6. `AssistantToolExecutor`'s `VerifiedConfig.Rest(config: RestApiConfigPayload)` is used as a
   `Set` membership key; its equality semantics shift with the payload's fields. Task 1.7 covers
   the file — one assertion that the verified-before-apply match still holds would be cheap.

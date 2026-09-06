## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Ground truth read directly from the worktree at `e01aa6d4`. I did not rely on
`premise-validation.md`.

**Premise re-verification (all three CONFIRMED):**

1. *No kind check at any of the three layers.*
   - `frontend/src/features/sources/ui/forms/ConnectorSelectField.tsx:37` —
     `...connectors.map((c) => ({ value: c.id, label: \`${c.name} (${c.kind})\` }))`.
     No predicate. Confirmed.
   - `SourceService.createRest` (`backend/src/main/scala/com/helio/services/sources/SourceService.scala:91-133`)
     — the `(Some(_), None)` branch runs `RestApiConfigPayload.toDomain` then
     `rejectBodyOnSafeMethod` then `createRestWithConfig`. The Connector is never loaded.
     `RestApiConfigPayload.toDomain` (`api/protocols/sources/DataSourceProtocol.scala:388-404`)
     validates non-empty + not-a-reserved-sentinel only. Confirmed.
   - `RestApiConnectorDriver.resolveConnector` (lines 73-85) — `case Some(c) => Right(c)`,
     no `kind` inspection; `buildResolvedRequest` then decrypts and joins
     `connector.baseUrl`. Confirmed.

2. *`UpdateDataSourceRequest` is rename-only.*
   `api/protocols/sources/DataSourceProtocol.scala:129` —
   `final case class UpdateDataSourceRequest(name: Option[String])`. All 8 call sites
   grepped (`DataSourceRoutes.scala:103`, `DataSourceService.scala:538`, and the
   patch-set apply/undo/rollback/preview paths) pass or read `name` only; the patch-set
   surface reuses the same name-only type (`RefinementEditShape.scala:152` documents it
   as such). **Decision 3 is correct** — there is no reachable update path that can
   change a stored `connectorId`.

3. *The agent surface goes through `SourceService.createRest`.*
   `PipelineProposalService.scala:354-366` (`resolveRestSource`) and
   `PipelineService.scala:750-757` both call `sourceService.createRest`. I also checked
   for any *other* writer of a REST row: `grep -rn "RestSource("` over `backend/src/main`
   yields only `DataSourceRepository.scala:60` (read hydration) and
   `SourceService.scala:172` (`createRestWithConfig`). `PatchSetApplyTypes` creates only
   `StaticDataSourceRequest`. **Decision 2a's "one guard covers every surface" claim
   holds**, and the Decision 1 guarantee/affordance split is genuinely delivered by the
   plan — the server check is not weaker than claimed.

**Fixture count for Decision 4 / task 2.3 (the question asked):** 7 test files construct
a `SourceService`; only 2 exercise a `connectorId` path — `SourceServiceSpec.scala`
(lines 110/121) and `RestConnectorEgressGuardSpec.scala` (lines 261/314) — and **both
already pass `connectorRepo = connectorRepo`** (a real repo over embedded Postgres).
The two fixtures that pass no `connectorRepo` (`PipelineRootRoutesSpec.scala:124,140`,
`PipelineAnalyzeProposalRoutesSpec.scala:146`) contain zero `connectorId` references.
So fail-closed is safe and task 2.3 is effectively a no-op. Not a blocker.

**Red arm (step 1) can fire:** on current code a `sql`-kind `connectorId` flows through
`toDomain` → `rejectBodyOnSafeMethod` → `createRestWithConfig`, which inserts the row and
returns `Right(CreateSourceResponse(...))`. A test asserting a `400` goes red for the
intended reason.

**Concurrency:** `git diff --name-only main...HEAD` in the HEL-890 worktree
(`.claude/worktrees/bug/secondary-source-truncation-reporting/hel-890`) touches
`PipelineProtocol.scala`, `PipelineRunServiceSpec.scala`, and `helio-mcp/**` — **no
overlap**. HEL-973's stated ownership of the pipelines schema directory *does* collide;
see CR2.

---

### Verdict: REFUTE

Three specific revisions. The core shape (server-side guarantee at two checkpoints, UI as
affordance, no update-path check, no migration) is sound and I am not asking for it to
change.

### Change Requests

1. **Decision 5 bullet 3 and task 4.3 describe an unreachable code path — the exact
   error Decision 3 correctly refuses to make.** There is no source-edit form.
   `ConnectorSelectField` is mounted from exactly one place
   (`RestApiForm.tsx:56`), which is rendered only by `AddSourceModal.tsx:499` (a *create*
   modal); its `connector` state is
   `useRestSourceForm.ts:71 — useState<Connector | null>(null)` with no hydration from an
   existing source, and — consistent with CR-verified Decision 3 — no contract exists to
   change a stored `connectorId` anyway. The picker therefore can never be mounted with a
   pre-selected mismatched Connector. Delete "Editing a source already bound to a
   mismatched Connector…" from Decision 5 and delete task 4.3, replacing them with an
   explicit negative statement in the same style Decision 3 uses ("the picker is
   create-only; there is no edit surface that could present an already-bound mismatched
   Connector, so no such affordance is built"). *If* you believe an edit surface exists,
   name the component — do not leave the executor to build an untestable affordance.
   (Secondary, only if this survives: `Select.tsx:44` computes
   `selected = options.find((o) => o.value === value) ?? null`, so a filtered-out
   Connector renders as the bare placeholder, not as itself. The task as written would
   silently not work.)

2. **Task 5.1 / Decision 7 name contract artifacts that do not exist, and the only
   candidate collides with HEL-973.** There is no OpenAPI document anywhere in the repo
   (`find` for `openapi*` / `*.openapi.*` returns nothing; `openspec/` holds OpenSpec
   capability markdown, not OpenAPI, despite CLAUDE.md's wording). `schemas/sources/`
   contains only `field-override-payload.schema.json` and
   `static-column-payload.schema.json` — no REST-source create-request schema and no
   error documentation. The **only** schema file in the repo carrying `connectorId` is
   `schemas/pipelines/create-pipeline-request.schema.json`, which sits in the pipelines
   schema directory the coordinator explicitly declared HEL-973-owned. Revise Decision 7
   and task 5.1 to either (a) name the exact file to edit and reconcile it against the
   HEL-973 ownership boundary, or (b) record that no contract artifact describes this
   endpoint's error surface, so the OpenSpec spec delta *is* the contract record and no
   `schemas/` edit is made. Also correct `proposal.md`'s "Impact" bullet, which currently
   asserts a `schemas/` + `openspec/` edit as fact.

3. **Task 3.3's "no credential decrypted" assertion is vacuous by default and the design
   must say how to make it fail.** In `buildResolvedRequest`, `credentialRepoOpt match {
   case None => Future.successful(Right("")) }` — a driver fixture with no credential repo
   never decrypts anything, so the assertion passes whether or not the guard exists. The
   evidence plan must require the fetch-time spec to wire a **recording**
   `ConnectorCredentialRepository` (or an equivalent call-counting seam) and assert the
   recorded call count is zero. Additionally, state the mutation that proves the two
   assertions are separate axes rather than one: moving the guard from `resolveConnector`
   to *after* `decryptForUse` but *before* URI composition must fail the no-decrypt
   assertion while leaving the no-request assertion green. Without that named mutation,
   step 3's independence claim is asserted, not demonstrated. (The ordering itself is
   fine: `decryptForUse` genuinely runs strictly before `joinUrl`/`Uri` composition, so
   the two axes do exist.)

### Non-blocking notes

- Decision 4's escalation clause ("if the number of such fixtures is large enough…") is
  safe to keep but will not fire — see the count above. Consider recording the measured
  number (2, both already wired) so the executor does not re-derive it.
- Design.md cites bare filenames; the real paths are
  `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` and
  `backend/src/main/scala/com/helio/services/sources/SourceService.scala`. Worth pinning
  so the executor does not search.
- Prefer `DataSourceKind.RestApi` (`domain/model/DataSource.scala:187`) over an inline
  `"rest_api"` literal in the backend guards; the frontend filter necessarily uses the
  string.
- The 2a insertion point sits *after* `rejectBodyOnSafeMethod`, not immediately after
  `toDomain` as Decision 2a's prose implies. Harmless, but naming the exact position
  avoids a needless review round.

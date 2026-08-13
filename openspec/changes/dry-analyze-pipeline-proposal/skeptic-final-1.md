## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

Cold read, then independently re-derived every claim against the actual code/tests — not taken from
evaluation-1.md/evaluation-2.md's narrative.

**Ground truth re-established**
- `git log --oneline main..HEAD` → exactly two commits: `22519d20` (add endpoint) then `c79aab46`
  (add `validateStepKinds` guard fixing evaluation-1.md's CR1). Matches the briefing.
- `git diff main...HEAD --name-only` → backend-only (`PipelineService.scala`, `PipelineRoutes.scala`,
  `ApiRoutes.scala`, `JsonProtocols.scala`, new `PipelineAnalyzeProposalProtocol.scala`, new schema, new
  test spec) plus `openspec/**`. No `frontend/**` touched → Phase 4 (UI/design judgment) is N/A, confirmed
  independently, not just via the evaluator's `git diff --stat` claim.

**Acceptance criteria traced to code (ticket.md)**
- AC1 (projected schema, nothing persisted): `PipelineService.analyzeProposal`/`resolveProposalSourceSchema`/
  `resolveInlineSourceSchema` contain no repo-write calls, only `findByIdOwned`/`findBySourceId`/connector
  reads. `resolveProposalSourceSchema`'s existing-source branch is a structurally identical read pattern to
  the pre-existing `analyze()` method (`dataTypes.headOption.toVector.flatMap(_.fields)`, read at
  `PipelineService.scala:193`) — same reuse, not a parallel reimplementation. Test 3.2 asserts DB row counts
  unchanged before/after — ran it myself (see below), passes.
- AC2 (reuses `PipelineAnalyzeService`, no divergent engine): confirmed by reading the diff — `analyzeProposal`
  calls the unmodified `PipelineAnalyzeService.analyze` and the pre-existing `toAnalyzeStepResponse` verbatim
  (`git diff` shows zero changes to either).
- AC3 (per-step validation errors surfaced, not thrown; structurally invalid → 400): this was cycle 1's real
  gap (unguarded `IllegalStateException` for an unregistered step `type`, surfacing as an unhandled 500 — no
  `ExceptionHandler` registered anywhere in the backend, confirmed via `grep -rln ExceptionHandler
  backend/src/main/scala/` → no results). Read the cycle-2 fix directly: `validateStepKinds`
  (`PipelineService.scala:272-282`) runs `steps.find(s => !PipelineStepKind.All.contains(s.\`type\`))` as the
  *first* thing inside `analyzeProposal` (before `resolveProposalSourceSchema`, before any `stepInputs` are
  built) and short-circuits to `ServiceError.BadRequest` naming the bad type — exactly mirroring the existing
  `addStep` guard (`PipelineService.scala:433-436`), which I diffed against side-by-side. This makes
  `toAnalyzeStepResponse`'s throwing re-decode path provably unreachable for an unregistered kind. Regression
  test present (`PipelineAnalyzeProposalRoutesSpec.scala:313-332`) and green (see gates below).
- AC4 (inline SQL non-SELECT rejected pre-analysis): `resolveInlineSourceSchema`'s `sql` branch calls
  `SqlConnector.checkQuery` before `SqlConnector.inferSchema` (`PipelineService.scala` inline-sql branch).
  Test 3.5 deliberately pairs a DDL query with an unreachable port (port 1) — if `checkQuery` were skipped,
  the result would be `BadGateway` (502) not `BadRequest` (400), so the test's 400 assertion is a real
  discriminator, not a coincidence. Ran it myself, passes.
- AC5 (RLS-scoped 403/404): `resolveProposalSourceSchema`'s existing-`sourceId` branch calls
  `dataSourceRepo.findByIdOwned`, which I read directly (`DataSourceRepository.scala:116-121`) — filters on
  `r.ownerId === ownerUuid` *and* runs inside `ctx.withUserContext` (RLS `SET LOCAL`), i.e. double-enforced
  at both the app-query and Postgres-RLS layers. `None` → `ServiceError.NotFound` (404, no existence leak),
  matching the codebase-wide convention. Test 3.9 seeds a cross-user source and asserts 404 with no
  `secret_field` leak in the body — ran it myself, passes.
- AC6 (schema conformance, `sbt test` green): ran `sbt test` myself fresh in this worktree — **2488/2488
  passed, 146 suites, 0 failed** (identical to evaluation-2.md's claimed count). Also ran the new spec in
  isolation: **12/12 passed**. Test 3.11 validates a real `pipelineAnalyzeProposalResponseFormat.write(...)`
  output against `schemas/pipeline-analyze-proposal-response.schema.json` via the existing
  `JsonSchemaValidation` harness — read the schema file directly: its `AnalyzeProposalStep` `$defs` entry
  requires `type` (string discriminator) + `config` (object, `additionalProperties: true`), matching the
  actual `analyzeStepResponseFormat.write` wire shape (`type` + nested object `config`, no `op`) — genuinely
  a different, correct shape from the sibling `pipeline-analyze-response.schema.json`'s stale
  `op`/string-`config` `$defs.AnalyzeStep` (design.md D6), which I also opened to compare.
- AC7 (additive, existing `/analyze` unchanged): `git diff main...HEAD -- backend/src/main/scala/com/helio/services/PipelineService.scala`
  shows the existing `analyze()` method's body is untouched (diff hunk starts at its closing brace,
  `analyzeProposal` is inserted purely after it). Route ordering verified in `PipelineRoutes.scala`:
  `path("analyze-proposal")` is registered *before* `path(PipelineIdSegment / "analyze")` and
  `path(PipelineIdSegment)`, consistent with design.md D5 (`PipelineIdSegment` is an unconstrained `Segment`
  matcher that would otherwise swallow the literal segment).

**Gates re-run myself, fresh, in this worktree (not trusted from the evaluator's paste)**
- `cd backend && sbt "testOnly com.helio.api.routes.PipelineAnalyzeProposalRoutesSpec"` → 12/12 green.
- `cd backend && sbt test` → **2488 tests, 146 suites, 0 failed, all passed** — matches evaluation-2.md's
  reported count exactly (2487 in cycle 1 + 1 new regression test in cycle 2).
- `node scripts/check-scala-quality.mjs` → clean; only pre-existing soft file-size warnings (85), one of
  which is the new test spec itself (419 lines) — informational per CONTRIBUTING.md, not a gate failure.
- `node scripts/check-schema-drift.mjs` → "schemas in sync with JsonProtocols (38 checked)".
- `node scripts/check-openspec-hygiene.mjs` → only the expected "not yet archived" notice (this change
  hasn't reached the archive step).
- Inline-FQN scan of the diff (`git diff main...HEAD -- backend/src/main/scala | grep 'com\.helio\.'`) →
  every hit is a top-of-file `import`, none is an inline qualifier. Confirms the `check-scala-quality.mjs`
  result independently.

**Design-doc fidelity spot-checks**
- D2 precedence (`sourceId` wins over inline `type`): `resolveProposalSourceSchema` matches
  `proposal.source.sourceId` first, falling to `resolveInlineSourceSchema` only on `None` — read directly,
  confirmed; test 3.12 exercises it.
- D2 config-absent guard: all three connector-backed branches (`sql`/`rest_api`/`static`) match their config
  `Option` for `None` *before* touching the payload, returning `ServiceError.BadRequest` — read directly,
  no unguarded `.get`.
- D4 response shape: `PipelineAnalyzeProposalResponse` carries no `id`/`outputDataTypeId`, matches the
  schema's `required` list exactly.
- `ServiceResponse.completeError` (`ServiceResponse.scala:69-79`) confirmed `BadRequest`→400, `NotFound`→404,
  `BadGateway`→502, `InternalError`→500 — the error-channel mapping the service layer relies on is real, not
  assumed.

**Process note (not a code defect, but worth recording)**: `workflow-state.md` documents an anomaly during
the *design* gate (a skeptic spawn the harness reported as failed but that kept running and directly edited
`design.md`/`tasks.md`/`proposal.md` outside a skeptic's report-only mandate, producing an unrequested
`skeptic-design-3.md`). This was independently re-verified by a second, genuinely fresh skeptic spawn
(`skeptic-design-4.md`, CONFIRM) before Execution proceeded. I skimmed `skeptic-design-4.md` myself — it is
a legitimate, evidence-grounded report with no injected content, and its claims about the codebase (route
ordering, config-absent reachability, precedence) all check out against the same files I independently read
above. `git log` for this branch shows only the two expected commits, so nothing from that anomaly leaked
into the delivered code. Flagging for visibility only — does not change my verdict.

### Verdict: CONFIRM

Every acceptance criterion traces to real, working code and a passing test that actually exercises it. The
cycle-1 gap (unguarded `IllegalStateException` → unhandled 500 for an unregistered step `type`) is genuinely
fixed, not just claimed — I read the guard, confirmed it runs before the throwing path is reachable, and
reproduced the regression test passing. Full suite (2488/2488) and all quality/drift/hygiene gates reproduced
clean in my own run. No frontend changes, so no UI/design judgment applies this round.

### Non-blocking notes

- `PipelineService.scala` is now 712 lines (542 on `main`), past CONTRIBUTING.md's ~400-line "propose a
  split in the PR description" threshold. design.md D1 already reasons explicitly about keeping
  `analyzeProposal` on `PipelineService` rather than a new service class, which substantively satisfies the
  intent of that convention — but the PR description itself doesn't carry that one-line acknowledgment.
  Worth adding when the PR is opened; not blocking given the documented rationale already exists in-repo.
- `resolveInlineSourceSchema`'s catch-all branch (`case _ => BadRequest("source must reference an existing
  sourceId or declare an inline type")`) fires for a structurally-valid-but-out-of-scope inline `type`
  (`text`/`pdf`/`image` — all real `DataSourceKind.All` members per `ConnectorRegistry`, just not among the
  three connector-backed branches this ticket implements). The message reads as if no type was declared at
  all, which is slightly misleading for that specific case. Out of ticket scope (only `sql`/`rest_api`/
  `static`/`csv` are named in proposal.md/design.md) and not tested against, so not a defect — just a minor
  message-clarity polish opportunity for a future ticket if inline `text`/`pdf`/`image` proposals become
  supported.

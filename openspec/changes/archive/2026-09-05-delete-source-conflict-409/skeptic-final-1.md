## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Scope / no migration.** `git diff ee84786b~1...HEAD --stat` — 22 files, backend + change-dir
only. No path under `backend/src/main/resources/db/migration/` (task 5.3). No `frontend/**`
changes, so no UI/design gate applies. (`git diff main...HEAD` is noisy only because the local
`main` ref is stale by three already-merged commits; the two-commit range is clean.)

**Root cause matches the probe, not the ticket's FK theory.** `probe.md` records SQLSTATE
`P0001` from `hel913_prevent_zero_root_pipelines` (V99). The fix keys on exactly that:
`DataSourceService.isZeroRootViolation` requires `getSQLState == "P0001"` **and** the message to
contain both `HEL-913` and `zero roots` — SQLSTATE plus signature, never message text alone
(task 3.2). No FK/23503 handling anywhere.

**Sole-root-only scope is actually implemented, not any-reference.**
`DataSourceRepository.soleRootDependentPipelines` groups over *all* of a candidate pipeline's
roots and requires `HAVING count(*) = 1 AND bool_and(r.data_source_id = <id>)`. A pipeline with
2+ roots is excluded by construction. `WorkspaceTeardownRepository.sourceDependentPipelineConflict`
(the any-reference query) is deliberately not reused. Runs under `ctx.withUserContext`.

**Conflict carrier is the wrapper, not a packed message string.**
`DataSourceDeleteError(conflict: Option[DataSourceDeleteConflict], err: ServiceError)` in
`services/sources/DataSourceDeleteError.scala`; four named fields on
`DataSourceDeleteConflict`. `DataSourceRoutes.completeDelete` branches on `Some(c)` /
`None`, and **both** branches call `ServiceResponse.statusCodeFor(err)` — the status switch is
not duplicated (task 4.1). Confirmed `statusCodeFor(ServiceError.Conflict(_)) => 409` at
`api/routes/ServiceResponse.scala:81`.

**CR1 semantics land correctly.** `soleRootConflict` emits `resourceKind="data_source"` with the
SOURCE's own `id`/`name`; blocking pipelines appear only in `reason`/`message`. I verified the
cited precedent myself rather than trusting the report:
`WorkspaceTeardownRepository.scala:125` is `resourceKind = "data_source"` with the pipeline named
only in `reason` (line 128). The spec delta says the same. Race path passes the same `source`, so
`resourceId`/`resourceName` cannot be a pipeline id on any path (CR2 closed structurally, not by
a second patch).

**Assertion was tightened, not loosened, between cycles.** `git show f0f0a500 -- backend/src/test`
changes `"pipeline"`/`pipelineId` to `"data_source"`/`sourceId` — still three exact-equality
assertions plus `message == reason`. Field-level, not substring-over-a-blob (task 5.0).

**Red-before-fix evidence is real.** `evidence/red-before-fix.txt` reports
`500 Internal Server Error was not equal to 409 Conflict (DataSourceRoutesSpec.scala:859)`.
`sed -n '855,862p'` on the current file shows line 859 is exactly
`status shouldBe StatusCodes.Conflict` — the capture pins the precise assertion line and the
five test names in the capture match the five that exist today. The failure mode (500, not a
diff in body fields) is what a missing fix produces, not a fixture artifact.

**Controls are genuine.** The multi-root control asserts **204**; an any-reference implementation
would return 409 there and fail it. The unreferenced control asserts 204. Both passed pre-fix per
the red capture, which is consistent with the pre-fix code having no pre-check at all.

**Fresh gates I ran myself (not relied on from evaluation-*.md):**
- `sbt -batch "testOnly ...DataSourceRoutesSpec -- -z \"DELETE /api/data-sources\""` → 5/5 pass,
  including the 409 test and both controls (real Postgres, real routes).
- `sbt -batch "testOnly *PatchSet* *Teardown* *V99* *DataSourceServiceSpec *PipelineProposal*"` →
  215/215 pass (the callers whose signatures changed).
- `sbt -batch test` (full backend) → **3836 tests, 253 suites, 0 failures**, 4m29s.
- `node scripts/check-scala-quality.mjs` → clean (156 soft warnings, all pre-existing size nits).
- `node scripts/check-openspec-hygiene.mjs` → clean.

**Non-leak.** `reason`/`message` are constructed literals; no SQLSTATE, no driver text, no raw
`HEL-913` trigger string can reach them. The race path logs the `PSQLException` at WARN with the
source id before mapping.

**Caller sweep.** `grep` for `dataSourceService.delete` finds 5 call sites; the three that care
were updated (`PatchSetApplyForward`, `PatchSetApplyRollback`, `PatchSetUndoService`, all via
`.err`). `PipelineProposalService:428/551` already discarded the `Either` with `.map(_ => ())`
pre-change — behavior there is unchanged except that a sole-root delete during proposal rollback
now yields a `Left` instead of a failed Future, which is strictly less explosive.

### Verdict: CONFIRM

### Non-blocking notes
1. The **pre-check** rejection path emits no log line at all (only the race path logs at WARN).
   The spec's "backend log records the underlying cause" is satisfied where a DB cause exists, but
   an operator watching logs sees nothing for the common 409. A single INFO/WARN on the pre-check
   branch would close that observability gap.
2. `bool_and(r.data_source_id = <id>)` in `soleRootDependentPipelines` is logically redundant given
   the `IN (...)` subquery plus `HAVING count(*) = 1`. Harmless and arguably self-documenting; not
   worth a change now.
3. The multi-root control asserts only the 204 status, not that the source row is actually gone
   (the sole-root test does assert survival via `GET /api/data-sources`). A follow-up `GET`
   assertion there would make the control slightly stronger.

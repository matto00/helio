## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 5de358368682c13f13c9d02c124e22a846b4c2f1 (base resolved live: bcb0e891923094c1a1e85ecc053f30a73ee6d70f).
Evidence logs (run dir, not in the repo): `/home/matt/Development/helio/.concertino/runs/HEL-1475/HEL-1475-eval-head.log`,
`HEL-1475-eval-revert.log`, `HEL-1475-eval-mut-pipelinedelete.log`.

### Phase 1: Spec Review — FAIL

Checked and passing:
- AC1: `PipelineRootWrites.addRoot` now runs `findByIdOwned` + `pipelineRootRepo.add` under `InlineSourceCompensation.compensating`
  (`PipelineRootWrites.scala:372-378`); an existing-`sourceId` root records nothing, so nothing is deleted. Cycle guard
  recorded as not reachable for a fresh inline id, with a 201 reproduction test (`InlineSourceLeakPathsRoutesSpec`).
- AC2: implicit Connector removed in single-call create, addRoot, patch-set mid-set rollback and the proposal service's
  own cleanup (`ResolvedSource.implicitConnector`). Public `rollback(response, user)` passes `false` (descoped, follow-up 4.5).
- AC3: `SourceService.cleaningUpOnFailure` around both post-insert envelopes; bare-url `createRest` deletes its Connector on
  any failure after `connectorRepo.create`. The original exception is re-raised. The `fetchError` guard still keeps the source.
- AC4: no undo behaviour change (follow-up 4.1 is in tasks).
- AC5 code: count mismatch -> warn, delete nothing, `unrecoverable`; missing `dataSourceId` -> warn, skip, others deleted,
  `unrecoverable` (`PatchSetApplyRollback.scala:220-246`). The count rule applies only when the request has an inline root (2.7a).
- AC6: the not-crash-atomic note is in the `InlineSourceCleanup` doc comment.
- Prod count queries (a) and (b) are read-only, and (b) is labelled an upper bound.
- Constraints C1-C8: honored (C1/C2/C5/C4 verified in Phase 2).

Issues:
1. **AC5 test is vacuous for "no source delete attempted"** (see Phase 2, issue 1). AC5 explicitly requires the test to cover that.
2. **The spec scenario "Schema write fails after the insert via POST /api/sources" is not exercised through that route, and it
   overstates.** `SourceCreatePostInsertCleanupSpec` calls `SourceService.createSql`/`createRest` directly; no test sends
   `POST /api/sources`. Also, the scenario's `connectors` clause cannot happen through `POST /api/sources`: `SourceRoutes.scala:46-58`
   (HEL-828) rejects a bare-`url` REST create with 400 before reaching the service, so no implicit Connector is ever created
   on that route. Bare-url `createRest` is only reachable through internal callers (inline pipeline roots, the proposal service).
   design.md Decision 5 allows service-level proof only "...and say why". Neither red-evidence.md nor the spec says why.
   The fix itself does apply to the route, because `SourceRoutes` is a thin shell over `createSql`/`createRest`. The problem
   is the evidence and the spec wording, not the code.

### Phase 2: Code Review — FAIL

Gates (fresh, my own runs; backend-only diff, so frontend gates are N/A):
- Targeted `nice -n 19 sbt -batch testOnly` on HEAD: the 6 new or changed specs plus related existing ones (`PipelineCreateOrphanSourceRoutesSpec`,
  `PipelineRootRoutesSpec`, `PatchSetApply*Spec`, `SourceServiceSpec`, `PipelineProposalService*Spec`) gave **214 succeeded, 0 failed**,
  `[hel1468-guard] ScalaTest summary: failed=0`.
- **Revert check (claim 1):** I created a throwaway detached worktree at HEAD, restored `backend/src/main` to the base, and kept
  the new specs. The 4 leak-path specs gave **11 failed / 5 succeeded** (`[hel1468-guard] failed=11`). The failing tests are
  exactly the RED rows in red-evidence.md (path 1: 1, path 2: 5, path 3: 3, path 5: 2). The 5 passing ones are the declared guards.
  So the red-first claim is reproduced, and the specs fail again if the fix is reverted. The throwaway worktree was removed afterwards.
- I did not re-run full `sbt testFull`. I accepted the executor's recorded run (`HEL-1475-testFull.log`: 6822 succeeded, 0 failed,
  `[hel1468-guard] failed=0`). Its mtime matches the commit time (04:46). This mtime-based claim has no self-authenticating
  substitute, so it is labelled as one. My targeted run independently covers every changed path.
- `npm run check:scala-quality`: clean (soft size warnings only, all on files that were already over budget).
- Claim 2 (Connector delete): confirmed. `ImplicitConnectorCleanup.deleteIfAuto` calls `connectorRepo.delete(id, user,
  dataSourceRepo.countRestSourcesReferencing)`, which is the same dependents seam `ApiRoutes.scala:650` wires. It never uses the
  always-zero default. The delete also removes the credential row (`ConnectorRepository.scala:283-310`), and the name check
  `Auto: <source name>` matches `createRest`'s synthesis. The dependents guard is exercised ("keep the Auto Connector when a second
  source references it"), and the executor's own mutation log shows that test going red when the guard is broken.
- Claim 4: no inline FQNs in added lines (grep plus the scala-quality check); every new embedded-PG spec uses `VerifiedEmbeddedPostgres.start`;
  `[hel1468-guard]` is present in every sbt run.
- Claim 5: no changes under `domain/engine/**`, `db/migration`, `schemas/`, `api/protocols`, `api/routes` (main) or `frontend/`.
  Success responses, error statuses and messages are unchanged.

Issues:
1. **The pipeline-delete-fails guard cannot fail** (`PatchSetInlineRootRollbackSpec.scala`, test "report unrecoverable and
   attempt no source delete when the pipeline delete fails (guard)"). I tested this with a mutation: at
   `PatchSetApplyRollback.scala:143` I changed the `Left(err)` branch to call `deleteInlineRootSources(...)` (that is, to
   attempt the source delete) while still returning `unrecoverable`. The whole spec stayed green: 5/5,
   `HEL-1475-eval-mut-pipelinedelete.log`. The cause is that the test makes the pipeline delete fail by passing a random
   `newId`, so the REAL pipeline still exists and still roots the inline source. Any attempted source delete is then refused
   by the HEL-989 reference check, and the count stays at +1 either way. So the "no source delete attempted" half of AC5 is
   not actually tested.

Non-mechanical notes (no change needed): `null`-sentinel wiring for `inlineSourceCleanup` follows the existing
`sourceService == null` convention, and `PatchSetApplyRollback` turns a null into a logged `unrecoverable`, not a silent skip
(satisfies 2.7b). DRY is good: `compensatingInlineSources` was generalized into `InlineSourceCompensation`, not copied.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes.

### Overall: FAIL

### Change Requests
1. `backend/src/test/scala/com/helio/services/patchsets/PatchSetInlineRootRollbackSpec.scala`, test "...attempt no source delete
   when the pipeline delete fails (guard)": make an attempted delete observable. For example, after `forwardCreate`, delete the
   real pipeline yourself (`pipelineService.delete(PipelineId(summaryId), user)`), then roll back with that same `newId`. The
   rollback's pipeline delete then returns `Left` (not found), and the inline source is now unreferenced, so an attempted
   delete WOULD drop the count. Alternatively, inject a `DataSourceService` spy that counts `delete` calls and assert zero.
   Then show the mutation above turning it red (record it in red-evidence.md as a guard proven failable).
2. Scenario "Schema write fails after the insert via POST /api/sources"
   (`specs/inline-source-create-atomicity/spec.md`): do one of these:
   - (a) Add a route-level test. Mount `SourceRoutes` over a `SourceService` built on the fault-injected `DataSourceRepository`,
     `POST /sources` with a `sql` body (and a `connectorId` REST body), then assert the error status and that the exact-owner
     `data_sources` count is unchanged.
   - (b) Reword the scenario to the service level, and state in the spec and in red-evidence.md that a bare-url REST create
     cannot reach `createRest` through `POST /api/sources` (400 at `SourceRoutes`, HEL-828), so the `connectors` clause is
     proven at service level, and why.

   Either way, the `connectors` clause must not be attributed to `POST /api/sources`.

### Non-blocking Suggestions
- The addRoot scenario says "the same error status and message as before". The test checks only the 500 status. Asserting
  the body would pin the "original error unchanged" claim.
- `SourceService.scala` (483 lines) and `PipelineProposalService.scala` (603 lines) were already over the ~400-line split
  threshold and grew slightly. Mention a split in the PR description, per CONTRIBUTING.md.

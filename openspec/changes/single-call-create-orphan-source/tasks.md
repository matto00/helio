## Standing Constraints

- [C1] Every orphan test counts `data_sources` rows by the exact test owner id before and after the request and asserts equality alongside the expected status; status-only assertions do not count as proof.
- [C2] Red-first: each new orphan test is measured failing on the WHOLE pre-fix tree (origin/main code, new test only) before the fix; record the failing output in the evaluator-visible evidence.
- [C3] Single-call create keeps running as the user (`runTransactionally`/`withUserContext`); compensating deletes go through `DataSourceService.delete(id, user)`, never a privileged pool or raw SQL.
- [C4] On the direct POST /api/pipelines route no status code or message of an existing single-error failure class changes; pre-flight and in-transaction checks share helpers. Patch-set apply/preview pipeline-create changes are explicit (Decision 3)

## 1. Red tests (pre-fix)

- [x] 1.1 Add an embedded-Postgres route spec (e.g. `PipelineCreateOrphanSourceRoutesSpec`) wiring `PipelineService` with real `SourceService`/`DataSourceService` so inline roots work; inline `dataset` root; cases: bad step config (422), unknown step type (400), Output config with a disallowed key (400), Output `fieldMapping` naming an absent column (400), two roots where root 0 is inline and root 1 names an unknown `sourceId` (404) -- as TWO cases, (a) simple path (no steps/outputs) and (b) transactional path (with a valid step). Each asserts status AND zero new `data_sources` rows for the exact owner id. Verify: run on the pre-fix tree, every orphan assertion fails (record output).
- [x] 1.1a Lane-ordering regressions (C4) with an inline root: a step whose lane `secondaryInput` names a clientId absent from the request still returns 422 with today's "does not exist in this request" message; a lane self-reference still returns today's 400 message; both leave zero new `data_sources` rows. Verify: status/message assertions pass on the pre-fix tree (they pin current behavior), the row-count assertion is red on it.
- [x] 1.1b Service-level failed-Future case: `PipelineService` with a stub repo whose post-creation call (e.g. the transactional path's `findByIdOwned` re-lookup, or `findByIdInternal` used by `resolveSecondarySourceSchemas` -- the latter only runs if the request includes a join/union/lookup step, so include one, else the throwing branch never runs, and separately the simple path's `pipelineRepo.create`) returns a failed Future; assert the inline source is deleted and the ORIGINAL exception is re-raised. Verify: red on the pre-fix tree (source survives).
- [x] 1.2 Add a patch-set apply case (spec wires `PipelineService` with real `sourceService`/`dataSourceService`, as `PipelineRootRoutesSpec` does) (pipeline `create` edit with inline root + unknown step type, and + bad Output config key) asserting refusal with nothing applied and zero new `data_sources` rows. Verify: red on pre-fix tree (record output).

- [x] 1.3 Patch-set mid-set rollback: apply a set whose first edit is an inline-root pipeline create (valid) and whose later edit fails; assert the pipeline AND its inline source are gone and zero new `data_sources` rows remain. Verify: red on the pre-fix tree.
- [x] 1.4 Patch-set PREVIEW of the same inline-root pipeline-create edit with an unknown step type / disallowed Output config key is refused (4xx, `edit N: ` prefix) instead of today's 200 projection; zero new `data_sources` rows. Verify: status assertion red on the pre-fix tree.

## 2. Fix

- [x] 2.1 Extract the pure request pre-flight (Decision 1), run at position 3 of design.md's "Exact sequence", reusing shared per-step/per-Output check helpers also used by `buildStepsAction`/`buildOutputsAction`; call it in `create` before any root resolution that writes. Verify: 1.1 request-only cases green; existing `PipelineCreateStepConfigRoutesSpec` and other pipeline create specs unchanged and green.
- [x] 2.2 Split root resolution (positions 2 and 5 of design.md's "Exact sequence") into read-only pass (existing `sourceId` ownership + inline spec shape) and inline-creation pass run after pre-flight and `validateStepCrossOwnerRefs`; track created inline ids. Verify: 1.1 multi-root case green.
- [x] 2.3 Compensating delete (Decision 2) on every post-creation `Left`/failure, both simple and transactional paths, original error preserved, cleanup failure logged. Verify: 1.1 `fieldMapping` case green; add a GUARD (not red-first; label it so) where cleanup itself fails and the original error is still returned, and show it can fail by temporarily removing the original-error preservation.
- [x] 2.4 `resolvePipelineCreate` uses the shared pre-flight (Decision 3). Verify: 1.2 green; existing patch-set specs green.
- [x] 2.5 `PatchSetApplyRollback` `PipelineCreate` branch deletes inline-created root sources after the pipeline (Decision 3a). Verify: 1.3 green.
- [x] 2.6 Update the two docstrings Decision 2 falsifies (`create`'s HEL-906 transaction narrative; `resolveOneRootSourceId`'s "no undo step"). Verify: grep shows neither stale claim remains.

## 3. Verification

- [x] 3.1 Live probe on the worktree dev backend with a throwaway user: inline-root single-call create with a bad step config returns 422 and `GET /api/data-sources` count is unchanged; repeat for unknown type and bad Output config. Record every created id; delete only by exact id; never use matt@helio.dev. Verify: probe transcript in evidence.
- [x] 3.2 Full backend suite (`sbt -J-Xmx3g testFull`, confirm the `[hel1468-guard]` line) and pre-commit hooks green. Verify: command output.

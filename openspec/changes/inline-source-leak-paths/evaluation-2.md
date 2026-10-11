## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: c123f42392801ac1d9cec9314c9c3c8bcb776b73 (base resolved live: bcb0e891923094c1a1e85ecc053f30a73ee6d70f).
Evidence logs (run dir, not in the repo): `/home/matt/Development/helio/.concertino/runs/HEL-1475/HEL-1475-eval2-head.log`,
`HEL-1475-eval2-mut.log`.

### Phase 1: Spec Review — PASS
Issues: none. Both cycle-1 change requests are resolved:
- **CR1 (AC5 guard):** the test now deletes the real pipeline first, then rolls back with that same id. The rollback's own
  pipeline delete returns `Left` (not found) while the inline source is unreferenced, so an attempted source delete is now observable.
- **CR2 (scenario wording):** the "via POST /api/sources" scenario now covers only SQL and REST-with-`connectorId`, and only
  the `data_sources` count. The bare-url Connector clause moved to a new service-level scenario that cites HEL-828 (the route
  rejects bare `url` with 400). red-evidence.md records the reason.
- The addRoot body-assertion suggestion (non-blocking in cycle 1) was declined with a reason: a sealed 500 body is generic,
  and the service-level specs already assert that the original exception message is re-raised. I accept that reason.

### Phase 2: Code Review — PASS
- `git diff 5de358368..c123f4239 -- backend/src/main` is empty: no production code changed. The cycle-1 production review and
  the executor's recorded `testFull` (6822 succeeded, 0 failed, `[hel1468-guard] failed=0`) therefore still apply to this
  production tree. That `testFull` ran on 5de358368. The only cycle-2 changes are two test files, the spec and red-evidence.md.
- Fresh targeted run on HEAD: `PatchSetInlineRootRollbackSpec`, `SourceCreatePostInsertCleanupSpec`,
  `InlineSourceLeakPathsRoutesSpec` and `InlineSourceLeakApiRoutesWiringSpec` gave **17 succeeded, 0 failed**,
  `[hel1468-guard] failed=0`.
- **Independent mutation check**, run in a throwaway detached worktree at c123f4239 (removed afterwards):
  - (a) My cycle-1 mutation: at `PatchSetApplyRollback.scala:143` the pipeline-delete `Left` branch also calls
    `deleteInlineRootSources`. The guard now FAILS: `3 was not equal to 4` (`PatchSetInlineRootRollbackSpec.scala:195`).
  - (b) I neutralized `SourceService.cleaningUpOnFailure` into a pass-through. The new route-level `POST /sources` test FAILS:
    `6 was not equal to 4` (`SourceCreatePostInsertCleanupSpec.scala:168`, both the SQL and the REST-with-`connectorId` rows
    leak). The service-level createSql and createRest cases also fail (1 vs 0, 2 vs 1).
  - Combined run: `[hel1468-guard] failed=4`, 6 succeeded. The 6 are the other rollback cases plus the fetch-error guard and
    the bare-url insert-fails case, which (b) does not touch.
- New test code: imports only, no inline FQNs. It reuses the existing fault-injected repository and `ImplicitConnectorConfig`
  fixture pattern (DRY).

### Phase 3: UI Review — N/A
Backend and openspec only; no UI trigger paths changed.

### Overall: PASS

### Non-blocking Suggestions
- Carried over from cycle 1: `SourceService.scala` and `PipelineProposalService.scala` are above the ~400-line split threshold.
  Mention a split in the PR description, per CONTRIBUTING.md.
- The executor committed `evaluation-1.md` into the branch. That is fine as a change artifact; just make sure the archive step
  carries both evaluation reports consistently.

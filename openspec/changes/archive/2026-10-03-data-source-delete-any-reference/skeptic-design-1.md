## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Read ticket, proposal, design, tasks, spec delta. No TODO/TBD placeholders; owner ruling any-reference followed.
- DataSourceService.delete (lines ~626-660): confirmed soleRootDependentPipelines then soleRootDependentPipelineCountPrivileged precede deleteFileF (inside deleteAfterPrecheck); design's replacement point is correct and keeps guard before file deletion.
- Both predicates in DataSourceRepository (253, 292) are HAVING count(*)=1 as claimed; DataSourceDeleteConflict (4 fields) and Response (5 fields, jsonFormat5 at DataSourceProtocol:601) match the design's additive-field plan.
- PipelineRootRepository.findReadEdgesVisibleToFuture exists (line 128), explicit owner-or-grant predicate on the privileged pool, returns (pipelineId, name, dataSourceId) edges: suitable for the visible-named subset; hidden = distinct total - visible holds.
- Delete callers enumerated in design all exist via DataSourceService.delete (PatchSetApplyForward:69, PatchSetUndoService:117, PatchSetApplyRollback:119, PipelineProposalService:432/555, FirstRunDashboardService:82/97/100). rollbackAll deletes pipeline before sources (ordering claim true); rollbackSourceOnly currently discards the Either with .map(_ => ()), so task 1.4's "log a 409" is a real, needed change.
- ACs map to tasks: structured 409 (1.1-1.3), design ruling/enumeration (design D1/D2), no cross-tenant leak (D3, test 3.2), red/green/mutation regression (3.1, 3.3), frontend both themes (2.1-2.2, 3.5), mcp (2.3). Spec delta present for datasource-edit-delete.
- V100ZeroRootGuardNonSuperuserSpec test "3.7f" exists at line 542 asserting delete succeeds; plan to flip it is accurate.

### Verdict: CONFIRM

### Non-blocking notes
- The P0001 race recover and isZeroRootViolation remain useful only for the multi-root-unaffected TOCTOU; update its scaladoc/reason wording so it is not described as the primary guard (task 1.5 covers docs).
- Task 1.4: PatchSetUndoService/PatchSetApplyRollback undo of a created source after a patch-set that also created a root on it could newly 409 (logged as "unrecoverable" today, so not silent); executor should confirm undo ordering or accept and note it.
- Task 3.3 mutation should be shown by reverting to HAVING count(*)=1 and watching 3.1 fail.
- Frontend thunk work: confirm global toast suppression does not regress other deleteSource tests.

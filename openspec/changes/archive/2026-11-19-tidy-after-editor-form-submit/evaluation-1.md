## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `172cd9ae533d490692e3b2c9a45c34eae5f191ab` against the live-resolved base `68255cf79b0077b9b37ae7a35433ca7faad58bc1`
(commits 4948869fc, 172cd9ae5). Every red/green claim below was re-run by the evaluator in a throwaway detached worktree
at that exact HEAD (removed afterwards). The executor's transcripts were not trusted. Evaluator transcripts are in
`.concertino/scratch/HEL-1787/eval/`.

### Phase 1: Spec Review — PASS
Issues: none.
- AC1: the `triggeredByUserId` parameter is removed from `recordUnrunnable` (`PipelineRunService.scala:213-229`), and
  `insertRun` stores `Some(user.id.value)`, the same value as before for both production callers
  (`PipelineProposalService.scala:608`, `PipelineSchedulerService.scala:263`). Neither caller passed the parameter, and the
  test tree compiles without it.
- AC2: `ExistenceNotLeakedRoutesSpec.scala:425` adds the `GET panel form-schema` row with `ownerControl = true` (the
  default). The owner gets a 400 on the seeded non-form panel, so the owner-control check holds.
- AC3: archived HEL-1784 `design.md:237` and `tasks.md:37` now name the `pipeline_run_rate_window` proof. Checked against
  the source: the test is "store the editor on the debounce row and fire the run as the owner, recorded for the editor"
  at `FormSubmitEditorRlsSpec.scala:205`, with the assertions at lines 218-219. The `ownerInFlightRealRunsQuery` named in
  the new wording exists at `PipelineRunRepository.scala:172`.
- All tasks are checked and match the diff. No scope creep: the only edits to the archived change are the two lines.
  `CONSTRAINTS: []` in `workflow-state.md`.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates (backend only):
- The full backend suite (`sbt testFull`, -J-Xmx3g, nice 19) could not finish inside the binding 600 s tool timeout (C5:
  no background run past the timeout). It was stopped at 585 s with **5606 tests passed and 0 failed**
  (`eval/e4-testFull.log`). Because the suite compiles first, the whole main and test tree compiled cleanly against the
  removed parameter.
- Every spec file that touches the changed code and was not reached in that partial run was run separately as full spec
  files: 11 named specs plus `*PipelineApplyProposal*Spec`, 15 suites in all, **86 passed, 0 failed**
  (`eval/e5-related.log`). Related specs that did run in the partial suite and passed: `FormSubmitEditorRlsSpec`,
  `PipelineRunServiceSpec`, `PipelineSchedulerServiceSpec`, `AutoRunDebounceWriterAttributionSpec`,
  `DatasetWriteAutoRun*`, `FireTimeRunConfigGateSpec`, `RunCancelsPendingAutoRunSpec` and the rest.
- Green baseline: `ExistenceNotLeakedRoutesSpec` and `PipelineRunEditorPersistenceSpec`, **90 passed, 0 failed**
  (`eval/e1-green.log`).
- `node scripts/check-scala-quality.mjs`: clean, with soft warnings only, none of them new. `check-openspec-hygiene.mjs`:
  clean.

Red-by-mutation results (C12), reproduced independently:
- Mutation (a), `PanelService.scala:144` changed to `panelRepo.findByIdInternal(panelId)`: 66 passed, 1 failed. The only
  failure is `should get an identical 404 for a foreign and a nonexistent id: GET panel form-schema` (`eval/e2a-red.log`).
  So the new row is the one that catches this leak, and no existing row does.
- Mutation D1, `recordUnrunnable` storing `triggeredByUserId = None`: `PipelineRunEditorPersistenceSpec` "should record
  the submitting user on a run recorded as unrunnable" FAILED, 22 passed and 1 failed (`eval/e3-d1-red.log`).
- Both mutations were made only in the throwaway worktree. The executor's worktree was never modified.

Quality checklist: no DRY, readability, type-safety, security or error-handling concerns. The change removes a parameter
and adds one table row, with no dead code and no over-engineering. It is behavior-preserving: the stored value is the same.

### Phase 3: UI Review — N/A
None of the Phase 3 trigger paths changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`).

### Overall: PASS

### Non-blocking Suggestions
- `red-record.md` records the form-schema mutations (a and b) but not the D1 mutation from task 3.1. Only the transcript
  `scratch/HEL-1787/3-d1-red.log` covers it. A single added line in `red-record.md` would keep the record complete.
- The full `sbt testFull` run needs more than the 600 s tool budget on this machine. CI's full run is the first
  complete measurement of this branch.

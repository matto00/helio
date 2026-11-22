## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `ee984e6ea01651487203eb6502910a676517f931` against live base `4f57c50019253cfd763ef7374b81733ec4e948ec`
(`resolve-review-base.sh`, origin/main).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (`removedPlacementCount`): removed. `restorePipelineStepCreate` and `countPlacementsForStep` are deleted. The
  `pipelineStep` create arm is now `restoreCreateUndo(edit, id => pipelineService.deleteStep(...).map(_.map(_ => ())))`.
  The failure strings are byte-identical: `restoreCreateUndo`'s missing-newId message
  `edit ${index} (${targetKind} ${op}): journal is missing its captured newId` renders exactly as the old hard-coded
  `edit N (pipelineStep create): ...` on this arm, and a delete failure still goes through `restoreFailed`. No
  consumer is left: grep across backend, frontend/src, helio-mcp, schemas and e2e finds only the internal
  `PipelineStepRepository.scala:1027` doc, which is a declared non-goal. The schema already permits an absent
  `resultingState`.
- AC2: the comment at `PatchSetUndoLaneSpec.scala:84-86` now describes the HEL-1720/HEL-1795 refusal. The old
  `restorePipelineStepCreate` doc is gone, and the arm comment in `restoreOne` states the current rule.
- AC3 (split): `PatchSetUndoService` went from 426 to 232 lines, and the new `PatchSetUndoRestorers` is 199 lines.
  I took the removed method bodies from `4f57c5001`, stripped `private ` and blank lines, and diffed them against the
  new file. They are identical; the only difference is the trailing delimiter line. Split commit `aa4011c2b` touches
  only the two main files and one evidence `.txt`, with no `src/test` path. The per-suite counts in
  `baseline-undo-specs.txt` and `after-split-undo-specs.txt` are identical across all 32 suites (261 tests).
- Driver scope:
  - The `dataSource` arm is extracted to `deleteCreatedDataSource` with the same expression.
  - `ConcurrentHashMap` is replaced by an immutable map threaded through `loop`. The failure branch never read it.
  - The warning text now names roots, and no test asserts the old text.
  - The `doomedOutputIds` arrows are aligned.
  - The `describeRoot` comment is verified true. The only `POLICY ... ON data_sources` is `data_sources_owner`
    (V35), and no grant or share table exists. The other `GRANT SELECT ... data_sources` lines are role grants to
    `helio_privileged`, not sharing.
- Guards: both are added, labelled "guard", and pass on current code. Each has a recorded mutation that turns it red.
- Spec delta: REMOVED + ADDED. The REMOVED header matches canonical `patch-set-lane-edits/spec.md:36` exactly, and
  `openspec validate --strict` passes.
- No refusal rule or message changed: the diff touches no refusal code path, and the guard wrappers are untouched.
- Planning artifacts match the implementation, and all tasks are checked. `workflow-state.md` has an empty
  `CONSTRAINTS` list.

### Phase 2: Code Review — PASS
Issues: none blocking.

I ran the gates myself on lane DB `helio_hel1797` with `nice -n 19 sbt -J-Xmx3g testOnly` shards:
- The full 32-suite undo/apply set (`evidence/spec-set.txt`) ran 96 + 64 + 55 + 49 = **264 tests, 0 failed**. That
  matches the executor's final record: 261 baseline, plus 1 route seam test, plus 2 guards.
- To check compile safety and the apply-loop change, I also ran the 17 specs that construct
  `PatchSetApplyService`/`PatchSetUndoService` (directly or through fixtures) but are outside the executor's set:
  PatchSetPreview*, PatchSetRoutes*, PatchSetStale*, PatchSetPipelineCreate*, PatchSetDashboardGrantSpec,
  PatchSetPipelineStepGrantSpec, PatchSetStepCreateConfigRoutesSpec,
  PatchSetWindowRollingRejectionRoutesSpec, AssistantInsightNoRenderSpec and ProposalDryRunParitySpec. Result:
  **225 tests, 0 failed**. `testOnly` compiles all main and test sources, so the whole backend compiles.
- I re-ran the guard (a) mutation myself: I removed ` || refs.panels.nonEmpty ||` from
  `PatchSetUndoDatasetLaterWork.scala:67` and ran `PatchSetUndoInlineDatasetLaterWorkSpec`. Only the new guard went
  red (`expected success (PatchSetUndoInlineDatasetLaterWorkSpec.scala:291)`, 15/16). I reverted the change, and
  `git status --short` is clean.
- I read the guard (b) mutation evidence. The new test reddens on `later.roots`, with `Instant.EPOCH` defeating the
  timestamp fallback. The evidence also records the pre-existing clean-undo guard reddening, as design round-2
  note 1 required.
- The red-first evidence is correct. Both the Lane spec `:138` and the route seam test go red on the "no
  `resultingState` key" assertion. The evidence says that schema validation alone would stay green, and that
  matches the design note.
- `npm run check:scala-quality` exits 0 with no import or qualifier violations. Its size warnings are informational
  only. `PatchSetApplyService` is 326 lines (before the change it was about 324), which is under CONTRIBUTING's
  ~400 split mark.
- Prettier passes on the change dir.
- No TODO or FIXME was added, and no unused imports were left (the pruned imports compile cleanly).
- Removing the count read also removes one way the arm could fail (`listByPipelineInternal`/`countByOutputIdsInternal`
  before the delete). The handoff discloses this, and it does not change a refusal rule.

### Phase 3: UI Review — N/A
Only backend and `openspec/changes/**` files changed. No file matches `frontend/**`, `ApiRoutes.scala`, `schemas/**`
or `openspec/specs/**`.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `PatchSetUndoInlineDatasetLaterWorkSpec.scala:20`: the new `com.helio.api.protocols.panels.CreatePanelRequest`
  import sits among the `com.helio.services.*` imports. Moving it next to the other `api.protocols` imports would
  keep the grouping consistent.
- `PatchSetUndoRoutesSpec.scala` (new test): the `pipelinePatch` line is about 200 characters long. Wrapping it
  would make it easier to read.
- The PR body should note the `PipelineStepRepository.deleteInternal` doc misnomer (a declared non-goal), as
  proposal.md says.

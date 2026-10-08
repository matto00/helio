## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `8cb6c3baa8841f9e5ff26fe29b81734fee22b649`. Diff base (resolved live): `4db9730fd0907a4d769b7a0b80082ac260d499d6`.
Scope: backend only (7 Scala files under `services/pipelines/` plus its README) and openspec change-dir artifacts.
Phase 3 has no trigger (no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change).

### Phase 1: Spec Review — PASS
- AC1 (split into cohesive files, `PipelineRunTerminalWrites` and `PipelineRunExecutor` present): met. The six-collaborator
  layout and the D2a seam deviation (`succeeded` publish lives in `PipelineRunSucceededWrites` but still goes through
  `PipelineRunTerminalWrites.publishTerminalAfter`) were approved at the design gate (skeptic CONFIRM, round 2). The PR body
  must state D2a, as design.md requires.
- AC2 (HEL-1366/1370/1374 preserved): bodies are byte-identical (checker below) and `PipelineRunServiceTerminalOrderingSpec`,
  `PipelineRunGuardIntegrationSpec` and `DatasetWriteAutoRunEndToEndSpec` pass in my own full run. `guardClock` goes to
  `PipelineRunExecutor` only, which is the class holding the one read site (`executeRun`).
- AC3 (public API source-compatible): I rebuilt the filtered `javap -public` comparison myself (C5 below). It is identical.
- AC4 (test suite unchanged): `git diff 4db9730fd...HEAD -- backend/src/test` is empty. My own `sbt testFull` matches the
  baseline exactly (below).
- AC5 (moves distinguishable from edits): checker re-run and red runs reproduced (Phase 2).
- AC6 (no inline FQNs): `check-scala-quality.mjs` exits 0. A grep for dotted package paths outside `import`/`package`
  lines in the 7 files finds nothing, `s"${...}"` interpolations included.
- AC7 (bugs become follow-ups): 8 follow-up candidates are listed in files-modified.md. None was fixed in place.
- Tasks 1.1–3.6 are all checked and match the diff. There is no scope creep: the only non-change-dir files touched are the
  7 Scala files and README.md.
- Constraints C1–C5 are all honored. Each was verified independently:
  - C1: test diff is empty. Counts are identical (my run: `Tests: succeeded 6145, failed 0, canceled 4`;
    `Suites: completed 440, aborted 0`; baseline evidence has the same numbers).
  - C2: `grep -c 'ServiceError.Forbidden('` gives 2 for `PipelineRunService.scala` and 0 for each of the 6 new files.
    `ExistenceNotLeakedRoutesSpec` passes. None of the new files calls an access helper
    (`requireOwnerOnly|requireAccess|authorizeResource*`), so the row-coverage pin is unaffected.
  - C3: bytecode check, stronger than the executor's grep. In each of the 6 collaborators, `getLogger` is fed by
    `ldc_w class com/helio/services/pipelines/PipelineRunService`. The entry point keeps `getLogger(getClass)` on a
    `final` class, so the logger name is the same. `StepConfigInvalidRoutesSpec` and `UpsertTargetWritableRoutesSpec`
    (ListAppender on that logger) pass.
  - C4: see the Phase 2 checker review.
  - C5: see Phase 2.

### Phase 2: Code Review — PASS
Gates I ran myself in `WORKTREE_PATH`:
- `sbt compile`: success.
- `node scripts/check-scala-quality.mjs`: exit 0 ("clean", soft warnings only).
- `nice -n 19 sbt testFull`: EXIT=0, `succeeded 6145, failed 0, canceled 4`, 440 suites. Every related suite ran in this
  log: TerminalOrdering, GuardIntegration, DatasetWriteAutoRunEndToEnd, StepConfigInvalidRoutes,
  UpsertTargetWritableRoutes, ExistenceNotLeakedRoutes, AutoRunGuardBurstProof, AutoRunGuardNoRetryStorm and
  PipelineRunServiceSpec. Log: `scratchpad/hel1371-eval/testfull.log`.

Move checker (`move-check/check.py`):
- Green re-run on the committed files: PASS, with 1672 base non-blank body lines, 0 unclaimed and 0 multiply-claimed.
- Construction reviewed. It is genuinely bidirectional and positional:
  - Forward: each member's base range is compared line by line.
  - Substitution: the checker itself verifies that `private ` -> `private[pipelines] ` is the only allowed edit.
  - Reverse: each file is walked in order, and every non-blank line must be consumed by the next expected item. Trailing
    content is reported as UNACCOUNTED.
  - Coverage: every base body line is claimed exactly once.
- Red runs I made on my own scratch copies all fail as expected:
  - r1: one token changed in `publishTerminalAfter`. Fails as a forward mismatch at file line 38 / base line 1002.
  - r2: a copied `    Future.successful(())` line inserted between two members of Support. Fails positionally at :31.
  - r3: a copied `  }` appended after the class. Fails as UNACCOUNTED.
  - r4: a duplicated scaffold import line. Fails as a scaffold mismatch.
- The allow-list is executor-generated, so I reviewed every scaffold line by eye. Each one falls in a D3 category: package,
  pruned imports, new class doc, class header/params/closing brace, logger, named member imports, D4 wiring, and the 4 D1
  delegations. The delegation signatures, the `backfillOutputNode` inline comment included, match base lines 699/820/849/875.
  There is no logic in any scaffold line. The visibility substitutions (14 members) are the only body edits.

Independent implicit/symbol check (extra, because import sets were pruned per file and moved bodies could resolve an
implicit differently): I took the union of constant-pool Methodref/Fieldref/InterfaceMethodref/Class/String entries
over the base classes and over the new 7 classes plus CachedRunStatus/TriggerSource. After filtering out the
intra-split class names and lambda names, the two sets are identical (`diff` exit 0). So no external symbol, implicit
format or string constant (log or error text) was gained or lost.

C5: I regenerated `javap -public` for the 6 classes from the base class files and the current build myself, using the
same synthetic filter. Both sides have 120 filtered lines and the diff is empty (exit 0). Base raw has 388 lines, after
raw has 185. The executor's red run (an added defaulted `submit` param shows up as a diff) is plausible, and the filter
provably keeps the `submit`/ctor default-arg methods.

Wiring (D4): the collaborators are `private val`s declared after `backend`, in dependency order. Construction does no
I/O, and the `executionBackend == null` fallback is unchanged (`PipelineRunService.scala:162-171`).

DRY, readability and modularity: acceptable for a verbatim move.
- The entry point is 634 lines, the Executor 330 and SucceededWrites 310. These are over the 250-line soft budget, a known
  and planned trade-off (D1; follow-up 1).
- There are no new type escape hatches and no new TODO/FIXME.
- Dead code moved verbatim (`resolvePrimaryDataSourceInternal`, the entry point's now-unused `log`) is recorded as a
  follow-up under the refactor-discipline rule.

### Phase 3: UI Review — N/A
No UI-affecting files changed.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `move-evidence.md` "Red run 2" excerpt: the quoted lines (`:65`, truncationFields base 196) are cascade lines from
  deeper in `check-red2.txt`, not the first failure. The raw log shows the first failure at `PipelineRunSupport.scala:42`,
  and the excerpt reads as if the probe was inside `truncationFields`. The red run itself is real and I reproduced it
  independently (r2 above), so this is a presentation fix only.
- Merge readiness: `origin/main` (`e93bebc32`, HEL-1313) is not an ancestor of HEAD. HEL-1313 touches
  `OutputConfigValidation`/`OutputService`/`PipelineService` and specs, and none of the 7 split files. The rebase should be
  clean, but CON-231 requires a rebase plus CI on the rebased head SHA before the auditor.
- Stale pointers left in test sources, which cannot be edited under C1: `ExistenceNotLeakedRoutesSpec.scala:456` names
  `PipelineRunService.scala` as the site of "GET pipeline run status" (`runStatus` now lives in `PipelineRunQueries`), and
  `PipelineRunServiceSpec.scala:1353,2419` cite old `PipelineRunService.scala:NNN` line numbers. Consider adding these to
  follow-up 4 (stale doc references).
- The PR body must name the D2a seam deviation and list which file holds each terminal publish, as design.md requires.

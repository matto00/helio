# Mutation evidence (HEL-1480)

Raw logs, mutation diffs, backups and scripts: `/home/matt/Development/helio/.concertino/runs/HEL-1480/evidence/`
(`HEL1480-mutate.sh` apply/revert with backup, `HEL1480-gaps-run.sh`, `HEL1480-rows-run.sh`, `HEL1480-sbt.sh`; per-run
`<name>.log`, `<name>.mutation.txt` = the applied diff + "reverted" + `git status --short -- backend/src/main` after revert, which printed
nothing). Every sbt invocation: `nice -n 19 sbt -batch -J-Xmx3g "testOnly <specs>"`, run from the worktree's `backend/`; every log
carries `[hel1468-guard] ScalaTest summary: failed=N aborted=0 unreadable=0`. No mutation was ever committed.

Pre-mutation GREEN (`g-green1.log`, the three gap-bearing specs unmutated): `[info] [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`,
`Tests: succeeded 47, failed 0`. Post-revert GREEN: the final `testFull` (`full-testfull.log`), see test-count-evidence.md.

## D1 gap tests: one-line mutation of exactly the guarded branch (status `BadRequest`/`NotFound` -> `Conflict`)

| Gap | Mutation | Run | Failing assertion (verbatim) |
|---|---|---|---|
| G1 blank-name, service | `PipelineCreateWrites.scala:58` `BadRequest("name is required")` -> `Conflict("name is required")` | `mut-g1` | `Left(Conflict("name is required")) was not equal to Left(BadRequest("name is required")) (PipelineServiceCoverageGapsSpec.scala:111)` |
| G1 blank-name, route | same mutation | `mut-g1` | `409 Conflict was not equal to 400 Bad Request (PipelineAclSpec.scala:403)` |
| G2 laneTree unknown + foreign | `PipelineNodeReads.scala:36` `NotFound(` -> `Conflict(` | `mut-g2` | `Left(Conflict("Pipeline not found: 8db14dd3-...")) was not equal to Left(NotFound(...)) (PipelineServiceCoverageGapsSpec.scala:119)` and the foreign-pipeline test (`:124`) |
| G3 static inline, no config | `PipelineProposalAnalyze.scala:340` `BadRequest(` -> `Conflict(` | `mut-g3` | `409 Conflict was not equal to 400 Bad Request (PipelineAnalyzeProposalRoutesSpec.scala:376)` |
| G4 updateStep no-row, `config = None` | `PipelineStepWrites.scala:64` `NotFound(` -> `Conflict(` | `mut-g4a` | `Left(Conflict("Pipeline step not found: 4ab5ec82-...")) was not equal to Left(NotFound(...)) (PipelineServiceCoverageGapsSpec.scala:133)` |
| G4 updateStep no-row, `config = Some` | `PipelineStepWrites.scala:129` `NotFound(` -> `Conflict(` | `mut-g4b` | `Left(Conflict("Pipeline step not found: 8c935e1d-...")) was not equal to Left(NotFound(...)) (PipelineServiceCoverageGapsSpec.scala:140)` |

Each mutation failed only the test(s) guarding it (`mut-g1`: failed=2 of 28; `mut-g2`: 2 of 5; `mut-g3`: 1 of 19; `mut-g4a`/`b`: 1 of 5), was reverted
(backup copy restored byte-for-byte), and the working tree's `backend/src/main` was clean afterwards.
Reaching G4's two arms uses a test-local `PipelineStepRepository` subclass whose `updateInternal` returns `Future.successful(None)`; it proves the
service's handling of `None`, not that a real race produces one. The `config = Some` test uses a `select` step (no join/union/lookup checks).
Neither gap hid a real defect: every asserted behaviour is what the code does.

## D3 ExistenceNotLeakedRoutesSpec rows (only `sites` changed; 4 rows repointed)

Mutation separates the foreign probe from the absent probe; the spec's own assertion (`foreign=... nonexistent=...`) fails on that row only
(`Tests: succeeded 60, failed 1` each).

| Row | Mutation | Run | Foreign vs absent (from the failure) |
|---|---|---|---|
| PATCH pipeline step | `PipelineStepWrites.scala:39` (foreign arm of `updateStep`) message `Pipeline step not found` -> `Pipeline step hidden` | `row-patch-step` | `foreign=Outcome(404,...{"message":"Pipeline step hidden: <ID>"}) nonexistent=Outcome(404,...{"message":"Pipeline step not found: <ID>"})` |
| DELETE pipeline step | `:151` (foreign arm of `deleteStep`), same message change | `row-delete-step` | same shape, FAILED row `DELETE pipeline step` |
| POST pipeline step duplicate | `:241` (foreign arm of `duplicateStep`), same message change | `row-dup-step` | same shape, FAILED row `POST pipeline step duplicate` |
| GET pipeline analyze | `PipelineAnalyzeReads.analyze`: resolve the owner via `findByIdInternal` then call `findSummaryByIdShared`/`findByIdShared` AS that owner (lets a foreign id past the gate) | `row-analyze` | `foreign=Outcome(200,application/json,{"costVerdict":{...` vs the absent probe's 404: the probes genuinely differ (a message change would not, one `case _ => NotFound` arm serves both) |

`row-*.mutation.txt` hold the applied diffs. Not touched: every `PatchSetApplyResolvers.scala` row, `patchKindExemptions`, `expectedForbiddenProducers`,
the `GET/PATCH/DELETE pipeline` rows (their access check and the single Forbidden producer still live in `PipelineService.scala`).

## D4 dead code

`javap -public` of `PipelineService`, `PipelineService$`, `PipelineServiceSupport` before (`javap-base-*.txt`, compiled from the unmodified
tree) and after (`javap-post-*.txt`) the two deletions: `diff` empty for all three ("IDENTICAL" printed per class). Test/main compile after: exit 0,
no warning in any touched file (`post-compile.log`; the 5 warnings are pre-existing in `ApiRoutes`, `ProductEventRoutesSpec`,
`PatchSetPreviewOutputContextSpec`, `WorkspaceContextServiceSpec`). `LoggerFactory` import kept (the companion `log` uses it).

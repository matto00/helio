## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 172cd9ae533d490692e3b2c9a45c34eae5f191ab against live base 68255cf79b0077b9b37ae7a35433ca7faad58bc1
(`resolve-review-base.sh`, rc=0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/tidy-after-hel-1784/HEL-1787`.

### What I verified (with evidence)

- **Diff scope** (`git diff --stat BASE...HEAD`): 4 non-change-dir files — `PipelineRunService.scala` (signature +
  insertRun arg), `ExistenceNotLeakedRoutesSpec.scala` (+1 row), archived HEL-1784 `design.md` and `tasks.md` (1 line
  each). No frontend, no migration, no other archive edits. Matches proposal Non-goals.
- **AC1 — unused `triggeredByUserId` removed.** Diff drops `triggeredByUserId: Option[UserId] = None` and stores
  `triggeredByUserId = Some(user.id.value)` — byte-identical to the old default path. `grep` for `triggeredByUserId`
  near `recordUnrunnable` in `backend/src`: no remaining caller passes it; every caller file
  (`PipelineSchedulerService`, `PipelineProposalService`, `PipelineRunEditorPersistenceSpec`, `PipelineRunServiceSpec`,
  `PipelineApplyProposalSpecBase`) compiled in my fresh run (sbt compiles all test sources). Guard red-by-mutation:
  `scratch/HEL-1787/3-d1-red.log` shows `should record the submitting user on a run recorded as unrunnable *** FAILED ***`
  (22/1); evaluator reproduced independently (`scratch/HEL-1787/eval/e3-d1-red.log`).
- **AC2 — form-schema row.** `ExistenceNotLeakedRoutesSpec.scala:425`
  `Row("GET panel form-schema", GET, "/api/panels/{id}/form-schema", Panel, Set("PanelService.scala"))`, ownerControl
  defaults true; route exists (`PanelRoutes.scala:143`), `PanelService.formSchema:143-158` returns `NotFound` on `None`
  and `BadRequest` for a non-form panel (so the owner control is a real 400, not 404/403). Red logs read:
  `2a-red.log` (findByIdInternal leak) fails exactly `...: GET panel form-schema` (66/1); `2b-red.log` (None -> 403)
  fails the new row AND, separately named, the Forbidden-producer pin (65/2). The new row is the one turning red, not a
  sibling panel row.
- **AC3 — archived wording.** `design.md:237` and `tasks.md:37` now name `FormSubmitEditorRlsSpec`'s
  `pipeline_run_rate_window` assertions; I confirmed those assertions exist at `FormSubmitEditorRlsSpec.scala:218-219`
  (owner > 0, editor = 0) and `ownerInFlightRealRunsQuery` exists at `PipelineRunRepository.scala:172`. No remaining
  `countOwnerInFlightRealRunsInternal` in the archive outside the historical evaluation-1.md (correctly left untouched).
- **Fresh gate run (mine):** `nice -n 19 sbt -J-Xmx3g -batch testOnly ExistenceNotLeakedRoutesSpec
  PipelineRunEditorPersistenceSpec PipelineRunServiceSpec *FormSubmitEditorRlsSpec *PipelineSchedulerService*Spec`
  -> rc=0, `Total number of tests run: 210`, `Tests: succeeded 210, failed 0`, new row present and passing
  (`should get an identical 404 for a foreign and a nonexistent id: GET panel form-schema`). Log:
  `/home/matt/Development/helio/.concertino/scratch/HEL-1787/skeptic/run1.log`.
- **Debugging law:** not a bug fix; n/a. **UI:** no UI change; step 4 skipped, no servers started.
- No mtime-ordering evidence relied upon; all red evidence is content (named failing tests + counts).

### Verdict: CONFIRM

### Non-blocking notes

- The evaluator's full `sbt testFull` was stopped at 585 s (5606 passed, 0 failed) rather than completing; given a
  signature-only main change that compiles across all test sources and green targeted specs, this is not blocking. CI
  will be the full run.
- design.md D3 asked for a red summary in `.concertino/runs/HEL-1787/evidence/`; it lives as `red-record.md` in the
  change dir instead. Equivalent content, cosmetic deviation.

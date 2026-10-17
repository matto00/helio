# HEL-1629 red/green log

Every required spec is shown able to fail. A "recorded mutation" is a source change (diff and raw sbt output kept under
`mutations/`) or the removal of one protocol lock through the `LockSite` seam (the spec's own control case); "green" is the
same spec on the unmodified tree. All runs: `nice -n 19 sbt -batch -Dsbt.server.autostart=false "testOnly <spec>"` from this
worktree's `backend/` (both project-path lines name this worktree).

## 6.2 Fault injection and exactly-one `hel1498_lock_panels`

| Mutation | Spec | Red | Evidence |
|---|---|---|---|
| M1: the step INSERTs run in their own committed transaction (the chain split) | `DraftSaveFaultSpec` | 6 of 9 red: every fault after `AfterInserts` finds the created step persisted | `mutations/M1-split-transaction.diff`, `.log.txt` |
| M2: `lockForDeletion` called twice in `lockDefinition` | `DraftSaveFaultSpec` "take hel1498_lock_panels exactly once" | `2 was not equal to 1` | `mutations/M2-lock-panels-twice.diff`, `.log.txt` |

Green (unmodified tree): `DraftSaveFaultSpec` 9 of 9.

## 6.3 / 6.3b Race specs (G1)

Pre-instrumentation, writer-first, on the tree with NO writer taking the pipeline-row lock: `races/R0-pre-instrumentation.log.txt`,
`DraftSaveRaceSpec` 92 passed, 30 failed (each writer's writer-first and save-first protected runs red: the writer commits inside the
save's window and the save still returns 200). Set race: `races/R0b-set-race-pre-instrumentation.log.txt`, 3 passed, 2 failed
(`DraftSaveSetRaceSpec` source-delete and teardown protected runs).

Green with the locks (`races/R1-with-locks.log.txt`): `DraftSaveRaceSpec` + `DraftSaveSetRaceSpec`, 127 of 127. 60 of those are controls
that remove only the protecting lock site of one writer through `LockSite` and must observe the violation; each is red-by-design,
so a lock that stops protecting turns its own protected run red and its control green-to-red.

## 6.4 Deadlock spec (G2)

`races/R2-deadlock-spec.log.txt`, `DraftSaveDeadlockSpec` 13 of 13. Each participant has a "deadlock when ..." control (the opposite or earlier order
raises 40P01, so the spec can fail) and a "not deadlock" case in the verified order; the repeated mix counts 40P01 as a failure.

## 6.5 RLS (C5) and mutation M3

M3 (`mutations/M3-user-context-fingerprint.diff`, `.log.txt`): the fingerprint read runs in the caller's user context instead of the privileged pool;
`DraftSaveApiSpec` + `DraftSaveRlsSpec` 19 passed, 12 failed (an editor's unchanged save no longer matches). Green unmodified.

## 6.6 / 6.7 / 5.2

`DraftSaveUndoSpec`, `DraftSaveRunSpec` (guard rejection 200 `started:false`; an editor's real run counts against the owner's cap, HEL-1492) and the seam
specs `DraftSaveSeamSpec` (backend) and `draftSaveWire.contract.test.ts` (frontend) are green on the final tree in the full `sbt testFull` and `npm test` runs
recorded in the delivery report. Their red is the schema or serializer drifting: the fixtures are compared with what the production serializers emit.

## V137

`V137LockPipelinesMigrationSpec` applies the migration as a non-superuser, non-BYPASSRLS role and proves both arguments: ids the caller cannot see
(plain `FOR NO KEY UPDATE` locks 0 rows, the function locks them), and `p_source_ids` across owners.

## Cycle 2 (evaluation-1 change requests)

All logs are now `*.log.txt` (the `*.log` pattern is gitignored, which is why cycle 1 shipped without them).

### CR1: the race oracle and mutation D (M4)

The cycle-1 oracle counted only "the writer committed while the save was parked after its compare". A writer-first run in which the
save WAITED on the writer, then compared a fingerprint it had read BEFORE locking, and returned 200 was accepted as protected: a lost
update with `violation=false` (the evaluator's mutation D: 126/126 green under it; `.concertino/runs/HEL-1629/evidence/.concertino/scratch/HEL-1629/eval/mutD.summary.txt`).
The oracle now also flags, writer-first, a 200 save when the writer committed a change BEFORE the save completed
(`DraftRaceFixture.lostUpdate`; a writer that committed only after the save, because it waited on the parked save, is a valid
serialization and is not flagged; this was found when the first version of the check flagged two such runs).

- M4 = mutation D: `mutations/M4-fingerprint-read-before-locks.diff`. `DraftSaveRaceSpec` + `DraftSaveSetRaceSpec` + `DraftSaveApiSpec`: 145 passed, **19 failed**
  (writer-first of panel create/duplicate/batchUpdate/insertBatchPlaced/replace/delete, dashboard contents replace/delete, alert rule insert/update/delete,
  Output update, pipeline rename, step reorder, trunk reorder, root add, schedule upsert/delete), `mutations/M4-fingerprint-read-before-locks.log.txt`.
  The Output update failure is `save=200, writer=ok, violation=true`. Source restored (`git diff` of the file empty).
- Controls re-confirmed under the corrected oracle, unmutated tree: `races/R3-corrected-oracle-with-locks.log.txt`, `DraftSaveRaceSpec` + `DraftSaveRlsSpec`, 136 of 136
  (every control still red-by-design, every protected run still green).

### CR2: Output delete

`DraftSaveRaceSpec` "Output delete (OutputRepository.deleteWithPanelsInternal)", writer-first and save-first, protected and control. The delete is excluded by
its own `LockSite.OutputDelete` (3) AND by the save's `LockSite.SaveOutputs` (5) on the same Output row, so the control removes both and is red; the
protected runs are green (`races/R3-...`). The lock (3) after (1) in that writer is G2 amendment A5 and is red-without in `DraftSaveDeadlockSpec` "Output delete".
The writer's lock was added in cycle 1 for G2 and is not what protects G1 here; the save's (5) alone also excludes it, which the control makes explicit.

### CR3: editor root add / remove (C5)

`DraftSaveRlsSpec` pins, on the non-BYPASSRLS fixture: an editor's `POST /roots` with their own source is 500 and writes nothing; an editor's
`DELETE /roots/:id` is 200 and removes nothing, while the owner's identical request removes the root. Recorded in `g1-writers.md` W29/W30 and docs §8.3.1.
Pre-existing defects, for the driver to file: the editor root add 500 (the service accepts the source, RLS then rejects the insert), and the editor
root remove silent 200 no-op.

### CR5: D5 count assertions

Only the save asserts V137's count. `DraftSaveRaceSpec` "every single-pipeline writer, run after a racer deleted the pipeline, should write nothing" (12 writers,
`races/R4-raced-delete-writers.log.txt`) pins that no writer writes definition state for a vanished pipeline; docs §8.3.1 now says exactly that.

## Cycle 3 (skeptic-final-1 REFUTE: F1, F2)

Logs and diffs: `evidence/cycle3/` (all `.txt`/`.diff`, trimmed of connection-pool noise).

- **F1 red first.** `DraftSaveRaceSpec` "step delete of a step the save moved", save-first, on the cycle-2 tree with the serial-order oracle:
  `save=200, writer=ok, violation=true` (the head child t5 ended under t1, serial order says t4): `cycle3/F1-step-delete-red-before-fix.log.txt`.
- **F1 fix and green.** `deleteInternal` re-reads the row and removal set under (3), retries when the locked removal set outgrows the panel-locked set.
  `DraftSaveRaceSpec` 146/146 (the moved-step case, the grown-subtree retry case, the full writer table).
- **Mutations.** M5 `cycle3/M5-promote-to-prelock-place.{diff,log.txt}`: the moved-step case red (145/146). M6 `cycle3/M6-no-retry.{diff,log.txt}` (one attempt):
  the grown-subtree case red with the IllegalStateException (145/146); this also proves the retry path is really exercised. Source restored after each.
- **F2.** `DraftSaveDeadlockSpec` 17/17 with the four new cases (step delete, root remove: protected and control). M7 `cycle3/M7-sk3-*.{diff,log.txt}` moves (3) before (1) in both
  writers: 4 red. Claims in `g1-writers.md` Table B corrected, the audit is Table D.
- **Labels.** Alert rules are (4), Outputs (5) everywhere (`PipelineDefinitionLocks.scala`, `PipelineDraftWrites.scala`, `g1-writers.md`, docs, spec).

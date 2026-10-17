## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `8547a856f374907cfecd4355f25511c3852a2919`, the fix commit on top of `11e6d6574`. Review surface: `git diff 11e6d6574..HEAD` plus
the cycle-1 review base `29cb0a60f`.

No production source changed this cycle. The fix commit touches only test code under `backend/src/test`, the frontend contract test,
docs, openspec artifacts and evidence.

### Gates (fresh runs, by me)

| Gate | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run format:check` | PASS |
| `npm test` (2 workers) | PASS: root 524/524, frontend 8964/8964 |
| `npm --prefix frontend run build` | PASS |
| `sbt testFull` (flock, nice 19) | PASS: 9183 succeeded, 0 failed, 4 canceled (measurement-only) |
| Targeted draft-save specs (12 suites) | PASS: 244/244 |

### Cycle-1 change requests, verified

**CR1: race oracle. CLOSED.**
- `DraftRaceFixture.lostUpdate` now flags a writer-first 200 when the writer's future completed before the save's
  (`writerDone < saveDone`) and the writer committed a change.
- A writer that commits only after the save committed is still a valid serialization and is not flagged.
- I re-applied mutation D myself (fingerprint read moved above `lockDefinition` in `DraftSaveTransaction.scala`). `DraftSaveRaceSpec`
  went **19 red**, 123 green. The red cases are the writer-first runs of:
  - panel create, duplicate, batchUpdate, insertBatchPlaced, replace and delete;
  - dashboard contents replace and delete;
  - alert rule insert, update and delete;
  - Output update and pipeline rename;
  - step reorder and trunk reorder;
  - root add;
  - schedule upsert and delete;
  - the RLS source delete.
- Evidence: `.concertino/runs/HEL-1629/evidence/.concertino/scratch/HEL-1629/eval/c2-mutD.summary.txt`.
- I restored the file; `git status` is clean.
- The executor's M4 records the same count (19).

**CR2: Output delete G1 race. CLOSED.**
- Added in both orders, protected and control.
- The control removes `OutputDelete` and `SaveOutputs`, because the save's own Output-row lock also excludes this writer.
- The writer's own (3) is justified on G2 grounds by `DraftSaveDeadlockSpec` "Output delete", which is red without it. That is consistent
  with C1.
- `g1-writers.md` W15 now names the real block.

**CR3: editor root add/remove. CLOSED.**
- `DraftSaveRlsSpec` pins two behaviours on the non-BYPASSRLS fixture:
  - an editor's root add gets 500 with nothing written;
  - an editor's root remove gets 200 with nothing removed, while the owner's identical request does remove the root.
- These match my cycle-1 probe.
- A policy change that made an editor root write possible would turn these specs red. That is the right tripwire for C5.

**CR4: evidence durability. CLOSED.**
- The logs are committed as `*.log.txt`.
- The §8.3.1 citations are updated, and the archive move is documented.

**CR5: count assertion. ACCEPTABLE.**
- The docs and design.md D5/D11 now say what the code does: only the save asserts V137's count, and single-pipeline writers take their
  existing not-found path (an FK violation, a zero-row write, or a not-found result).
- This meets D5's intent, "never a silent proceed": the danger is a successful definition write for a vanished pipeline.
- `DraftSaveRaceSpec` "every single-pipeline writer, run after a racer deleted the pipeline, should write nothing" (12 writers, green)
  pins that none happens.
- The writers' reads all come after the lock, so the sequential pin is representative of the raced case.
- design.md D5/D11 now also give the two-argument signature and the verified (3) → rules → Outputs order.

The non-blocking items from cycle 1 were also addressed:
- the transactional audit row is documented in §8.3.1;
- the Ajv assertion in the contract test is fixed.

### Phase 1: Spec Review — PASS
Issues: none.
- Every ticket AC is met.
- Tasks 6.3 and 6.5 are now complete.
- Constraints C1-C8 are honored.

### Phase 2: Code Review — PASS
Issues: none blocking.

### Phase 3: UI Review — PASS
- No production or UI code changed since cycle 1.
- Cycle 1's live checks on an isolated database still stand: GET fingerprint, save, stale 409, cascade 422, undo, run-after-save.

### Overall: PASS

### Non-blocking Suggestions
- `evidence/races/R5-full-testfull-cycle2.log.txt` is **14 MB** (107k lines) of full `testFull` output. Once squash-merged it stays in
  history permanently.
  - Consider replacing it with a summary of the suite counts and failures, keeping the full log only in the durable
    `.concertino/runs/HEL-1629/evidence/` copy.
  - `M4-…log.txt`, `R3` and `R4` (3-4k lines each) could be trimmed the same way.
- Driver follow-ups, as the executor noted:
  - the pre-existing editor root add 500, where the service accepts the editor and RLS then rejects the insert;
  - the pre-existing editor root remove that returns 200 but changes nothing.

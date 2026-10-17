## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `11e6d6574d7d7cd1bd2251d273607a2a3c29a83e`. Review base: `29cb0a60f`, resolved live with `resolve-review-base.sh`.
Evaluator evidence is under `.concertino/runs/HEL-1629/evidence/.concertino/scratch/HEL-1629/eval/`: `mutAB.summary.txt`,
`mutD.summary.txt`, `probe_mutD.summary.txt` and `probe_unmut.summary.txt`. The raw logs are in `SCRATCH/eval/`.

### Gates (fresh runs, by me)

| Gate | Result |
|---|---|
| `npm run lint` | PASS |
| `npm run format:check` | PASS |
| `npm test` (jest, 2 workers) | PASS: root 524/524, frontend 8964/8964. The draft-save files, run on their own, are 11/11 |
| `npm --prefix frontend run build` | PASS |
| `sbt testFull` (under the flock, nice 19) | PASS: 9165 succeeded, 0 failed, 4 canceled (measurement-only `HELIO_MEASURE` specs) |
| `npm run check:scala-quality` | clean (soft warnings only) |
| Targeted draft-save specs | PASS, 226/226: Race, SetRace, Deadlock, Rls, Fault, Undo, Run, Api, Seam, V137 migration, fingerprint parity, DraftDiff |

### Phase 1: Spec Review — FAIL

Issues:

1. **Task 6.3 is marked `[x]` but the Output delete race is missing.**
   - Task 6.3 lists "Output create/update/delete" individually.
   - `DraftSaveRaceSpec.scala` has no block for `OutputRepository.deleteWithPanelsInternal`. It appears only in
     `DraftSaveDeadlockSpec.scala:53-62`, which is a G2 deadlock spec, not a G1 race.
   - `evidence/g1-writers.md` row W15 cites a race spec, `R-output-delete`, that does not exist.
2. **C5 is not met for root add and root remove.**
   - Both are editor-capable on the app pool (`PipelineRootWrites.scala:117-119`, `:169-171`, `:216`) but are raced only as the owner
     (`DraftSaveRaceSpec.scala`, "root add" and "root remove" blocks, both run as `owner`/`userA`).
   - On the substance, **the executor's claim is correct**. I probed it on the non-BYPASSRLS fixture, `mutD.summary.txt`
     `EVALPROBE` lines:
     - An editor's `POST /api/pipelines/:id/roots` with their own source returns **500** and writes nothing. The
       `pipeline_roots_insert` WITH CHECK is owner-only (V98:355-363).
     - An editor's `DELETE /roots/:id` returns **200 with `removedStepCount: 0`** and writes nothing, because `pipeline_steps_owner`
       (V35:63) and `pipeline_roots_delete` hide every row.
     - The owner's identical DELETE does remove the step.
   - So the round-1 statement ("attachRoot accepts the editor's own source") and the executor's statement ("RLS blocks the insert") are
     both true: the service-level check accepts the source, and RLS then rejects the insert. An editor cannot commit a root change, so
     there is no editor race to protect against.
   - What is missing: this is recorded nowhere in the deliverable. `g1-writers.md` W29/W30 only say "app (caller)", and no spec pins
     it. The 500 and the silent no-op are both pre-existing defects.
3. **The evidence cited as the verified protocol does not ship.** `*.log` is gitignored (`.gitignore:27`), so these were not committed:
   - `evidence/races/R0-pre-instrumentation.log`, `R0b-…`, `R1-with-locks.log`, `R2-deadlock-spec.log`;
   - `mutations/M1/M2/M3*.log`;
   - `probe_1_2…1_5.log`.

   `git ls-files evidence/` lists only the `.md`, `.sql`, `.sh` and `.diff` files. Both `docs/live-draft-preview.md` §8.3.1 and
   `red-green-log.md` cite these logs as the recorded reds. That falls short of the AC ("The verified protocol is documented") and the
   driver constraint ("with the red recorded").
4. Planning artifacts:
   - design.md D5/D11 still describe the one-argument `hel1629_lock_pipelines(ids text[])`.
   - The two-argument deviation is justified and recorded in docs §8.3.1 (the amendments table, row V137) and in the V137 header.
   - Acceptable, but design.md should match. Non-blocking.

Everything else in Phase 1 passed:

- **AC1:** an atomic whole draft is covered by `DraftSaveApiSpec` "a whole draft". Fault injection (`DraftSaveFaultSpec`) is 9/9, and
  M1 proves it can fail.
- **AC2:** the stale 409 writes nothing, and no force path exists. I verified both live: `force:true` gives 409, and the schema
  rejects unknown fields.
- **AC4:** undo was verified live:
  - it restores the original fingerprint exactly;
  - a second undo gives 409 `PATCH_SET_STALE`;
  - the bound-cascade refusal is in `DraftSaveUndoSpec`.
- **AC5:** `DraftSaveRunSpec` passes, and an editor's run counts against the owner's cap. I also verified the live dry run
  `runAfterSave`.
- Explicit ids are accepted only in `DraftSaveMode.Restore` (`DraftDiff.scala:115,273`).
- There is no UI wiring: `draftSaveService.ts` has no component caller.
- The spec delta G2 order was updated, as required by skeptic r4 note 1.

### Phase 2: Code Review — FAIL

Issues:

1. **The G1 race oracle is blind to the property C4 makes binding: "only locks taken before the fingerprint read protect".**
   - In `DraftRaceFixture.scala` (the `race` method, `violation = saveResult.isRight && committedWhileParked`), a violation counts only
     when the writer commits while the save is parked AFTER its compare.
   - A writer-first run where the save WAITS on the writer and then returns 200 is accepted as "protected" (`blockedObserved=true`,
     `violation=false`).
   - D6 defines a pass as "409 or the writer waits/fails". In writer-first order the writer does not wait, so the only passing outcome
     is a 409.

   I proved the hole with an evaluator mutation (mutation D), which moves `prior <- definition(pipelineId)` above
   `writes.lockDefinition(...)` in `DraftSaveTransaction.scala:74-77`:
   - `DraftSaveRaceSpec` stayed **fully green**: 126/126 (`mutD.summary.txt`).
   - A writer-first probe of the "Output update" writer under mutation D gave: save **200**, writer committed `renamed`, stored name
     back to `oc`. That is a **lost update** with `violation=false` (`probe_mutD.summary.txt`).
   - The unmutated tree answers 409 for the same race (`probe_unmut.summary.txt`).

   The current code is correct. The required specs would not catch a regression of the lock-before-read ordering.
2. **No G1 race for Output delete.** See Phase 1 issue 1.
3. **Doc accuracy.** §8.3.1 says "V137 returns the locked count and every caller asserts it". In fact every instrumented writer
   discards the Boolean with `andThen`; only the save asserts it:
   - `PipelineScheduleRepository.scala:106,113`
   - `OutputRepository.scala:242,336`
   - `PipelineStepRepository.scala:416,632,757,805,866,901,1057,1256`
   - `PipelineRootRepository.scala:96`

   The real not-found path for those writers is the FK error or the zero-row write described in `g1-writers.md` Table A.

Checked and acceptable:

- **Lock-removal mutations re-applied independently.** All were restored afterwards and the tree is clean (`mutAB.summary.txt`):
  - (A) `lockPipelineOfStep` returning `true` without locking turns "step PATCH" writer-first and save-first red.
  - (B) Dropping the source-row `FOR UPDATE` in `DataSourceRepository.delete` turns the three-session set race red.
  - Both match `red-green-log.md`.
- **No pipeline-row lock on panel, dashboard and alert-rule writers.**
  - In `R0-pre-instrumentation.log` their protected runs are green before any instrumentation.
  - Their controls (removing the save's own (1)/(4)/(5) sites) are red.
  - I re-ran both; the probe confirms that the unmutated save answers 409 against a writer-first Output rename.
  - This justifies C1. After CR1 this justification becomes stronger.
- **Audit row via `appendAction` inside the save transaction.**
  - A failed audit insert now rolls the save back. It surfaces as a classified 5xx, not silently.
  - This departs from HEL-471's `AuditService.record` "never perturbs the request" convention, but tasks.md 3.5 planned it
    ("one audit row in the same transaction").
  - It gives "a committed save has exactly one audit row". The insert is a plain privileged insert into the same DB, so the only way
    it fails is a DB failure that would endanger the save anyway.
  - Acceptable. The deviation should be stated in docs §8.
- **Modified existing specs: all legitimate.**
  - `V94OutputsMigrationSpec` with `LocksWithout(LockSite.All)`: that spec migrates to V118 (`:245`), where V137 does not exist yet.
  - The `GRANT EXECUTE ON ALL FUNCTIONS` additions in `OutputRoutesSpec` and `PipelineRunServiceUpsertSourceRlsSpec`:
    - Prod migrates and serves as the same `helio` role (CLAUDE.md: DB_USER is passed to both Flyway and Slick), and V137 grants
      EXECUTE to `current_user`.
    - These fixtures split the app role from the migrating role, so they need the grant. The same line already exists in 7 other
      fixtures.
    - `V137LockPipelinesMigrationSpec` applies V137 as a NOSUPERUSER/NOBYPASSRLS schema owner (MISTAKES.md RLS section).
  - The `ExistenceNotLeakedRoutesSpec` pin on `DraftSaveService.editable`: the 403 is reached only after `findByIdShared` returned
    the pipeline.
- **Seam test.** `DraftSaveSeamSpec` validates the real serializer output against the committed schemas and requires the shared
  fixtures to equal it. `draftSaveWire.contract.test.ts` validates the same files with Ajv.
- **V137.** It follows the V129 owner/grant pattern, uses `SET row_security = off`, and takes one id-ordered `FOR NO KEY UPDATE`.

### Phase 3: UI Review — PASS (scoped)

The triggers match (`frontend/**`, `schemas/**`, `ApiRoutes.scala`), but no component changed.

- I started the servers with the canonical script against an ISOLATED clone (`helio_hel1629`: schema plus `users`). The worktree
  `.env` points at the shared `helio` DB, and booting against it would have applied V137 there. Shared `helio` was confirmed still at
  V136 afterwards. The clone was dropped and the servers stopped with `stop-servers.sh`.
- Live, as the dev account, on a fresh founder template pipeline:
  - `GET ?definition=true`: fingerprint plus definition. The plain GET gives a fingerprint and no definition.
  - Unchanged save: 200, same fingerprint, `run: null`.
  - Create a step by `clientId` plus rename an Output: 200, new fingerprint.
  - Stale base: 409 `PATCH_SET_STALE` with `currentFingerprint` equal to the live one.
  - `force:true` is still 409.
  - Removing a bound step: 422 `CASCADE_CONFIRMATION_REQUIRED` listing the step, Output and panel, with nothing written.
  - Undo: 200, fingerprint back to the original exactly. A second undo gives 409.
  - `runAfterSave: "dryRun"`: `run.started: true`. `runAfterSave: "always"` gives 400.
- The pipeline page renders at 1440 with no horizontal overflow. The only console error is a pre-existing 404 on
  `GET /schedule` for a pipeline with no schedule.
- **Breakpoint sweep incomplete:** while I was resizing, the shared Playwright browser was navigated to `localhost:7016` (another
  session's dev server). That is the documented parallel-Playwright hazard. I stopped using the browser rather than interfere. This
  does not affect the verdict, because no component changed.

### Overall: FAIL

### Change Requests

1. **Close the oracle hole in the G1 race specs (C4/D6).**
   - In `backend/src/test/scala/com/helio/testsupport/DraftRaceFixture.scala` `race(...)`, a protected run must fail when the save
     returns 200 although the writer committed a change (`writer.didWrite`) before the save's compare.
   - Concretely: in `WriterFirst`, when `blockedObserved` came from the save waiting on the writer and the writer committed, assert
     `saveResult` is `Left(PatchSetStale)`. For a pipeline delete, `Left(NotFound)` is also acceptable.
   - Or generalise `violation` to "save 200 AND writer committed a change before the save committed".
   - Then record the red of mutation D (fingerprint read moved above `lockDefinition` in `DraftSaveTransaction.scala:74-77`) in
     `red-green-log.md` as a new mutation. It must turn writer-first runs red (at minimum the Output update writer).
2. **Add the Output delete G1 race** to `DraftSaveRaceSpec.scala`:
   - `OutputRepository.deleteWithPanelsInternal` on an Output of the seed;
   - writer-first and save-first;
   - a control removing `LockSite.OutputDelete` (or whichever save site excludes it), red first;
   - fix `g1-writers.md` W15's race-spec column to name the real block.
3. **Pin the editor root add/remove finding (C5)** in `DraftSaveRaceSpec` (or a spec beside it).
   - Run root add and root remove as an editor (`userB` with `seed.grant(userB,"editor")`) on the non-BYPASSRLS app pool.
   - Assert that neither commits a fingerprinted change (add fails, remove changes nothing), so no editor race exists.
   - Record this in `g1-writers.md` W29/W30.
   - Raise follow-up tickets for the pre-existing editor root add 500 and the silent editor root remove 200 no-op.
4. **Make the cited evidence durable.**
   - Commit the race, mutation and probe logs that §8.3.1 and `red-green-log.md` cite (`git add -f`, or rename to `.txt`) so they
     survive the merge and worktree cleanup.
   - Make the §8.3.1 citations resolve after archive. Use the `openspec/changes/archive/<date>-atomic-draft-save-endpoint/evidence/`
     path, or note the move.
5. **Correct `docs/live-draft-preview.md` §8.3.1**, "V137 returns the locked count and every caller asserts it". Only the save asserts
   the count; single-pipeline writers take their FK-error or zero-row path, and set writers drop vanished pipelines. Either say that,
   or make the writers assert it.

### Non-blocking Suggestions

- Amend design.md D5/D11 to the two-argument V137 signature, so the planning artifact matches the code.
- State in docs §8 that the draft-save audit row is transactional, a deliberate departure from HEL-471's swallow-on-failure
  `AuditService.record`.
- `draftSaveWire.contract.test.ts`: `expect(errorsOf(validateResponse) && validateResponse(body))` always reduces to
  `validateResponse(body)`, because `errorsOf` returns a truthy array. Assert the error list instead, so a failure prints the schema
  errors.
- Size: `DraftDiff.scala` is 336 lines, `DraftRaceFixture.scala` 330 and `PipelineStepRepository.scala` 1501 (now +91). These are
  soft-budget overruns; propose a split in the PR description.
- In dry-run mode the workspace teardown now takes `FOR UPDATE` on the tagged sources (`WorkspaceTeardownRepository.scala:140-143`). That
  is harmless but unnecessary for a dry run.

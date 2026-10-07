## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: a5c40a50fb8b5652dd77372df1c093c99744b4b6
Review base (resolve-review-base.sh, live): 67c8ab22459fe64faa511ca507aba25436378f0d
Changed code: `backend/src/main/scala/com/helio/services/pipelines/OutputService.scala`, `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala` (plus openspec change artifacts).

### Phase 1: Spec Review — PASS
- AC1 (negative assertion runs only after the completion hook fired): PASS. `OutputService.triggerBackfill` (OutputService.scala:69-79) now passes `backfillOutputNode`'s Future and the Output id to `backfillObserver`. It is called synchronously inside `create`'s `.map` (line 156), and in `update` (line 257), so the Future is recorded before the HTTP response exists. The spec looks up that Future (failing loudly if none is recorded), runs `Await.result(..., BackfillCompletionDeadline)`, and only then asserts `materialized=false` / empty items (OutputRoutesSpec.scala:807-819; await at :813). `Thread.sleep(200)` is gone.
- AC2 (a late forbidden effect still turns the test red): PASS. I verified this myself, independently of the executor's logs (see Phase 2, "Mutation re-run").
- No AC was reinterpreted. Tasks 1.1–4.1 are all ticked and match the diff. There is no scope creep: the positive HEL-947 test is untouched, as design.md's Non-Goals say it should be. Production wiring (`ApiRoutes`) is unchanged and the observer defaults to the no-op, so runtime behaviour is unchanged. No API/schema change is needed, and `skip_specs` is correctly justified.
- Planning artifacts match the implementation (D1 defaulted constructor param + NonFatal guard; D2 seeded never-run fixture, TrieMap, loud fail, named deadline).
- `workflow-state.md` CONSTRAINTS: `[]`. Nothing to honour.

### Phase 2: Code Review — PASS
Gates (my own fresh runs, in WORKTREE_PATH):
- `nice -n 19 sbt testFull` on the committed tree: 6085 tests run, 0 failed, 4 canceled, all suites completed. Log: `/home/matt/Development/helio/.concertino/runs/HEL-1356/evidence/openspec/changes/backfill-completion-hook/evidence/eval-1-testFull.log`
- `npm run check:scala-quality`: passes (no inline-FQN violations). The file-size warnings are informational only (see suggestions).

Mutation re-run (done by me, not taken from the executor's claims):
1. Mutated `PipelineRunService.scala:713` so the `case false` arm became `Future { Thread.sleep(1000) }.flatMap(_ => evaluateNodeRowsForBackfill(...))`. That is a late, forbidden backfill on a never-run node, chained into the returned Future. Running `testOnly OutputRoutesSpec` gave the new test **RED** at `OutputRoutesSpec.scala:818` (`paged.fields("materialized") shouldBe JsBoolean(false)`), with the message "true was not equal to false". Result: 98 passed, 1 failed. Log: `/home/matt/Development/helio/.concertino/runs/HEL-1356/evidence/openspec/changes/backfill-completion-hook/evidence/eval-2-mutation-late-backfill.log`
2. Kept the same mutation and temporarily swapped the `Await.result(...)` for `Thread.sleep(200)` (the old shape, with the same seeded fixture): **GREEN**, 99/99. This shows the mutation hits exactly the late-effect gap the ticket describes, and that the old sleep could not catch it. Log: `/home/matt/Development/helio/.concertino/runs/HEL-1356/evidence/openspec/changes/backfill-completion-hook/evidence/eval-3-mutation-oldshape-sleep200.log`
3. Reverted both with `git checkout --`. `git status --short` / `git diff HEAD` came back empty (only gitignored eval logs remain). Re-ran the spec: **GREEN**, 99/99. Log: `/home/matt/Development/helio/.concertino/runs/HEL-1356/evidence/openspec/changes/backfill-completion-hook/evidence/eval-4-reverted-green.log`
- I did not re-run the skip-observer mutation. I checked it by reading the code instead: `TrieMap.getOrElse`'s default is by-name, so `fail(...)` is evaluated only when no Future was recorded. The guard is sound. The executor's 04 log corroborates this.

Checklist:
- Code-quality [mechanical]: no inline FQNs, and imports are at the top. The `NonFatal` import was added properly. Comments explain why, not what. PASS.
- DRY: the never-run test repeats the positive test's ~12-line dataset+pipeline seeding verbatim (non-blocking, see suggestions).
- Type safety, security, error handling: the observer call is NonFatal-guarded and logged, so it never fails create/update. PASS.
- Tests meaningful: verified by mutation above. PASS.
- No dead code, no over-engineering: a single defaulted function parameter, consistent with the file's nullable-optional collaborator pattern. PASS.

### Phase 3: UI Review — N/A
No trigger paths changed (no `frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`).

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `OutputRoutesSpec.scala:789-799` duplicates the positive HEL-947 test's seeding block (`OutputRoutesSpec.scala:740-750`). A small `seedDatasetPipeline(name: String): PipelineId` helper would remove the copy.
- `OutputRoutesSpec.scala:48`: the `scala.collection.concurrent.TrieMap` import sits between the two `scala.concurrent.*` imports. Move it above them to keep the import block sorted.
- `OutputService.scala` is now 495 lines and `OutputRoutesSpec.scala` 1986, both well over the ~250-line soft budget (CONTRIBUTING.md:24). That is pre-existing and this change adds little, but a split ticket would be worthwhile.

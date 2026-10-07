## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: a5c40a50fb8b5652dd77372df1c093c99744b4b6
Review base (resolve-review-base.sh, live, exit 0): 67c8ab22459fe64faa511ca507aba25436378f0d
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/outputroutes-backfill-completion-hook/HEL-1356`

### What I verified (with evidence)

- **Diff scope** (`git diff 67c8ab224...HEAD`): one commit. The code changes are only in `OutputService.scala` (+20/-1) and `OutputRoutesSpec.scala` (+36/-?). Everything else is openspec artifacts. There is no frontend, API, schema or migration change, so step 4 (UI) does not apply.
- **The hook is real and in production code.** `OutputService.triggerBackfill` (OutputService.scala:69-79) captures the `Future[Unit]` from `pipelineRunService.backfillOutputNode(...)` and passes it, with `output.id`, to `backfillObserver`. The observer has a `NonFatal` try/catch so it cannot fail create/update. The default is `OutputService.NoBackfillObserver`, a no-op (:450). `ApiRoutes.scala:481` and the other five `new OutputService(` call sites are untouched, so production behaviour is the same.
- **The ordering behind AC1 holds.** `triggerBackfill` runs synchronously inside `outputRepo.insertInternal(...).map { ... }` (OutputService.scala:154-162), before `Right((output, config))` is produced. The Future is therefore in the spec's TrieMap before the POST response exists, and there is no race between the response arriving and the hook being registered.
- **The returned Future really covers the forbidden effect.** `backfillOutputNode` (PipelineRunService.scala:703-720) chains listRows -> `latestSuccessfulCompletedAtInternal` -> `evaluateNodeRowsForBackfill` -> `persistBackfilledRows` into one Future, so a late write inside that chain is awaited.
- **AC1, the negative assertion runs only after the hook fired.** The test (OutputRoutesSpec.scala:784-821) does three things in order:
  1. Looks up the recorded Future. `getOrElse` takes its default by name, so `fail(...)` runs only when nothing was recorded.
  2. Runs `Await.result(backfillDone, 10.seconds)`.
  3. Only then GETs rows and asserts `materialized=false` and empty items.

  `Thread.sleep(200)` is gone.
- **The test is not vacuous.** It now seeds real dataset rows, so a forbidden backfill would write a snapshot. `materializedFor` (OutputService.scala:432-444) then returns true when `paged.total > 0`, which makes the assertion failable. The mutation below confirms this.
- **AC2, my own mutation run (not the evaluator's).** I changed PipelineRunService.scala:713 `case false => Future.successful(())` to `Future { Thread.sleep(3000) }.flatMap(_ => evaluateNodeRowsForBackfill(...))`. That is a forbidden backfill on a never-run node, landing 3 s late: 15x the old sleep, and a different delay from the executor's and evaluator's 1 s.
  - Command: `nice -n 19 sbt "testOnly com.helio.api.routes.pipelines.OutputRoutesSpec"`.
  - Result: **RED**, exit 1. `should does not backfill ... never run *** FAILED ***`, `true was not equal to false (OutputRoutesSpec.scala:818)`, `Tests: succeeded 98, failed 1`.
  - Line 818 is the `materialized` assertion, the observable forbidden effect, not the await or the guard. So the mutation reaches the right branch, and the test catches it because it awaited completion.
  - Log: `/home/matt/Development/helio/.concertino/runs/HEL-1356/evidence/openspec/changes/backfill-completion-hook/evidence/skeptic-final-mutation-3s.log`
- **Revert.** `git checkout --` the file; `git status --short` showed only the untracked `evaluation-1.md`. Re-ran the same command: **GREEN**, exit 0, `Tests: succeeded 99, failed 0`. Log: `/home/matt/Development/helio/.concertino/runs/HEL-1356/evidence/openspec/changes/backfill-completion-hook/evidence/skeptic-final-reverted-green.log`
- **The old sleep-200 shape is green under the late mutation.** I did not re-run this. I accepted the evaluator's eval-3 log: same seeded fixture, 99/99 green. That evidence is a test-result log (content), not mtime ordering. My 3 s mutation is a strictly larger gap than the 1 s one that log used, so the old shape would be at least as blind.
- **The skip-observer guard.** I accepted the executor's 04 log (`no backfill Future recorded ... (OutputRoutesSpec.scala:811)`, 98/1) and checked it against the code: the by-name `getOrElse` default.
- **Full-suite gate.** I relied on the evaluator's pasted log, which is unambiguous: `eval-1-testFull.log:58428 Tests: succeeded 6085, failed 0, canceled 4` / `All tests passed.` (sbt testFull on this HEAD).
- **Scala quality.** I re-ran `npm run check:scala-quality` myself: `clean (211 soft warning(s))`. The soft warnings are pre-existing file-size notices.
- **Mtime evidence.** None of my conclusions depend on mtime or directory ordering.

### Verdict: CONFIRM

### Non-blocking notes
- `OutputRoutesSpec.scala:789-799` duplicates the positive HEL-947 test's dataset+pipeline seeding. A small helper would remove the copy (the evaluator made the same note).
- The `TrieMap` import at `OutputRoutesSpec.scala:48` sits between the `scala.concurrent` imports, so the import block is slightly out of order.
- As design.md's Risks section documents, the hook cannot see work that `backfillOutputNode` detaches from its own returned Future. A regression that spawns an unchained Future would slip past. That is outside this ticket's AC.
- The executor's raw `.log` evidence is gitignored (`.gitignore:27 *.log`). Only the README is committed. The durable copies are under `.concertino/runs/HEL-1356/evidence/`.

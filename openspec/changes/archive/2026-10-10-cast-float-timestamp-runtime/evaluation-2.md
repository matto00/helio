## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: 16aed1935e4162594c437662789f1202b3f10021. The diff base was resolved live as 719710c15d457de02bcb681192275f2f011268dc. The working tree also has one uncommitted change, the orchestrator's amendment to design.md, which was reviewed as well.

### Fresh evidence gathered by the evaluator

- **Full suite at HEAD** (`nice -n 19 sbt -J-Xmx3g -batch -Dsbt.server.autostart=false testFull`):
  - The project-path line names the HEL-1436 worktree.
  - `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`.
  - `Tests: succeeded 6627, failed 0, canceled 4`. The 4 cancellations are the existing opt-in `HELIO_MEASURE` cases.
  - The count changed by exactly what the diff explains: 6628 − 2 removed flat-engine CSV cases − 1 removed pin case + 2 new CastPipelineRunSpec cases = 6627.
  - CastPipelineRunSpec, CastRuntimeParitySpec, CastStepSpec, CastSupportedTargetsSpec and CastTargetWriteRoutesSpec all ran.
- **Independent pre-fix red check for the new task-1.6 spec.**
  - Setup: a throwaway detached worktree at 719710c15 (no production changes) plus only `CastPipelineRunSpec.scala`, run with `testOnly`.
  - Result: exit 1, `[hel1468-guard] failed=2`.
  - The failure messages are the bug itself:
    - `Vector("1.50", "2.25", "x") was not equal to Vector(1.5, 2.25, null)` (CastPipelineRunSpec.scala:102)
    - `Vector() was not equal to Vector("1")` (:113)
  - This matches red-evidence.md's cycle-2 section. The throwaway worktree was removed afterwards (`git worktree list` shows no straggler).
- **sbt servers:** none started (`-batch`, `autostart=false`).
- **Code quality:** `node scripts/check-scala-quality.mjs` reports clean.

### Phase 1: Spec Review — PASS

Cycle-1 change requests:

1. **CR1 (task 1.6): resolved.** `CastPipelineRunSpec` (`backend/src/test/scala/com/helio/services/pipelines/CastPipelineRunSpec.scala`) now exercises the production path end to end:
   - It seeds a real `csv` data source and pipeline root in embedded Postgres, started via `VerifiedEmbeddedPostgres.start` (C3).
   - It calls `PipelineRunService.submit(isDry = false)`. That goes through `InProcessExecutionBackend`, which calls `engine.executeTree` (`InProcessExecutionBackend.scala:61`), the only production caller.
   - It reads the persisted `node_snapshots` rows back through `NodeSnapshotRepository.listRows`.
   - It asserts on the snapshot rows:
     - `JsNumber(1.5)` / `JsNumber(2.25)` / `JsNull` amounts;
     - the original timestamp strings, with `JsNull` for `tomorrow`;
     - the downstream `filter amount = 1.5` keeping only id "1" (amount `JsNumber(1.5)`).
   - Both cases are red before the fix, which I reproduced myself. The flat-engine CSV cases were removed, and the change dir says they are not counted toward 1.6.

All other Phase-1 items from cycle 1 still hold:
- the ticket's acceptance criteria and owner rulings 1–3;
- the 422 status;
- C1–C5;
- the spec delta.

The design.md amendment correctly narrows D4's claim to "every config-carrying write path". It also records `duplicateStep` and the 422 on PATCH of a stored legacy step as known, out-of-scope consequences, which resolves the cycle-1 non-blocking note.

### Phase 2: Code Review — PASS

- **CR2: resolved.** `parsesAsDate` now sits on its own above the formatter block (`DateBucketStep.scala:126-128`). The 18-line input-shape scaladoc once again sits directly on `private def parseToUtcDate`.
- **CR3: resolved.**
  - `CastRuntimeParitySpec` iterates `CastStep.SupportedTargets` directly, so no copied list remains.
  - The `timestamp` family check now asserts the D3 predicate (`TimestampParsing.looksLikeTimestamp(s) || DateBucketStep.parsesAsDate(s)`). That makes it exactly as strict as D7 specifies, which also covers the cycle-1 suggestion.
  - The circular literal pin case in `CastSupportedTargetsSpec` was removed, and its scaladoc no longer makes the false claim.
- **CR4: resolved.** The timestamp GUARD now computes `abs($price)` over the timestamp-cast field (`NumericOpOnTextFieldWarningSpec.scala:108-114`).
- **CR5: resolved.** The section dividers are gone from `CastRuntimeParitySpec`.
- **Suggestion: done.** The CastStepSpec C5 test is renamed to say what its body actually checks.
- **Relabel: honest.** The stored-legacy test in CastRuntimeParitySpec was relabelled from "a real run" to "the engine", which is accurate.

There are no new production-code changes in this cycle beyond the scaladoc move.

### Phase 3: UI Review — N/A

No trigger path changed. The change is backend-only, and no frontend change is needed: the picker offers only a subset of `SupportedTargets`.

### Overall: PASS

### Non-blocking Suggestions
- **Task 1.7 still runs through the flat engine.** It says "a real run passes the value through unchanged", but its runtime half still uses the test-only `executeWithStepCounts` (CastRuntimeParitySpec "RED: the engine passes a non-String value through unchanged"), and the stored-legacy route test does not run the pipeline. The behaviour comes from `CastStep.apply`, which `executeTree` shares through `evalOneStep`, so the risk is low. A third CastPipelineRunSpec case would close the gap: insert a `string-body` cast with `insertInternal` and assert that the snapshot keeps the original value.
- **`*.log` evidence files are gitignored.** This affects `red-evidence.log`, `red-evidence-1.6.log` and `green-evidence.log`. They will not survive the squash or cleanup. red-evidence.md quotes the load-bearing lines, so persist the `.log` files with `persist-evidence.sh` if they are meant to be cited.

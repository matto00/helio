# Test-count evidence -- HEL-1393 (C1, C4, D9)

Full `nice -n 19 sbt testFull` (backend), run backgrounded to a log and awaited with `scripts/concertino/await-sentinel.sh`.
- BEFORE (baseline on the unmodified ecaa1a53 worktree): `Total number of tests run: 6436`, `Suites: completed 462, aborted 0`, `Tests: succeeded 6436, failed 0, canceled 4, ignored 0, pending 0`.
- AFTER (HEAD = commits a-d): `Total number of tests run: 6436`, `Suites: completed 462, aborted 0`, `Tests: succeeded 6436, failed 0, canceled 4, ignored 0, pending 0`.
- Per-suite leaf-test counts (`move-check/base-counts.json` vs `after-counts.json`, extracted by `suitecounts.py` from the ScalaTest output; 462 suites, sum 6440 = 6436 + 4 canceled): **identical for every suite** (`a == b` -> True; differing suites: none).
- `AutoRunGuardBurstProofSpec` (known flake, HEL-1439) passed on both runs; no re-run needed. No test failures (`*** FAILED ***`) in either log.

| Suite | before | after |
|---|---|---|
| PipelineRunServiceSpec | 87 | 87 |
| OutputRoutesSpec | 101 | 101 |
| ExistenceNotLeakedRoutesSpec | 61 | 61 |
| StepConfigInvalidRoutesSpec | 12 | 12 |
| UpsertTargetWritableRoutesSpec | 16 | 16 |
| PipelineRunRoutesSpec | 52 | 52 |
| PipelineRunServiceTerminalOrderingSpec | 10 | 10 |
| AutoRunGuardBurstProofSpec | 3 | 3 |
| AutoRunGuardNoRetryStormSpec | 1 | 1 |
| PipelineRunGuardIntegrationSpec | 10 | 10 |

## Test-source diff (C4), line by line

`git diff -U0 ecaa1a53...HEAD -- backend/src/test | grep -E '^[+-][^+-]' | grep -vE '^[+-]\s*(//|\*|/\*\*)'` (every non-comment changed line) is exactly these 5 lines, all in `ExistenceNotLeakedRoutesSpec.scala`:

```
-    Row("GET pipeline run status", HttpMethods.GET, s"/api/pipelines/{id}/runs/$SeededRunId", Pipeline, Set("PipelineRunService.scala"), seedRun = true),
+    Row("GET pipeline run status", HttpMethods.GET, s"/api/pipelines/{id}/runs/$SeededRunId", Pipeline, Set("PipelineRunQueries.scala"), seedRun = true),
-    "PipelineRunService.scala"       -> 2,
+    "PipelineRunPreview.scala"       -> 1,
+    "PipelineRunService.scala"       -> 1,
```

Everything else in the test diff is comment lines (stale-reference fixes, the pin doc line); describe/it name strings are untouched (verified by the identical per-suite counts and the zero non-comment lines above).

## Entry point size (D9 iv)
`wc -l PipelineRunService.scala`: 652 -> 385 at commit (a), 386 at HEAD after the comment edits (wc -l; < 400 goal). `PipelineRunPreview.scala`: 298.

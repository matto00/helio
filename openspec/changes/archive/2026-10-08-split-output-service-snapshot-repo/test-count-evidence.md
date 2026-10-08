# HEL-1187 test-count evidence (design D5b(d), constraint C1)

Baseline = `nice -n 19 sbt testFull` on a `git archive 24f6de4cf` copy of the full base tree (so `../schemas`, `shared-test-fixtures` resolve); After = the same command in this worktree at HEAD `0010efb84`. Logs are in the scratchpad (not committed); the totals below are pasted from them; per-suite counts are from `move-check/suitecounts.py` (counts `- ` leaf lines per ScalaTest suite header, canceled leaves included).

## Totals

```
BASELINE:
[info] Total number of tests run: 6180
[info] Suites: completed 443, aborted 0
[info] Tests: succeeded 6180, failed 0, canceled 4, ignored 0, pending 0
[info] All tests passed.
AFTER:
[info] Total number of tests run: 6180
[info] Suites: completed 443, aborted 0
[info] Tests: succeeded 6180, failed 0, canceled 4, ignored 0, pending 0
[info] All tests passed.
```

Both runs: sbt exit 0 ('[success]'), 6180 passed, 0 failed, 4 canceled (pre-existing, identical), 443 suites.

## Whole-suite comparison

- suites: baseline 443, after 443; leaf lines: baseline 6184, after 6184
- per-suite maps identical: True
- suites whose count differs: none

## Named suites (design D5b(d))

| Suite | baseline | after |
|---|---|---|
| ExistenceNotLeakedRoutesSpec | 61 | 61 |
| NodeSnapshotOverwriteRowsWithSpec | 3 | 3 |
| OutputRoutesSpec | 100 | 100 |
| PatchSetApplyFormCreateSpec | 7 | 7 |
| PatchSetApplyServiceSpec | 47 | 47 |
| PatchSetPreviewOutputContextSpec | 5 | 5 |
| PatchSetPreviewProjectionStepsUpsertSourceSpec | 2 | 2 |
| PatchSetPreviewRoutesSpec | 4 | 4 |
| PatchSetPreviewServiceSpec | 18 | 18 |
| PatchSetProtocolSpec | 28 | 28 |
| PatchSetRoutesSpec | 1 | 1 |
| PatchSetUndoInverseSpec | 6 | 6 |
| PatchSetUndoLaneSpec | 5 | 5 |
| PatchSetUndoPanelDashboardSpec | 5 | 5 |
| PatchSetUndoRefusalSpec | 5 | 5 |
| PatchSetUndoRepoWiringSpec | 1 | 1 |
| PatchSetUndoRoutesSpec | 4 | 4 |
| PublicDashboardRoutesSpec | 23 | 23 |

## Test sources untouched

```
$ git diff 24f6de4cf...HEAD --name-only -- backend/src/test | wc -l
0
```

# Test-count evidence (design D6c) - HEL-1404

Command (both runs): `cd backend && nice -n 19 sbt -J-Xmx3g testFull`, backgrounded to a scratchpad log, polled with `scripts/concertino/await-sentinel.sh`. Per-suite counts are the number of `[info] - ` test lines under each `[info] <Suite>:` header (`/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/counts.py`; canceled tests print as a test line too, so the per-suite sum is 6449 = 6445 run + 4 canceled).

Process note: the baseline run was started on the unmodified source; the working tree was edited while its tests were already running (postgres start logged 13:00:15, first edit 13:00:51), after compilation had finished. The baseline classes dir contained no `ExpressionTokenizer*` class and the baseline javap dumps were taken before the edit, so the baseline is the 0f95ec49 code. No flake occurred in either run; no re-run needed.

## Totals
```
BASELINE (0f95ec49, unmodified):
[info] Total number of tests run: 6445
[info] Suites: completed 463, aborted 0
[info] Tests: succeeded 6445, failed 0, canceled 4, ignored 0, pending 0
[info] All tests passed.
AFTER (split):
[info] Total number of tests run: 6445
[info] Suites: completed 463, aborted 0
[info] Tests: succeeded 6445, failed 0, canceled 4, ignored 0, pending 0
[info] All tests passed.
```

## Per-suite counts named by D6c (baseline = after)
```
ExpressionEvaluatorSpec  base=117 after=117
ComputeCoalesceCsvSpec  base=2 after=2
PipelineAnalyzeServiceSpec  base=134 after=134
AnalyzeSchemaWarningsSpec  base=56 after=56
ComputeStepSpec  base=9 after=9
WorkspaceContextServiceComputeColumnStatsSpec  base=35 after=35
WorkspaceContextServiceComputeJoinHintsSpec  base=12 after=12
```
Every suite whose name contains `Compute` is in that list (ComputeCoalesceCsvSpec, ComputeStepSpec, WorkspaceContextServiceComputeColumnStatsSpec, WorkspaceContextServiceComputeJoinHintsSpec).

## All 463 suites
`diff base-counts.txt after-counts.txt` (463 lines each: every suite name and count): empty - identical.

## Zero test diff
```
$ git diff --name-only <base>...HEAD -- backend/src/test | wc -l   (run after the commit; also `git status --short -- backend/src/test | wc -l` before it)
0 (working tree)
```

# Test-count evidence (HEL-1371, design D6d / C1)

Baseline: `nice -n 19 sbt testFull` on the unmodified worktree at 4db9730fd. After: the same on the split tree. Both exit 0.

```
baseline: [info] Tests: succeeded 6145, failed 0, canceled 4, ignored 0, pending 0
baseline: [info] Suites: completed 440, aborted 0
after:    [info] Tests: succeeded 6145, failed 0, canceled 4, ignored 0, pending 0
after:    [info] Suites: completed 440, aborted 0
```

Per-suite counts come from the `test-reports/TEST-*.xml` of each run (script: counts.py in the scratchpad; its totals include the 4 canceled tests, hence 6149).

`diff counts-base.txt counts-after.txt`: IDENTICAL (all 440 suites, per-suite test/failed/skipped counts)

Related suites (identical before and after):
```
ExistenceNotLeakedRoutesSpec tests=61 failed=0 skipped=0
PipelineRunRoutesSpec tests=52 failed=0 skipped=0
StepConfigInvalidRoutesSpec tests=12 failed=0 skipped=0
UpsertTargetWritableRoutesSpec tests=16 failed=0 skipped=0
AutoRunGuardBurstProofSpec tests=3 failed=0 skipped=0
AutoRunGuardNoRetryStormSpec tests=1 failed=0 skipped=0
DatasetWriteAutoRunCoalescingSpec tests=3 failed=0 skipped=0
DatasetWriteAutoRunEndToEndSpec tests=5 failed=0 skipped=0
PipelineRunGuardIntegrationSpec tests=10 failed=0 skipped=0
PipelineRunServiceAiStepClientWiringSpec tests=4 failed=0 skipped=0
PipelineRunServiceAlertBaselineSpec tests=1 failed=0 skipped=0
PipelineRunServiceOutputHistorySpec tests=8 failed=0 skipped=0
PipelineRunServiceSpec tests=87 failed=0 skipped=0
PipelineRunServiceTerminalOrderingSpec tests=10 failed=0 skipped=0
PipelineRunServiceUpsertSourceRlsSpec tests=2 failed=0 skipped=0
PipelineRunServiceUpsertSourceSpec tests=10 failed=0 skipped=0
UpsertTargetWritableRlsSpec tests=7 failed=0 skipped=0
```
TOTAL suites=440 tests=6149 failed=0 skipped=0

Other C1/C2 checks (run on the working tree against the base):
```
$ git diff 4db9730fd --stat -- backend/src/test | wc -l
0
$ grep -c 'ServiceError.Forbidden(' per file (base PipelineRunService.scala: 2)
PipelineRunService.scala: 2
PipelineRunSupport.scala: 0
PipelineRunTerminalWrites.scala: 0
PipelineRunSucceededWrites.scala: 0
PipelineRunExecutor.scala: 0
PipelineRunBackfill.scala: 0
PipelineRunQueries.scala: 0
```

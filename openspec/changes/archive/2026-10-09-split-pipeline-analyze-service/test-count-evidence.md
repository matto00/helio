# HEL-1385 test-count evidence (design D6d, C1)

Baseline: `nice -n 19 sbt testFull` on the unmodified worktree (ecaa1a53), log `baseline.log`. After: same command on the final tree, `after.log`.
```
baseline: [info] Total number of tests run: 6436
baseline: [info] Suites: completed 462, aborted 0
baseline: [info] Tests: succeeded 6436, failed 0, canceled 4, ignored 0, pending 0
baseline: [info] All tests passed.
after:    [info] Total number of tests run: 6436
after:    [info] Suites: completed 462, aborted 0
after:    [info] Tests: succeeded 6436, failed 0, canceled 4, ignored 0, pending 0
after:    [info] All tests passed.
```
Per-suite test-line counts for all 462 suites (awk over the logs): `diff baseline-counts after-counts` -> empty, exit 0.
Related suites (identical before and after):
```
AutoRunGuardBurstProofSpec: 3
AutoRunGuardNoRetryStormSpec: 1
AutoRunTriggerServiceSpec: 16
FireTimeRunConfigGateSpec: 10
JoinColumnCollisionSpec: 40
JoinColumnNamingSpec: 13
LookupColumnCollisionSpec: 24
PipelineAnalyzeAnalyzeWithAiSpec: 1
PipelineAnalyzeCanRunRoutesSpec: 3
PipelineAnalyzeConciseByteBudgetSpec: 1
PipelineAnalyzeConvertFormatSpec: 1
PipelineAnalyzeGenerateTextSpec: 4
PipelineAnalyzeJoinCollisionSpec: 3
PipelineAnalyzeProposalRoutesSpec: 18
PipelineAnalyzeRoutesSpec: 28
PipelineAnalyzeSchemaWarningsSpec: 8
PipelineAnalyzeServiceSpec: 134
PipelineAnalyzeUpsertSourceSpec: 2
SchemaFieldJsonFormatTolerantReadSpec: 4
SchemaFieldRealDumpInvariantSpec: 1
SchemaFieldStructuralGuardSpec: 5
StepEnumWriteValidationSpec: 14
```
AutoRunGuardBurstProofSpec (HEL-1439 flake) passed first time in both runs; no re-run needed.

Test-source diff vs base:
```
 .../scala/com/helio/services/pipelines/AutoRunTriggerServiceSpec.scala  | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
--- a/backend/src/test/scala/com/helio/services/pipelines/AutoRunTriggerServiceSpec.scala
+++ b/backend/src/test/scala/com/helio/services/pipelines/AutoRunTriggerServiceSpec.scala
-import com.helio.domain.steps.{AnalyzeWithAiConfig, ComputeConfig, AnalyzeWithAiOutputField, UpsertMode, UpsertSourceConfig, UpsertTarget}
+import com.helio.domain.steps.{AnalyzeWithAiConfig, AnalyzeWithAiOutputField, ComputeConfig, UpsertMode, UpsertSourceConfig, UpsertTarget}
```

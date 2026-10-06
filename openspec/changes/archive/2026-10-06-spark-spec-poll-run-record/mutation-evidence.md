# Mutation + timing evidence (HEL-1325)

Note: the lastRunStatus-only poll in M1-old is a RECONSTRUCTION; HEL-1287's poll never landed in git.
Mutation edits to backend/src/main were temporary and restored with git checkout --; 'git diff --stat -- backend/src/main' was empty after M2 and after the final restore.

## M0 baseline (new poll, unmutated product code): GREEN
[info]   - should call updateLastRun with 'succeeded' and persist a succeeded run record (1 second, 304 milliseconds)
[info]   - should call updateLastRun with 'failed' and persist a generic errorLog (no raw exception text) (930 milliseconds)
[info] Tests: succeeded 17, failed 0, canceled 0, ignored 0, pending 0

## M1 mutation (Thread.sleep(2000) between updateLastRunInternal and updateRunTerminalInternal, both paths)
```
diff --git a/backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala b/backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala
index c0d5e5c60..a2227632e 100644
--- a/backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala
+++ b/backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala
@@ -83,6 +83,7 @@ class SparkJobSubmitter(
           // discipline as `updateRunTerminalInternal` below. `false`, not `None`, since this path
           // never omits a row count either -- "recorded, nothing truncated" is the honest value.
           pipelineRepo.updateLastRunInternal(pipeline.id, RunStatus.Succeeded, now, truncated = Some(false))
+          Thread.sleep(2000)
           if (pipelineRunRepo != null) {
             // HEL-873 (design.md task 2.8): this path is dormant (nothing calls `submit`), but
             // `truncatedReadsJson` takes NO default -- an explicit value here is what keeps a
@@ -107,6 +108,7 @@ class SparkJobSubmitter(
             // HEL-873: a failed run persists no row count, so `truncated = false` is the same
             // "recorded, nothing truncated" convention `PipelineRunService`'s failure paths use.
             pipelineRepo.updateLastRunInternal(pipeline.id, RunStatus.Failed, now, truncated = Some(false))
+            Thread.sleep(2000)
             if (pipelineRunRepo != null) {
               // HEL-873 (design.md Decision 2a): a failed run writes a recorded, empty signal,
               // never NULL.
```
### M1 + reconstructed lastRunStatus-only poll: RED
[info]   - should call updateLastRun with 'succeeded' and persist a succeeded run record *** FAILED *** (1 second, 391 milliseconds)
[info]     "[queu]ed" was not equal to "[succeed]ed" (SparkJobSubmitterSpec.scala:399)
[info]   - should call updateLastRun with 'failed' and persist a generic errorLog (no raw exception text) *** FAILED *** (999 milliseconds)
[info]     "[queu]ed" was not equal to "[fail]ed" (SparkJobSubmitterSpec.scala:439)
[info] Tests: succeeded 15, failed 2, canceled 0, ignored 0, pending 0
### M1 + new poll: GREEN
[info]   - should call updateLastRun with 'succeeded' and persist a succeeded run record (3 seconds, 430 milliseconds)
[info]   - should call updateLastRun with 'failed' and persist a generic errorLog (no raw exception text) (2 seconds, 977 milliseconds)
[info] Tests: succeeded 17, failed 0, canceled 0, ignored 0, pending 0

## M2 mutation (terminal run write first, Thread.sleep(2000), then updateLastRunInternal)
```
diff --git a/backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala b/backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala
index c0d5e5c60..f5dd042a0 100644
--- a/backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala
+++ b/backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala
@@ -82,7 +82,6 @@ class SparkJobSubmitter(
           // HEL-873 (evaluation-1.md non-blocking suggestion): `truncated` has no default -- same
           // discipline as `updateRunTerminalInternal` below. `false`, not `None`, since this path
           // never omits a row count either -- "recorded, nothing truncated" is the honest value.
-          pipelineRepo.updateLastRunInternal(pipeline.id, RunStatus.Succeeded, now, truncated = Some(false))
           if (pipelineRunRepo != null) {
             // HEL-873 (design.md task 2.8): this path is dormant (nothing calls `submit`), but
             // `truncatedReadsJson` takes NO default -- an explicit value here is what keeps a
@@ -92,6 +91,8 @@ class SparkJobSubmitter(
             // value, not "not recorded".
             pipelineRunRepo.updateRunTerminalInternal(runId, RunStatus.Succeeded, now, rowCount = Some(rows.size), errorLog = None, truncatedReadsJson = Some(PipelineRunService.EmptyTruncationJson))
           }
+          Thread.sleep(2000)
+          pipelineRepo.updateLastRunInternal(pipeline.id, RunStatus.Succeeded, now, truncated = Some(false))
         } catch {
           case ex: Throwable =>
             // HEL-311: this `errorMsg` fans out to the same client-visible
@@ -106,12 +107,13 @@ class SparkJobSubmitter(
             cache.update(runIdStr, RunStatus.Failed, error = Some(errorMsg))
             // HEL-873: a failed run persists no row count, so `truncated = false` is the same
             // "recorded, nothing truncated" convention `PipelineRunService`'s failure paths use.
-            pipelineRepo.updateLastRunInternal(pipeline.id, RunStatus.Failed, now, truncated = Some(false))
             if (pipelineRunRepo != null) {
               // HEL-873 (design.md Decision 2a): a failed run writes a recorded, empty signal,
               // never NULL.
               pipelineRunRepo.updateRunTerminalInternal(runId, RunStatus.Failed, now, rowCount = None, errorLog = Some(errorMsg), truncatedReadsJson = Some(PipelineRunService.EmptyTruncationJson))
             }
+            Thread.sleep(2000)
+            pipelineRepo.updateLastRunInternal(pipeline.id, RunStatus.Failed, now, truncated = Some(false))
         }
       }
     }(sparkEc)
```
### M2 + run-record-only poll: RED
[info]   - should call updateLastRun with 'succeeded' and persist a succeeded run record *** FAILED *** (1 second, 329 milliseconds)
[info]     None was not equal to Some("succeeded") (SparkJobSubmitterSpec.scala:397)
[info]   - should call updateLastRun with 'failed' and persist a generic errorLog (no raw exception text) *** FAILED *** (998 milliseconds)
[info]     None was not equal to Some("failed") (SparkJobSubmitterSpec.scala:434)
[info] Tests: succeeded 15, failed 2, canceled 0, ignored 0, pending 0
### M2 + new poll: GREEN
[info]   - should call updateLastRun with 'succeeded' and persist a succeeded run record (3 seconds, 322 milliseconds)
[info]   - should call updateLastRun with 'failed' and persist a generic errorLog (no raw exception text) (2 seconds, 951 milliseconds)
[info] Tests: succeeded 17, failed 0, canceled 0, ignored 0, pending 0

## Timing (same machine, back-to-back, unmutated product code, -oD)
Before (Thread.sleep(3000)):
[info]   - should call updateLastRun with 'succeeded' and persist a succeeded run record (4 seconds, 252 milliseconds)
[info]   - should call updateLastRun with 'failed' and persist a generic errorLog (no raw exception text) (3 seconds, 836 milliseconds)
After (poll):
[info]   - should call updateLastRun with 'succeeded' and persist a succeeded run record (1 second, 304 milliseconds)
[info]   - should call updateLastRun with 'failed' and persist a generic errorLog (no raw exception text) (930 milliseconds)
Delta: (4.252+3.836) - (1.304+0.930) = 5.854 s saved across the two tests (spec total 12.264 s -> 5.859 s)

## Full suite: nice -n 19 sbt testFull, exit=0
[info] Run completed in 5 minutes, 32 seconds.
[info] Tests: succeeded 6026, failed 0, canceled 0, ignored 0, pending 0

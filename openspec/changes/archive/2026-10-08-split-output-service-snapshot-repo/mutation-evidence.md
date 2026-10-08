# HEL-1187 mutation evidence (design D5b(c), ticket AC)

One single-token mutation per new/receiving file, each run with `sbt "testOnly *OutputRoutesSpec"` (nice -n 19) against the committed split. `OutputRoutesSpec` reaches every mutated line THROUGH the public `OutputService` / HTTP route surface, so each red also proves the delegation or forwarder is live. Every mutation was reverted (byte-identical `cmp` against a saved copy, recorded below). Harness: `move-check/mutate.sh` + `move-check/runmuts.sh`; raw logs not committed (scratchpad); the failing-test lines below are pasted from them.

## NodeSnapshotFilterSql

```diff
@@ -66 +66 @@
-      sortCastExpr(column, cast).concat(sql" >= ").concat(opValueCastExpr(value, cast))
+      sortCastExpr(column, cast).concat(sql" > ").concat(opValueCastExpr(value, cast))
```
```
[info] - should narrows the WHOLE Output on a date-range AND an in-list column together, not just the fetched page *** FAILED ***
[info] - should a gte+lte pair on the same column expresses a range *** FAILED ***
[info] Tests: succeeded 98, failed 2, canceled 0, ignored 0, pending 0
[info] *** 2 TESTS FAILED ***
sbt exit=1
```
Reverted: filtersql reverted byte-identical.

## OutputRowReads

```diff
@@ -130 +130 @@
-        lastSuccess.exists(t => !t.isBefore(output.createdAt))
+        lastSuccess.exists(t => t.isBefore(output.createdAt))
```
```
[info] - should 200 with an empty page and materialized=true when a successful run completed after the Output was created *** FAILED ***
[info] Tests: succeeded 99, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
sbt exit=1
```
Reverted: rowreads reverted byte-identical.

## OutputRootResolution

```diff
@@ -30 +30 @@
-        if (roots.size > 1)
+        if (roots.size > 2)
```
```
[info] - should 400, naming the root count, when a create names NEITHER nodeStepId NOR rootId on a two-root pipeline *** FAILED ***
[info] Tests: succeeded 99, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
sbt exit=1
```
Reverted: rootres reverted byte-identical.

## OutputConfigValidation

```diff
@@ -199 +199 @@
-  def mergeConfig(existing: JsObject, patch: JsObject): JsObject = JsObject(existing.fields ++ patch.fields)
+  def mergeConfig(existing: JsObject, patch: JsObject): JsObject = JsObject(patch.fields ++ existing.fields)
```
```
[info] - should shallow-merge a config patch: named keys replace, absent keys are kept (HEL-877/HEL-1313) *** FAILED ***
[info] Tests: succeeded 99, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
sbt exit=1
```
Reverted: cfgval reverted byte-identical.

## Result
4/4 mutations red (none stayed green, so no test-gap follow-up candidate arises from this set). The full suite is green on the unmutated committed tree (test-count-evidence.md).

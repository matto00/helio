# Move evidence (commit a) -- HEL-1393

Base = ecaa1a53 `PipelineRunService.scala` (652 lines). Checker: `move-check/check.py` (adapted from #847's), exact and
positional: `PipelineRunPreview.scala` must equal `scaffold-head (24 lines incl. package/imports/class header/`import support`) + base lines 261-534
verbatim + closing brace`; `PipelineRunService.scala` must equal base with (i) base 261-534 replaced by the two delegations,
(ii) the `preview` val inserted after `import executor.runPipeline`, (iii) the declared import edits (`move-check/edits.json`). Any other
line, extra, missing, altered or out-of-order, fails.

Premise corrections (recorded): AI-gate producer is at base :487 (ticket said :486); ticket item 3 (`log` unused) is stale (used at :234 since HEL-1384).

## Green run
```
preview: 298 lines (274 moved verbatim base lines 261-534, 24 scaffold); entry: 385 lines (base 652)
PASS
```

## Red runs (each must FAIL)

1. Forward -- one token changed inside a moved body (`getOrElse(roots.head)` -> `.last`):
```
preview: 298 lines (274 moved verbatim base lines 261-534, 24 scaffold); entry: 385 lines (base 652)
FAIL
PREVIEW differs from HEAD+moved+TAIL:
--- expected
+++ actual
@@ -175 +175 @@
-            val selectedRoot = rootId.flatMap(rid => roots.find(_._1 == rid)).getOrElse(roots.head)
+            val selectedRoot = rootId.flatMap(rid => roots.find(_._1 == rid)).getOrElse(roots.last)
exit=1
```

2. Reverse -- a stray line inserted outside any member of the new file:
```
preview: 299 lines (274 moved verbatim base lines 261-534, 24 scaffold); entry: 385 lines (base 652)
FAIL
PREVIEW differs from HEAD+moved+TAIL:
--- expected
+++ actual
@@ -25,0 +26 @@
+  private val stray = 1  // inserted outside any member
exit=1
```

3. Entry point -- a stray line added to the entry point:
```
preview: 298 lines (274 moved verbatim base lines 261-534, 24 scaffold); entry: 386 lines (base 652)
FAIL
ENTRY differs from expected:
--- expected
+++ actual
@@ -381,0 +382 @@
+  private val stray = 2
exit=1
```

## Sizes
`wc -l`: `PipelineRunService.scala` 652 -> 385 (goal < 400); `PipelineRunPreview.scala` 298 (24 scaffold + 274 verbatim).
Removed imports in the entry point (now unused): `OutputPreviewEntry`, `AssertionSink`, `DataSource`, `Output`, `Pipeline`, `TruncationSink`,
`NodeDependencyClosure`, `PipelineCostEstimator`, `PipelineRowJson`, `StepKey`, and the `import support.{...}` line (all four names used only in the moved code).
(`DataSource`/`Output`/`Pipeline` appeared in the old moved code only inside string literals and were already unused imports at base.)

## Pin (design D2): `ExistenceNotLeakedRoutesSpec`
Diff: `"PipelineRunService.scala" -> 2` becomes `"PipelineRunPreview.scala" -> 1` + `"PipelineRunService.scala" -> 1`; row "GET pipeline run status" site
`PipelineRunService.scala` -> `PipelineRunQueries.scala`; one doc line. The comparison code and all other entries are untouched.
The row re-site is COSMETIC: no `PipelineRun*.scala` file calls an access helper, so no check reads those `sites`; a green spec does not verify it.

Green: `Tests: succeeded 61, failed 0` (pin-green.log). Red checks (scratch, reverted; `cmp` confirms the file restored):

- Third `ServiceError.Forbidden(` producer added inside `PipelineRunPreview.scala`: pin test FAILS -- map shows `"PipelineRunPreview.scala" -> 2`:
```
[info] - should pin the per-file count of ServiceError.Forbidden producers so none ships unclassified *** FAILED ***
[info] Tests: succeeded 60, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```
- Third producer in a brand-new file `RedProbe.scala`: pin test FAILS -- map gains `"RedProbe.scala" -> 1`:
```
[info] - should pin the per-file count of ServiceError.Forbidden producers so none ships unclassified *** FAILED ***
[info] Tests: succeeded 60, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```
The failing assertion is the exact-map equality in both cases (`actual shouldBe expectedForbiddenProducers`).

# Commit (b): whitespace-only reindent (design D6)

Reindented: `PipelineRunTerminalWrites.executeRunFailure` body (dedent 4: it sat 8 deep inside a 2-deep method; the `.map` continuation likewise), and `PipelineRunPreview.previewAtNode`'s source-level `case _ =>` block (+4) and AI-gate `case true =>` block (+4, with the `.recover` body/closer +6 so it nests under `.recover`).

`git diff -w --ignore-blank-lines --stat` (must be empty) -- commit (b) vs (a):
```
(no output)
 openspec/changes/move-pipeline-preview-out/move-evidence.md | 8 ++++++++
 1 file changed, 8 insertions(+)
```

`git diff --stat` (the real change):  3 files changed, 111 insertions(+), 99 deletions(-)

`javap -c -p -l` of every class of `PipelineRunPreview` and `PipelineRunTerminalWrites` (8 classes incl. anonymous), captured at (a) and at (b); `move-check/javap-c.sh`:
```
$ diff -r disasm-a disasm-b ; echo exit=$?
exit=0
```
Red run (non-empty required): one blank line inserted above `previewAtNode` (shifts line tables), recompile, diff -rq:
```
Files 'disasm-b/PipelineRunPreview$$anonfun$$nestedInanonfun$previewAtNode$14$1.txt' and 'disasm-bred/PipelineRunPreview$$anonfun$$nestedInanonfun$previewAtNode$14$1.txt' differ
Files 'disasm-b/PipelineRunPreview$$anonfun$$nestedInanonfun$previewAtNode$2$1.txt' and 'disasm-bred/PipelineRunPreview$$anonfun$$nestedInanonfun$previewAtNode$2$1.txt' differ
Files disasm-b/PipelineRunPreview.txt and disasm-bred/PipelineRunPreview.txt differ
```
The file was restored afterwards (`git diff -w` empty again; recompiled).

# Commit (c): dead member `PipelineRunSupport.resolvePrimaryDataSourceInternal` (design D5)

Zero-caller grep at ecaa1a53 (`grep -rn resolvePrimaryDataSourceInternal backend/src`, main + test, whole word incl. strings): 3 hits = the definition (`PipelineRunSupport.scala:105`) and the two doc refs (:113, :117). No other occurrence in `backend/src` or `frontend`. After: 0 hits in `backend/src`.
The two docs that cited it were rewritten to stand alone (the old paragraph describing the helper went with it).

`javap -p` of `PipelineRunSupport` before vs after (only the method and its lambda go; nothing else changes):
```
12d11
<   private scala.concurrent.Future<scala.Option<com.helio.domain.model.DataSource>> resolvePrimaryDataSourceInternal(java.lang.String);
22d20
<   public static final scala.concurrent.Future $anonfun$resolvePrimaryDataSourceInternal$1(com.helio.services.pipelines.PipelineRunSupport, scala.Option);
```
Filtered `javap -public` of the entry point etc. after (c): identical to baseline (`diff javap-base.filtered javap-c.filtered` empty).

Left alone (named follow-up, per skeptic-design-1): `PipelineRepository.findPrimaryDataSourceIdInternal` (:117) now has no code callers in main or test, only comment mentions.

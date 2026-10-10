## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `6aa8f1e7c53fc0349f387c618f7bcde7052184cb` against the live-resolved base `1b765f59d0d09d2d60d5c05f31a2e06083e3a105`
(`resolve-review-base.sh`, exit 0). Backend-only change, so there is no UI to review. Scratch scripts are in the session scratchpad; I edited no tracked file.

### What I verified (with evidence)

**Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-pipeline-service/hel-1463`.

**1. My own byte-move check, separate from the executor's gen.py/check.py.** The executor wrote both the generator and the checker, so I did not rely on them. I wrote my own multiset diff over all non-blank lines: BASE `PipelineService.scala` against the ten resulting files.
- Lines in BASE but missing after the change: only the 8 base import lines that were redistributed, plus the 13 `private def` declaration lines that became `private[pipelines] def`.
- Lines added after the change: only these:
  - package and import lines
  - the 9 class headers and docs, and the constructor-parameter lines
  - `import support.{...}` and the sibling member imports
  - 4 lines of `LoggerFactory.getLogger(classOf[PipelineService])`
  - 9 wiring vals
  - the one-line delegations and their signatures
  - closing braces

  No body line was added, altered or lost.
- I also re-ran the executor's `check.py`: `PASS`, rc=0, 75 blocks, 2434 lines, 0 unclaimed and 0 multiply-claimed. The script calls `sys.exit(1)` on FAIL. The `exit=0` printed under RED 1 in `red-runs.txt` is a capture artefact: the FAIL text with the exact mismatched line is there.

**2. Things a byte-move proof cannot see. I checked each one directly.**
- **Name binding / shadowing.** My script took every BASE class member and constructor-param name (79 names). For each new file it listed the names used in code (comments and strings stripped, `.`-qualified uses excluded) that are not bound by that file's own defs, constructor params or `import x.{...}` lines. The result was empty for all ten files. So no moved body silently binds a former member name to something else, such as a package or a wildcard import.
- **Overloads and default/by-name arguments.**
  - BASE has no overloaded member names (`uniq -d` is empty).
  - `audit`'s default `metadata` is reached through a member import of `support.audit`, so the default is preserved.
  - The only by-name parameter, `compensatingInlineSources(body: => ...)`, moved together with its only callers into `PipelineCreateWrites`.
- **Implicit resolution.** BASE had file-level `DefaultJsonProtocol._`, `schemaFieldJsonFormat` and Slick `api._`.
  - Across the nine new files, the only implicit-sensitive JSON call is `convertTo[Vector[SchemaField]]` at `PipelineAnalyzeReads.scala:256`. That file keeps both `DefaultJsonProtocol._` and the explicit `schemaFieldJsonFormat`.
  - `SchemaField` (`domain/engine/SchemaField.scala:23`) has no companion object, so no other format could have been picked up from implicit scope.
  - `DBIO` is used only in `PipelineCreateTransaction`, which keeps Slick `api._`.
  - Each collaborator takes `implicit ec`, and the entry point's own `ec` is passed to it.
- **Initialisation order.**
  - All 9 collaborators are `private val`s declared after `costInputGathering`.
  - `createWrites` is declared after `rootWrites` and `createTransaction`.
  - All other constructor arguments are constructor params, which are already set when the collaborators are built.
  - `requireEditorAccess` is eta-expanded from a method, so it captures `this`, not a field value.
  - I checked the positional order of every wiring call against each class's parameter list. All 9 match, and none has same-typed parameters that could be silently swapped.
- **Mutable state and lambda capture.** BASE's class body has no `var`, `lazy val` or `synchronized`. The new files have no `this`/`getClass` use except the pre-existing `other.getClass.getName` inside an error message.
- **Logger name.** The entry point keeps `getLogger(getClass)` on a `final` class, and the four logging collaborators use `classOf[PipelineService]`. Both give the logger name `com.helio.services.pipelines.PipelineService`. No new file has any other `getLogger`.
- **Compiler warnings.** None for the ten files, in `compile1.log`, `compile2.log` or the evaluator's fresh testFull log.

**3. Does the evidence prove what it claims?**
- **javap (AC3).** The base and after filtered files are identical (`diff` prints nothing).
  - I inspected what the filter drops besides `$anonfun$` lines. The only such line in BASE is `public org.slf4j.Logger com$helio$services$pipelines$PipelineService$$log();`, and it is gone after the change. That is a compiler-synthesised accessor for the private `log`, which BASE needed because lambdas inside the class read `log`. It cannot be called from Scala source, so this is not a behaviour change, and it is exactly the `$$` category that D6(b) declares up front.
  - The javap red run (an added trailing defaulted parameter shows up in the diff) is recorded with real diff output.
- **testFull (AC4).**
  - The executor's base and after logs and the evaluator's fresh HEAD run (`eval-1/eval-sbt-after.log`, 13:10, after the 12:53 commit) all contain `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0` and `Tests: succeeded 6655, failed 0, canceled 4`.
  - I ran `suites.py` myself on the evaluator's log: its output is identical to the committed `suites-base.tsv` (484 suites).
  - The run took 559 s of test execution and lists every test, so it was not a cached no-op. I did not re-run sbt: the evaluator's output is fresh, at HEAD, and unambiguous.
- **Mutation red runs.** `mutation-evidence.md` records 9 mutations, one per collaborator, each red with a distinct assertion. Run 1's undetected sites are disclosed as coverage gaps rather than hidden. The evaluator independently reproduced M4 red and then green.
- **Test diff (AC5).** `git diff 1b765f59d...HEAD -- backend/src/test | wc -l` gives 0.

**4. Acceptance criteria**

| AC | Status | Evidence |
|---|---|---|
| AC1 | met | 9 `private[pipelines] final class` files in `com.helio.services.pipelines`. No behaviour change, per sections 1 and 2. |
| AC2 | met | My multiset check and the re-run `check.py` both pass. Red runs for forward and reverse are in `move-check/red-runs.txt`. |
| AC3 | met | The filtered javap diff is empty, with a red run. The one hidden non-lambda line is the declared synthetic accessor. |
| AC4 | met | Per-suite results are identical. `[hel1468-guard]` appears in both runs and in the evaluator's run. |
| AC5 | met | The test diff is empty. |
| AC6 | met | Nothing was fixed. Follow-up candidates are listed in `move-evidence.md` and `mutation-evidence.md`. |

Constraints C2 (`ServiceError.Forbidden(` appears only in the entry point) and C3 are confirmed by the evaluator's greps and by my own reading.

### Verdict: CONFIRM

### Non-blocking notes
- `api-evidence.md` should name the one non-`$anonfun$` line the filter dropped, BASE's `PipelineService$$log` accessor. Right now a reader has to diff the raw dumps to see that something besides lambdas was filtered out.
- `move-check/red-runs.txt` prints `exit=0` under a FAIL. The checker does exit 1, so this is just misleading capture.
- These should be opened as follow-up tickets, as already listed: the coverage gaps (blank pipeline name 400; `laneTree` unknown-pipeline 404; inline static source missing config; `updateStep` no-row-after-update), the dead `stepAddress`, the unused entry-point `log`, and the stale `PipelineService.scala` line citations in comments.
- Gate-defect check (CON-160): none of the evidence depends on mtime ordering. My conclusions rest on content diffs, multiset comparison and log contents.

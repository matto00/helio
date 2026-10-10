## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD `6902b57f12a18042daf9b8e4984cc55b2011fc84` (the planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/embedded-postgres-port-race/HEL-1445`.

- **Round-3 revisions: all six are present in the text.**
  - **D8 overlap redefinition.** It now uses suite pairs from different groups (`floorMod 4` of the Java hashCode) and excludes instance-level overlap (design.md:94). C5 matches (tasks.md:7).
  - **D7 static-start rule.** It has the no-identifier-char-before rule and the negative case for the wrapped call (design.md:85, :87).
  - **D6 steps 4–5.** Both now say `VerifiedEmbeddedPostgres.startWith(` (design.md:77-78).
  - **Step-5 observer.** It runs the real SHOW, records the result, then throws (design.md:78).
  - **D4/D6 port wording.** Both now say `setPort(nextPort())` (design.md:48).
  - **Step-2 instance.** It is closed in a `finally` (design.md:87).

  These close round 3's text-level findings. Ground-truth checks follow.

- **zonky 2.0.7, re-read** from the sources jar unzipped into scratchpad `hel1445-zonky4`:
  - `Builder.start` assigns `builderPort = detectPort()` only `if (builderPort == 0)` (line 577-579), so `setPort(0)` restores auto-detect and D4's production `nextPort = () => 0` is sound.
  - The data dir is created with `createTempDirectory("epg")` only when unset (581-582).
  - `setPort` is at line 555 and `setDataDirectory` at 522-531.
  - `startPostmaster` (254-286) passes `-D dataDirectory.getPath()` with `-w start` and never reads the exit status.
  - The constructor runs `initdb` into an existing empty dir when `cleanDataDirectory` is set (146-148).

  The D2 and D3 premises hold.

- **Census.**
  - `grep -rn "EmbeddedPostgres.builder()" backend/src` gives 226 occurrences in 221 files. 223 use the `stringtype` form, 2 are bare (`PipelineRunCrossInstanceSpec:44`, `LegacyOutputConfigKeysParitySpec:25`), and 1 is the multi-line chain (`SqlConnectorTlsSpec:37-41`, where `.start()` sits on its own line, so D5's predicted output is accurate).
  - Every one of the 221 files has a top-level `import io.zonky.test.db.postgres.embedded.EmbeddedPostgres`. The only importer without a builder call is `FirstRunRoutesSpec`, which correctly falls outside the migration set.
  - There are no wildcard or rename imports, no static `EmbeddedPostgres.start`, and no `PreparedDb`/rules usage. The guard's import and static rules start from a clean tree.

- **Loop suite set.** All 13 existing classes resolve to packages; the 2 new ones go in `com.helio.testkit`. The 10 `OutputHistoryApiHarness` mixers match the list (`NodePayloadFixtures` references the harness but is not a suite). Computed `floorMod(hashCode, 4)` groups are {0: 4, 1: 3, 2: 5, 3: 3}, so the set spans all four groups.

- **RLS mutation target.**
  - `OutputHistoryApiHarness.scala:76` has `CREATE ROLE $roleName NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN`, and `assertAppPoolEnforcesRls` is at :120.
  - It is called from `OutputHistoryRoutesSpec` and `OutputHistoryPayloadRoutesSpec`, matching D8.

- **build.sbt grouping.**
  - Grouping is `floorMod(t.name.hashCode, groupCount)` (build.sbt:233). `testForkedParallel := false` is at :119.
  - The concurrency override applies only when `HEL924_TEST_GROUP_CONCURRENCY` is set (:192-200). CI's values are 2 and 4 (ci.yml:173-174).

- **Where sbt 2 writes JUnit XML, and what its fields mean (load-bearing for D8).**
  - **Location.** In a recent sbt 2.0.9 run, reports are at `backend/target/out/jvm/scala-2.13.15/helio-backend/test-reports/` (481 files in the HEL-1468 worktree, dated 2026-10-09), **not** `backend/target/test-reports/`. In the main checkout, `backend/target/test-reports/` holds only stale sbt-1 reports (newest file 2026-09-11; the header shows an sbt 1.10 launcher). D8 already delegates the location check to the executor.
  - **`time` field.** `javap -c sbt/JUnitXmlTestsListener$TestSuite.class` (from `testing_3-2.0.9.jar`, unzipped into scratchpad `hel1445-sbt4`) shows `time` is `events.map(_.duration).sum`. That is the sum of per-test durations, which excludes `beforeAll`/`afterAll`, where every spec starts its embedded Postgres.
  - **`timestamp` field.** It is `LocalDateTime.now` at TestSuite construction, formatted to whole seconds. In forked mode it is the suite's end:
    - `PipelineRunServiceTerminalOrderingSpec` has `time="24.48"` and `timestamp="2026-10-09T23:22:05"`, and its file was written at 23:22:05.452.
    - `ApiRoutesSpec` has 18.146 s and `DataSourceRoutesSpec` 10.82 s. Both show the same pattern.

    Disclosure: this reading compares a content attribute with file mtime. The content-only analysis in the next item corroborates it independently.
  - **Content-only corroboration.** Suites in one forked group run one at a time, so any overlap a span formula reports between two of them is false. Over those 481 reports, counting same-group pairs whose spans overlap by more than 1 s gives:

    | Span formula | groupCount 4 | groupCount 8 |
    |---|---|---|
    | D8's `[timestamp, timestamp+time]` | **8** (impossible) | **8** (impossible) |
    | `[timestamp−time, timestamp]` | 0 | 0 |

    With no margin, the counts are 449 and 319 respectively, because whole-second truncation alone makes sub-second suites appear to overlap. Script: scratchpad `ov2.py`. No report mtime is used in this item.

- **The log format the parity extraction depends on.**
  - A real full-run sbt 2 log (`.claude/worktrees/bug/reorder-every-root-lane/sbt-eval.log`) has 363 per-suite `[info] <SimpleName>Spec:` headers.
  - It has exactly **one** `Tests: succeeded 5233, failed 0, …` line: the aggregate at line 47926, after `Suites: completed 363, aborted 0`.
  - Per-suite `Tests: succeeded N, failed M` lines do not exist in this build's log.

- **sbt env capture.** MISTAKES.md:298-299 says "The sbt server captures its env when it starts, so after a fresh `export` run `sbt shutdown`". The repo's canonical runners use `--server` (`scripts/ci-sbt.sh:35`) or `-batch -Dsbt.server.autostart=false` (MISTAKES.md:332). D8 and C5 set the env vars but specify neither a fresh JVM nor a check that the setting took effect.

### Verdict: REFUTE

The six round-3 edits landed. The helper, guard, codemod and verifier design is sound, and its zonky premises hold. However, D8's proof plan still has these defects, each verified against this repo's real sbt 2 output:

- its overlap formula reports concurrency that never happened;
- its parity extraction reads per-suite lines that do not exist;
- its loop verdict can pass an iteration in which no test ran.

The owner's binding requirements are a testFull per-suite parity check and a concurrent loop judged by log. As written, D8 can certify both without the underlying fact being true. All three are text-only fixes.

### Change Requests

1. **D8 / C5: the overlap span is computed backwards, so it reports overlap between suites that run one after another.**
   - **What is wrong.** In this sbt 2.0.9 forked build, a `<testsuite>`'s `timestamp` is the suite's **end** (whole seconds), and `time` is the sum of test durations, excluding `beforeAll`/`afterAll`. D8's `[timestamp, timestamp+time]` is a window that starts after the suite finished.
   - **Measured.** On 481 real reports, that formula yields 8 same-group pairs overlapping by more than 1 s. Suites in one group run one at a time, so those 8 are certain false positives. The end-based formula yields 0.
   - **Impact.** A loop whose groups silently ran back to back (the HEL-1287 mode C5 exists to catch) can still "show" overlap between different groups.
   - **Fix.** Revise D8 (design.md:94) and C5 (tasks.md:7):
     - (a) Use the span `[timestamp − time, timestamp]`. State that `timestamp` is the end second and `time` excludes setup/teardown.
     - (b) Require the overlap between different groups to exceed a stated margin of at least 1 s. This absorbs the whole-second truncation.
     - (c) Clear, or copy aside, the test-reports dir before each iteration. Count only that iteration's files: with a fixed suite set, every iteration overwrites the same file names.
     - (d) In each loop and parity run, record `show Global/concurrentRestrictions` and require it to print `Limit forked-test-group to 2`. This is the HEL-1287 probe and is self-authenticating.
2. **D8 parity extraction reads per-suite `Tests: succeeded N, failed M` lines that the sbt 2 log does not contain.** The log has one aggregate `Tests:` line per run, plus per-suite name headers. So "identical per-suite results (test counts, pass/fail)" (AC6) cannot be derived as D8 (design.md:91) describes.
   - **Specify the source.** Take per-suite test, failure, error and skipped counts from each run's JUnit XML: one `<testsuite>` per suite, from the location the executor confirms. Use this ordering:
     1. Copy each run's reports aside first, because base and branch share no target dir but share file names.
     2. Take the suite set from the XML and cross-check it against the log's `<Suite>:` headers.
     3. Take aborted suites from the log (`*** ABORTED` / `RUN ABORTED`), since an aborted suite may write no XML.
     4. Also compare the aggregate `Suites: completed N, aborted M` and `Tests:` lines.
   - **Update task 5.2** to match.
3. **The loop verdict (D8 / C3 / task 5.3) is satisfied by an iteration in which nothing ran.**
   - **The gap.** The only per-iteration criterion is zero hits for the four failure strings. A no-op iteration has zero hits too. A no-op can come from several causes:
     - a cached task (sbt 2 caching, MISTAKES.md:310-317);
     - a `testOnly` filter that matched nothing;
     - an sbt process that attached to a server started with different env (MISTAKES.md:298-299, 319-339).
   - **The fix.** Require positive evidence per iteration:
     - the log shows `Suites: completed 15, aborted 0`, or the exact suite count;
     - all 15 suite headers are present;
     - the iteration's fresh XML set has 15 files.
   - **Pin the invocation** to a fresh foreground sbt JVM per iteration (`--server` as in `scripts/ci-sbt.sh`, or `-batch -Dsbt.server.autostart=false` as in MISTAKES.md:332). Also pin it for both parity runs, so the C5 env vars are actually read. The CR1(d) check confirms it.

### Non-blocking notes

- **D8 report location.** design.md:94 names `backend/target/test-reports/*.xml`. The real sbt 2 location is `backend/target/out/jvm/scala-2.13.15/helio-backend/test-reports/`, and the main checkout's `backend/target/test-reports/` holds stale sbt-1 files. D8 already defers the location to the executor; fixing the path avoids a stale-data trap.
- **D2/D3.** Say explicitly that the `SHOW data_directory` connection is closed (try-with-resources) on every path, including the mismatch path. Otherwise a discarded attempt leaks one superuser connection on the foreign cluster. It is harmless, but it is still a (read-only) footprint on a cluster the design promises not to touch.
- **D7 placement.** The sentence "Every instance the spec starts, including the step-2 old-path instance, is closed explicitly…" sits inside D7 (the guard) but is a D6 requirement. Move it into D6 so the executor implementing the regression spec sees it.
- **D7 bullet 4.** "argument text, before its balancing `)`": for `startWith(` that text also covers the `maxAttempts`/`nextPort`/`observeDataDirectory` arguments. That is fine unless an inline observer lambda ever contains `.start()`. Consider scoping the check to the first argument.

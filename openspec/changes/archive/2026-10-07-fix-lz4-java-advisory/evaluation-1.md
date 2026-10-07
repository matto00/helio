## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 44b530e0d3027e275166b80d6b69a065597fd861 (base d125b654141ac79d96a8fd0f9cb5e74b834c7c0c, resolved live via resolve-review-base.sh).
I re-ran every check below myself. I did not rely on the executor's evidence.md.

### Phase 1: Spec Review — PASS
- AC1 (advisory recorded): design.md records the affected ranges, the 1.11.4 fix, severity 7.3 and reachability. PASS.
- AC2 (dependency path): spark-core -> org.lz4 1.8.0, HEL-452 override -> org.lz4 1.8.1 relocation -> at.yawk.lz4 1.8.1. This matches the main resolution I measured: `show Compile/dependencyClasspath` on main gives at/yawk/lz4/lz4-java/1.8.1 and the main SBOM component is at.yawk.lz4 lz4-java 1.8.1. PASS.
- AC3 (fixed version, no new suppression): the lz4-java jar resolves to at.yawk.lz4 1.11.4, and the osv-scanner.toml diff only removes entries. PASS.
- AC4 (`sbt testFull`): passes. 437 suites, 6087 succeeded, 0 failed, 4 canceled; the cancellations are explained below. PASS.
- AC5 (osv-scanner clean): clean locally (details in Phase 2). CI's `security` job on the PR has not run yet; the orchestrator must confirm it after the push.
- Tasks 1.1-2.3 are all done and match the diff. There is no scope creep: only build.sbt, osv-scanner.toml, one new spec and the change dir changed.
- `workflow-state.md` CONSTRAINTS: `[]`, so there is nothing to honor.
- The delta spec (backend-dependency-security) matches what was implemented.

### Phase 2: Code Review — PASS
Gates (backend-only change, so only the backend gate applies). All were run by me with `nice -n 19 sbt --server -batch`, no thin client, and no sbt JVM left running afterwards:
- `sbt testFull` on the branch: EXIT=0. 437 suites, 6087 succeeded, 0 failed, 4 canceled. Lz4CodecSpec's 2 tests passed.
- `npm run check:scala-quality`: clean. `npm run check:openspec`: clean.

Independent dependency verification (branch):
- One lz4 jar on every classpath. `show Compile/dependencyClasspath`, `Runtime/fullClasspath`, `Test/fullClasspath` and `assembly/fullClasspath` each contain exactly one lz4 entry: `at/yawk/lz4/lz4-java/1.11.4/lz4-java-1.11.4.jar`. There is no org.lz4 jar.
- This matters for the fat jar because `assemblyMergeStrategy` uses `MergeStrategy.first`, which would silently pick one of two copies. I unzipped every jar in the assembly classpath and checked for `net/jpountz/lz4/LZ4Factory.class`. It appears only in the at.yawk.lz4 1.11.4 jar, so no other jar ships a shaded or duplicate copy.
- SBOM (`generateSbom`): exactly one lz4 component, `{"group":"at.yawk.lz4","name":"lz4-java","version":"1.11.4"}`, and 0 `org.lz4` components.

osv-scanner v2.5.1 (CI's pinned binary, downloaded into a scratch dir), run with CI's own CVSS>=7 jq filter taken verbatim from `.github/workflows/ci.yml`:
- Branch SBOM with the branch config: exit 0, failures `[]`. The raw JSON before the filter has 0 packages, so lz4-java has 0 findings at any severity.
- Main SBOM with main's config (red control, in a throwaway worktree at d125b6541): exit 1, failures `[{"package":"lz4-java","ids":["GHSA-mcr4-qmvw-px4g"],"max_severity":"7.3"}]`. The filter can go red, and it does on main.
- The raw main JSON lists five lz4-java groups: GHSA-343h-94h5-c4wr (3.7), GHSA-4v53-57pg-c464 (5.3), GHSA-6cx8-rjf8-pr8g (5.3), GHSA-gm45-99xc-r7wv (5.3) and GHSA-mcr4-qmvw-px4g (7.3). The branch clears all five, plus the two previously suppressed (cmp6, xx22).
- Main SBOM with the branch config: the filter reports GHSA-cmp6-m4wj-q63q (8.2) as well as mcr4. So removing the stale suppressions does change behavior: an lz4 regression would be caught again.
- OSV `/v1/query` for at.yawk.lz4:lz4-java returns `[]` for 1.11.4 and 7 IDs for 1.8.1.

Lz4CodecSpec failability (mutation):
- I copied the spec into a throwaway worktree at main, where the lz4 jar resolves to at.yawk.lz4 1.8.1, and ran `testOnly com.helio.spark.Lz4CodecSpec`. The version test fails with `false was not equal to true (Lz4CodecSpec.scala:40)`; the round-trip test passes. So the version assertion fails for a real reason, not by construction.

The 4 canceled tests already cancel on main; this change did not cause them:
- They are `OutputFilteredMetricMeasurementSpec` (1 test) and `DatasetWriteSubmitLatencySpec` (3 tests). Each is an `assume` gate on `HELIO_MEASURE=1`; the cancel messages cite `OutputFilteredMetricMeasurementSpec.scala:50` and `DatasetWriteSubmitLatencySpec.scala:214`. They are report-only measurements.
- Neither file is in the diff.
- On main d125b6541 with HELIO_MEASURE unset, `testOnly *OutputFilteredMetricMeasurementSpec *DatasetWriteSubmitLatencySpec` gives `succeeded 3, failed 0, canceled 4`, identical to the branch.

Code quality: imports are at the top with no inline FQNs, there are no magic values beyond the advisory version floor, and there is no dead code. The test is meaningful: it covers both the codec round-trip and the jar-version guard.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `backend/build.sbt:352-356`: the comment lists three cleared advisories, but 1.11.4 also clears GHSA-343h-94h5-c4wr, GHSA-4v53-57pg-c464, GHSA-6cx8-rjf8-pr8g and GHSA-gm45-99xc-r7wv. These are below CVSS 7, so they don't gate CI, but OSV reports them on 1.8.1. design.md's Context also mentions only three. Consider listing all seven.
- `backend/build.sbt:356`: "fixes DO exist on the at.yawk.lz4 coordinate (1.8.1 .. 1.12.0)" reads as though 1.8.1 is fixed. It is the published version range; 1.8.1 itself is affected. Consider rewording to "fixed from 1.11.4".
- `Lz4CodecSpec.scala:40`: `Ordering.gteq(...) shouldBe true` fails with "false was not equal to true". A clue such as `withClue(s"$file")` would make a regression easier to read.

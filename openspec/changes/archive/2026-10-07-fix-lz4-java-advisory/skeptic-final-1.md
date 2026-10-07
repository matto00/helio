## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 44b530e0d3027e275166b80d6b69a065597fd861. Base resolved live with resolve-review-base.sh: d125b654141ac79d96a8fd0f9cb5e74b834c7c0c.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/fix-lz4-java-advisory/hel-1367`.
- **Diff (non-openspec):** three files changed.
  - `backend/build.sbt`: adds the `dependencyOverrides` entry `"at.yawk.lz4" % "lz4-java" % "1.11.4"` and rewrites the comment.
  - `backend/osv-scanner.toml`: removes the cmp6 and xx22 suppressions.
  - New `backend/src/test/scala/com/helio/spark/Lz4CodecSpec.scala`.
- **OSV ground truth.** I queried api.osv.dev `/v1/vulns/<id>` for each advisory myself. Fixed versions on `at.yawk.lz4:lz4-java`:
  - GHSA-343h-94h5-c4wr: fixed in 1.11.4 (LOW, 3.7)
  - GHSA-4v53-57pg-c464: fixed in 1.11.2 (MODERATE)
  - GHSA-6cx8-rjf8-pr8g: fixed in 1.11.2 (MODERATE)
  - GHSA-gm45-99xc-r7wv: fixed in 1.11.4 (MODERATE)
  - GHSA-mcr4-qmvw-px4g: fixed in 1.11.4 (HIGH, 7.3)
  - GHSA-cmp6-m4wj-q63q: fixed in 1.10.1 (HIGH, 8.2)
  - GHSA-xx22-p4ch-683r: fixed in 1.11.1 (6.5)

  On the `org.lz4:lz4-java` coordinate, all seven are `last_affected 1.8.1`, with no fix. `/v1/query` for at.yawk.lz4 1.8.1 returns those 7 IDs. For 1.11.4 it returns nothing.
- **Resolved classpath (my run).** `nice -n 19 sbt --server -batch "show Compile/dependencyClasspath" "show Runtime/fullClasspath" generateSbom "testOnly com.helio.spark.Lz4CodecSpec"` exited 0.
  - Each classpath has exactly one lz4 entry: `at/yawk/lz4/lz4-java/1.11.4/lz4-java-1.11.4.jar`.
  - The SBOM has 251 components and exactly one lz4 component, `{"group":"at.yawk.lz4","name":"lz4-java","version":"1.11.4"}`. There is no org.lz4 component.
  - Lz4CodecSpec: succeeded 2, failed 0.
  - Afterwards no sbt process for this worktree was left running (checked with `ps`).
- **Driver's added requirement (all five advisories, at every severity): MET.**
  - osv-scanner v2.5.1 (CI's pinned binary, downloaded into the scratchpad) on the branch SBOM with the branch `osv-scanner.toml`: exit 0, and `.results[].packages[]` is `[]`. So there are zero lz4-java findings at any severity, not just none at CVSS>=7.
  - Red control: the same SBOM with only the lz4 component rewritten to at.yawk.lz4 1.8.1, the version main resolves to (the evaluator measured the same thing on main independently). Result: exit 1, with seven lz4-java groups: 343h 3.7, 4v53 5.3, 6cx8 5.3, cmp6 8.2, gm45 5.3, mcr4 7.3, xx22 6.5.
  - So the scanner and config do detect these advisories, and the branch clears all five named by the driver plus cmp6 and xx22.
- **ACs:**
  - AC1: design.md Context records mcr4's ranges, fix, severity and reachability. Met.
  - AC2: the path spark-core → org.lz4 1.8.0, then the HEL-452 override to 1.8.1, then the relocation to at.yawk.lz4, matches what I measured. Met.
  - AC3: resolves to 1.11.4, and the toml diff only removes entries. Met.
  - AC4: I did not re-run the full `sbt testFull`. I rely on the evaluator's pasted counts (437 suites, 6087 succeeded, 0 failed, 4 canceled). The 4 cancellations were cross-checked against main and are `assume(HELIO_MEASURE)` gates in files outside the diff. I re-ran the new spec myself.
  - AC5: clean locally. CI's `security` job on the PR still has to be observed by the orchestrator after the push.
- **Test failability:** the evaluator reports that the version assertion fails on main's 1.8.1 jar. The spec's logic (regex on the code-source jar name, `>= (1,11,4)`, plus a check that the path is under `/at/yawk/lz4/`) would fail on 1.8.1 by construction. I accept that claim.

### Driver's documentation question: do build.sbt and design.md accurately describe what was cleared?

**No, and the build.sbt comment is wrong in one respect.**

1. `backend/build.sbt:354-356` says 1.11.4 "clears GHSA-mcr4-qmvw-px4g ..., GHSA-cmp6-m4wj-q63q and GHSA-xx22-p4ch-683r". It omits four advisories that this bump also clears and that OSV reports against the version main shipped: GHSA-343h-94h5-c4wr, GHSA-4v53-57pg-c464, GHSA-6cx8-rjf8-pr8g and GHSA-gm45-99xc-r7wv. Every other override in this block follows the convention that its comment names the advisories it clears, and that list is what a future maintainer uses to decide whether a pin can be dropped or lowered. An incomplete list understates what the pin protects against.
2. `backend/build.sbt:356` says "fixes DO exist on the at.yawk.lz4 coordinate (1.8.1 .. 1.12.0)". Next to the word "fixes", that range reads as "1.8.1 through 1.12.0 are fixed". That is false: 1.8.1 is affected by all seven advisories, and the earliest version that is fixed for all of them is 1.11.4. The range is actually the set of versions published on Central (design.md Context uses it correctly in that sense). A security comment that can be read as "1.8.1 is fixed" is misleading.
3. design.md Context ("1.11.4 also clears GHSA-cmp6 ... and GHSA-xx22") and the delta spec (`specs/backend-dependency-security/spec.md`, which lists only mcr4/cmp6/xx22) have the same three-of-seven omission. The delta spec gets archived into `openspec/specs/`, so the incomplete list would become durable. The spec's behavioral scenario ("no finding is reported for lz4-java") is correct and already covers all seven, so this is a wording fix only.

### Verdict: REFUTE

The code change is correct and I would ship it: one jar at 1.11.4, zero lz4 findings at any severity, codec round-trip green. The REFUTE is narrow. It covers the security-documentation inaccuracies the driver explicitly asked me to judge, and the fix is wording only. No code or test change is needed, and the gates do not need re-running beyond `npm run check:openspec` and Prettier/format on the touched files.

### Change Requests

1. `backend/build.sbt:354-356`: rewrite the HEL-1367 sentence to list all seven advisories 1.11.4 clears relative to 1.8.1: GHSA-mcr4-qmvw-px4g, GHSA-cmp6-m4wj-q63q, GHSA-xx22-p4ch-683r, GHSA-343h-94h5-c4wr, GHSA-4v53-57pg-c464, GHSA-6cx8-rjf8-pr8g, GHSA-gm45-99xc-r7wv. State plainly that 1.11.4 is the minimum version that fixes all of them (mcr4, 343h and gm45 are first fixed in 1.11.4).
2. `backend/build.sbt:356`: delete "fixes DO exist on the at.yawk.lz4 coordinate (1.8.1 .. 1.12.0)". If the point is worth keeping, replace it with wording that cannot be read as 1.8.1 being fixed, e.g. "org.lz4 has no fix (all are last_affected 1.8.1); at.yawk.lz4 is fixed from 1.11.4".
3. `openspec/changes/fix-lz4-java-advisory/design.md`, Context, "Fix availability" paragraph: record that 1.11.4 also clears the four lower-severity advisories (343h fixed 1.11.4, 4v53 fixed 1.11.2, 6cx8 fixed 1.11.2, gm45 fixed 1.11.4), not only cmp6 and xx22.
4. `openspec/changes/fix-lz4-java-advisory/specs/backend-dependency-security/spec.md`, Requirement text: either list all seven advisory IDs, or replace the enumeration with "a version for which OSV reports no lz4-java advisory (>= 1.11.4)". The scenario already says that.

### Non-blocking notes

- `Lz4CodecSpec.scala:40`: `gteq(...) shouldBe true` fails with the opaque message "false was not equal to true". Wrapping it in `withClue(file)` would help (the evaluator also noted this).
- The `"org.lz4" % "lz4-java" % "1.8.1"` override is now effectively a no-op stepping stone: it relocates to at.yawk.lz4 1.8.1, which the next line overrides. Keeping it is harmless, and it does stop a stray non-relocated org.lz4 1.8.0 jar from reappearing, so I did not ask for it to be removed.
- AC5's PR-side CI `security` run must be observed green before merge. That is the orchestrator's step.

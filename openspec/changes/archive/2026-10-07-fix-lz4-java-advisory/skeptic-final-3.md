## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD: 64f9f760365f564b0bda59be565571b7b30b82f6. I resolved the base live with `resolve-review-base.sh` (exit 0): d125b654141ac79d96a8fd0f9cb5e74b834c7c0c. I reviewed the whole diff from that base, not only the round-3 delta.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/fix-lz4-java-advisory/hel-1367`.
- **Diff (outside openspec).** Three backend files changed:
  - `backend/build.sbt`: added `"at.yawk.lz4" % "lz4-java" % "1.11.4"` inside the `dependencyOverrides ++= Seq(` block that starts at line 314, and rewrote the lz4 comment.
  - `backend/osv-scanner.toml`: removed the cmp6 and xx22 `[[IgnoredVulns]]` blocks and reworded the header.
  - `backend/src/test/scala/com/helio/spark/Lz4CodecSpec.scala`: new file.
  - Executable changes since 44b530e0d (the commit evaluation-1 ran `testFull` on): only the `withClue` wrapper in the spec. I filtered `git diff 44b530e0d HEAD` to non-comment `+`/`-` lines to confirm this.
- **OSV ground truth, queried myself (`api.osv.dev`).**
  - `/v1/vulns/<id>` fix versions on at.yawk.lz4:lz4-java:
    | Advisory | Severity | Fixed in |
    |---|---|---|
    | mcr4 | HIGH | 1.11.4 |
    | cmp6 | HIGH | 1.10.1 |
    | xx22 | MODERATE | 1.11.1 |
    | 343h | LOW | 1.11.4 |
    | 4v53 | MODERATE | 1.11.2 |
    | 6cx8 | MODERATE | 1.11.2 |
    | gm45 | MODERATE | 1.11.4 |
  - On org.lz4:lz4-java every one of the seven is `last_affected 1.8.1` with no fix. mcr4 is introduced at 1.7.0, which matches design.md's "1.7.0..1.8.1".
  - `/v1/query` on at.yawk.lz4:
    - 1.8.1 returns all 7 IDs.
    - 1.11.3 still returns 343h, gm45 and mcr4.
    - 1.11.4 and 1.12.0 return nothing.
  - So 1.11.4 is the lowest version that fixes all seven.
  - mcr4 metadata: alias CVE-2026-106451; CVSS v4 `AV:L/AC:H/AT:P/PR:L/...`; CWE-367/377; published 2026-10-07T20:35:51Z. This matches design.md and proposal.md.
  - Central `maven-metadata.xml` for at.yawk.lz4 lists 1.8.1 through 1.12.0. The `org.lz4:lz4-java:1.8.1` POM contains `<relocation><groupId>at.yawk.lz4</groupId>`. `spark-core_2.13-3.5.9.pom` declares `org.lz4:lz4-java:1.8.0` compile. All of this matches design.md.
  - The 1.11.4 jar's `LZ4Factory.class` has class-file major version 51, which is Java 7, as design.md says.
- **Resolved classpath, SBOM and new spec (fresh run).** I ran `nice -n 19 sbt --server -batch "show Compile/dependencyClasspath" "show Runtime/fullClasspath" "show Test/fullClasspath" generateSbom "testOnly com.helio.spark.Lz4CodecSpec"`. It exited 0.
  - Each of the three classpaths has exactly one lz4 entry, `at/yawk/lz4/lz4-java/1.11.4/lz4-java-1.11.4.jar` (log lines 192, 449 and 739). There is no org.lz4 jar and 0 kafka hits.
  - The SBOM has 251 components and exactly one lz4 component, `{"group":"at.yawk.lz4","name":"lz4-java","version":"1.11.4"}` (sha256 c4c7e261...).
  - Lz4CodecSpec: succeeded 2, failed 0.
  - Afterwards I checked `/proc/<pid>/cwd` for every sbt process. None was in this worktree; the ones still running belong to other tickets' dev servers.
  - *Measurement note:* my first attempt logged to a generic `sbt.log` in the shared session scratchpad. That log ended up interleaved with another process's test output (EmbeddedPostgres and a "37 tests" suite this command never runs). I treated the file as corrupt, not as a finding, and re-ran into a uniquely named directory. The results above come from that clean re-run.
- **Driver requirement: all five named advisories (343h, 4v53, 6cx8, gm45, mcr4), plus cmp6 and xx22, cleared at every severity. MET.** I downloaded osv-scanner v2.5.1 (CI's pinned release) into the scratchpad and ran three scans:
  - **Branch SBOM + branch `osv-scanner.toml`:** exit 0, `.results[].packages` = `[]`. No lz4-java finding at any severity. Since no group survives at all, CI's CVSS>=7 filter has nothing to report.
  - **Branch SBOM + empty config (no suppressions):** exit 1, with exactly aircompressor GHSA-vx9q-rhv9-3jvg (8.2) and zookeeper GHSA-7286-pgfv-vxvh (9.1) / GHSA-r978-9m6m-6gm6 (5.3). lz4 is clean on its own, not because a suppression hides it.
  - **Red control (same SBOM, lz4 component rewritten to at.yawk.lz4 1.8.1) + branch config:** exit 1, with seven lz4-java groups: 343h 3.7, 4v53 5.3, 6cx8 5.3, cmp6 8.2, gm45 5.3, mcr4 7.3, xx22 6.5. This shows the scanner and config detect each advisory and that nothing in the config suppresses lz4.
- **Accuracy of every comment, doc and spec line in the diff.**
  - `backend/osv-scanner.toml` header (the round-2 REFUTE item): fixed.
    - It no longer says "All 5 entries". It says HEL-1367 removed cmp6 and xx22 because 1.11.4 fixes them.
    - It says the 3 remaining entries are exactly what an unsuppressed v2.5.1 run reports. My empty-config scan reproduces that exactly: those 3 IDs, nothing else.
    - "The entries below were independently confirmed present in that live scan" still holds for the original HEL-459 scan, since the three survivors were among its five.
  - `backend/build.sbt` lz4 comment: accurate.
    - The relocation statement is correct.
    - All seven IDs are listed.
    - "lowest version that fixes all seven" is correct.
    - "mcr4, 343h and gm45 are first fixed in 1.11.4" is correct.
    - "org.lz4 has no fix (all are last_affected 1.8.1); at.yawk.lz4 is fixed from 1.11.4" is correct.
    - "the at.yawk.lz4 override below" is correct: the line is in `dependencyOverrides`.
  - `Lz4CodecSpec.scala`: the scaladoc and test names are accurate. The version check parses the resolved jar name and requires at least (1,11,4) and an `/at/yawk/lz4/` path, so it would fail on the 1.8.1 jar.
  - `design.md`, `proposal.md` and the delta `spec.md`: their factual claims match the OSV, Central and classpath evidence above. The spec requirement and scenarios hold on the branch: one at.yawk.lz4 component, no lz4 suppression, no lz4 finding, and the codec round-trips.
  - `evidence.md`: consistent with what I measured.
- **ACs.**
  - AC1: design.md Context records the affected ranges, the fix version, severity and reachability, and they are correct. Met.
  - AC2: path spark-core 3.5.9 → org.lz4 1.8.0 → HEL-452 override 1.8.1 → relocation to at.yawk.lz4. This is consistent with the POMs and the measured classpath. Met.
  - AC3: resolves to at.yawk.lz4 1.11.4, which OSV lists as fixed. The toml diff only removes entries and adds none. Met.
  - AC4 (`sbt testFull`): I did not re-run it, to keep sbt usage minimal per the driver. evaluation-1 pastes `EXIT=0. 437 suites, 6087 succeeded, 0 failed, 4 canceled` at 44b530e0d, and explains the 4 cancellations as identical on main. Since then the only executable change is a test-local `withClue`, which I re-ran green. The classpath and SBOM are unchanged from round 2 (same SBOM sha256 c4c7e261...). Met on that pasted evidence.
  - AC5: clean locally (above). `gh pr list --head task/fix-lz4-java-advisory/hel-1367` returns `[]`, so CI's `security` job on the PR has not run yet. The orchestrator must observe it green before merging.
- `npm run check:openspec`: "openspec/ is clean".

### Verdict: CONFIRM

### Non-blocking notes
- design.md D5 and tasks.md 2.1 describe the spec as asserting the code source "is the 1.11.4 jar". The test actually asserts ">= 1.11.4" plus the at.yawk.lz4 path. That is a slightly looser and more durable check, and the delta spec's ">= 1.11.4" wording matches it.
- proposal.md's Impact line lists `build.sbt` and `osv-scanner.toml` but not the new `Lz4CodecSpec.scala`. files-modified.md does list it.
- AC5's PR-side `security` job still has to be observed green on the PR before merge.
- The `"org.lz4" % "lz4-java" % "1.8.1"` override now only acts as a stepping stone through the relocation. It is harmless.

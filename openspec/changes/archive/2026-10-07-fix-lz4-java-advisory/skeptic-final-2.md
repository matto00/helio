## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: c8ee9a02f1d2917a8eb8de11b290b866a2c65d5d. Base resolved live with resolve-review-base.sh: d125b654141ac79d96a8fd0f9cb5e74b834c7c0c.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/fix-lz4-java-advisory/hel-1367`.
- **Diff (non-openspec):** three files changed: `backend/build.sbt` (the `at.yawk.lz4 % lz4-java % 1.11.4` override plus the comment), `backend/osv-scanner.toml` (two `[[IgnoredVulns]]` blocks removed), and the new `backend/src/test/scala/com/helio/spark/Lz4CodecSpec.scala`. Round 2 (44b530e0d..c8ee9a02f) touches only the build.sbt comment, design.md, the delta spec, and a `withClue` in the spec.
- **OSV ground truth (I queried it myself).**
  - `/v1/query` for at.yawk.lz4:lz4-java:
    - 1.8.1 returns the 7 IDs 343h, 4v53, 6cx8, cmp6, gm45, mcr4, xx22.
    - 1.11.3 still returns 343h, gm45 and mcr4.
    - 1.11.4 and 1.12.0 return nothing.
  - org.lz4:lz4-java 1.8.1 returns the same 7 IDs.
  - `/v1/vulns` fixed versions on at.yawk.lz4: 343h 1.11.4 (LOW), 4v53 1.11.2, 6cx8 1.11.2, gm45 1.11.4, mcr4 1.11.4 (HIGH), cmp6 1.10.1 (HIGH), xx22 1.11.1. On org.lz4, every one is `last_affected 1.8.1`.
  - Central's maven-metadata for at.yawk.lz4 lists 1.8.1 through 1.12.0. 1.11.4 is the next release after 1.11.3, so it is the lowest version that fixes all seven.
- **Resolved classpath, SBOM and new spec (fresh run).** I ran `nice -n 19 sbt --server -batch "show Compile/dependencyClasspath" "show Runtime/fullClasspath" "show Test/fullClasspath" generateSbom "testOnly com.helio.spark.Lz4CodecSpec"`. It exited 0.
  - Each of the three classpaths has exactly one lz4 jar, `at/yawk/lz4/lz4-java/1.11.4/lz4-java-1.11.4.jar`.
  - The SBOM has 251 components and exactly one lz4 component, `{"group":"at.yawk.lz4","name":"lz4-java","version":"1.11.4"}`.
  - Lz4CodecSpec: succeeded 2, failed 0.
  - Afterwards I checked `ps` and no sbt process for this worktree was left running.
- **Driver requirement: all five advisories cleared at every severity. MET.** I scanned with osv-scanner v2.5.1 (CI's pinned release, downloaded into the scratchpad) against the fresh branch SBOM (sha256 c4c7e261..., identical to `backend/target/sbom.cdx.json`) and the branch's `osv-scanner.toml`.
  - Result: exit 0, `.results[].packages[]` = `[]`. I ran it twice with the same result.
  - My first attempt exited 127. That was my own error: I had copied the SBOM to a name without `.cdx.json`, and osv-scanner rejects that filename. I fixed the name and re-ran. It was a measurement error, not a finding.
  - **Red control:** the same SBOM with only the lz4 component rewritten to at.yawk.lz4 1.8.1 gives exit 1, with seven lz4-java groups: 343h 3.7, 4v53 5.3, 6cx8 5.3, cmp6 8.2, gm45 5.3, mcr4 7.3, xx22 6.5. So the scanner and config do detect every one of these.
  - **No-suppression scan:** the branch SBOM with an empty config reports only aircompressor GHSA-vx9q-rhv9-3jvg and zookeeper GHSA-7286-pgfv-vxvh / GHSA-r978-9m6m-6gm6. So lz4 is clean on its own, not because a suppression hides it.
- **Accuracy of round-2 text (checked against OSV, not against skeptic-final-1's list).**
  - The `build.sbt:352-358` comment is accurate. It names all seven IDs and says 1.11.4 is the lowest version fixing all of them. It names mcr4, 343h and gm45 as first fixed in 1.11.4. It also says "org.lz4 has no fix (all are last_affected 1.8.1)". All of this matches OSV. The misleading "fixes DO exist ... (1.8.1 .. 1.12.0)" phrase is gone.
  - design.md "Fix availability" is accurate: per-advisory fix versions, "lowest version fixing all seven", and "Central has 1.8.1..1.12.0" in the sense of published versions.
  - The delta spec's Requirement ("a version for which OSV reports no lz4-java advisory (>= 1.11.4)") is accurate.
- **ACs.**
  - AC1 (design.md Context): met.
  - AC2 (spark-core → org.lz4 1.8.0 → HEL-452 override 1.8.1 → relocation): consistent with the classpath I measured. Met.
  - AC3: resolves to 1.11.4, and the toml diff only removes entries. Met.
  - AC4 (`sbt testFull`): I did not re-run it, to keep my sbt usage minimal per the driver. The evaluator's reports carry pasted counts (437 suites, 6087 succeeded, 0 failed). Round 2 changed only comments, markdown and a `withClue` wrapper, and I re-ran the one changed spec.
  - AC5: clean locally. No PR exists yet (`gh pr list --head ...` returns `[]`), so CI's `security` job on the PR still has to be observed by the orchestrator.
- `npm run check:openspec`: "openspec/ is clean".

### Inaccuracy found that the diff introduces (missed by round 1 and both evaluations)

`backend/osv-scanner.toml:5-6`, the file header, still says "All 5 entries below were independently confirmed present in that live scan; the live scan reported nothing beyond these 5."

- This diff deletes two of those entries. The file now has **3** `[[IgnoredVulns]]` entries (counted with `grep -c '^\[\[IgnoredVulns\]\]'`: 5 on base d125b6541, 3 on HEAD).
- That makes the header false, and this change is what made it false. It sits in the security suppression file, which is the place a maintainer checks to see what the gate is hiding.
- A reader who sees "All 5 entries below" above three entries would reasonably suspect that suppressions went missing.
- My no-suppression scan shows the live set is exactly the 3 remaining IDs, so the corrected text is easy to verify.

### Verdict: REFUTE

The code is correct and ship-ready: one jar at 1.11.4, zero lz4-java findings at any severity, a red control that proves detection, and a green codec round-trip. The REFUTE is limited to the text accuracy the driver asked me to judge. This diff leaves a now-false count in the security suppression file's header. It is a one-line comment fix and needs no code, test or sbt re-run.

### Change Requests

1. `backend/osv-scanner.toml:5-6`: fix the header count so it describes the current file. One way: say the original HEL-459 derivation confirmed 5 entries, that HEL-1367 removed the two lz4-java entries (GHSA-cmp6-m4wj-q63q, GHSA-xx22-p4ch-683r) because at.yawk.lz4 1.11.4 fixes them, and that the 3 remaining entries match exactly what a no-suppression scan of the current SBOM reports (aircompressor vx9q, zookeeper 7286 and r978). Do not leave "All 5 entries below" above three entries.

### Non-blocking notes

- The `"org.lz4" % "lz4-java" % "1.8.1"` override is now just a stepping stone through the relocation. It is harmless, and it guards against a stray real org.lz4 1.8.0 jar, so I have not asked for its removal.
- AC5's PR-side CI `security` run must be observed green before merge. No PR exists yet.

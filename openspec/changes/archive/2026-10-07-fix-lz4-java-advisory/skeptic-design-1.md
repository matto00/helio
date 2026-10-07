## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD: d125b654141ac79d96a8fd0f9cb5e74b834c7c0c (change dir untracked, no code changes yet).

### What I verified (with evidence)

- **Spawn cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/fix-lz4-java-advisory/hel-1367`.
- **Advisory (design Context):** `curl https://api.osv.dev/v1/vulns/GHSA-mcr4-qmvw-px4g` -> alias CVE-2026-106451,
  published 2026-10-07T20:35:51Z, CVSS_V4 `AV:L/AC:H/AT:P/PR:L/...`, CWE-367/377, HIGH, github_reviewed;
  affected `at.yawk.lz4:lz4-java` introduced 0 / **fixed 1.11.4**; `org.lz4:lz4-java` introduced 1.7.0 /
  **last_affected 1.8.1**. Matches design.md exactly.
- **Suppressed advisories:** GHSA-cmp6-m4wj-q63q -> at.yawk fixed **1.10.1**; GHSA-xx22-p4ch-683r -> at.yawk fixed
  **1.11.1**. Both org.lz4 ranges last_affected 1.8.1 (no fix on that coordinate). Matches D3.
- **Per-version OSV queries** (`/v1/query`, Maven): at.yawk 1.8.1 -> 7 vulns (343h, 4v53, 6cx8, cmp6, gm45, mcr4, xx22);
  **1.11.4 -> []**; **1.12.0 -> []**. The four not mentioned in design (343h LOW, 4v53/6cx8/gm45 MODERATE, CVSS v3 <7)
  are below CI's CVSS>=7 filter, which explains why they never needed suppressions; all are fixed <= 1.11.4.
- **Relocation POM:** repo1 `org/lz4/lz4-java/1.8.1/lz4-java-1.8.1.pom` contains
  `<distributionManagement><relocation><groupId>at.yawk.lz4</groupId>`; no `lz4-java-1.8.1.jar` under org/lz4 (HTTP 404).
  `org.lz4:lz4-java:1.8.0` POM has 0 `relocation` hits and its jar is HTTP 200 (real jar). Matches design.
- **at.yawk versions on Central:** maven-metadata lists 1.8.1 .. 1.12.0 incl. 1.11.4; 1.11.4 jar HTTP 200, Apache-2.0.
- **Dependency path:** `spark-core_2.13-3.5.9.pom` declares `org.lz4:lz4-java:1.8.0` compile. `backend/build.sbt:355`
  is the HEL-452 `"org.lz4" % "lz4-java" % "1.8.1"` inside `dependencyOverrides ++= Seq(...)`. Local Coursier cache
  holds `at/yawk/lz4/lz4-java/1.8.1/lz4-java-1.8.1.jar`, corroborating that the relocation target is what actually
  resolves. No `kafka` in build.sbt/project. (I did not re-run `dependencyTree`; D2's acceptance makes the executor
  measure it anyway.)
- **CI gate shape:** `.github/workflows/ci.yml:313-401` — generateSbom -> osv-scanner v2.5.1 with `osv-scanner.toml`
  -> CVSS>=7 jq filter. D4's local red/green reproduces that exact pipeline. `generateSbom` (build.sbt:27-40) reads
  Coursier's resolved `ModuleID`s, so the SBOM-component acceptance in D2 is a meaningful check.
- **AC coverage:** AC1/AC2 -> design Context (verified above); AC3 -> D1/D2, tasks 1.2-1.3; AC4 -> task 2.3;
  AC5 -> D4, tasks 1.1/1.6 + PR CI. D3 suppression removal is in-scope (same artifact, now-false justification, same
  file) and the toml header itself warns against false-clean suppressions.
- **Placeholders/contradictions:** none found. D2 leaves the mechanism to measurement but with a precise, checkable
  acceptance (single at.yawk 1.11.4 SBOM component, no org.lz4, one jar on `Compile/dependencyClasspath`) and a
  stated preference order — that is a decided procedure, not hand-waving.

### Verdict: CONFIRM

### Non-blocking notes

- The spec says ">= 1.11.4" while D5/task 2.1 asserts the code source is exactly `lz4-java-1.11.4`. Fine for this
  change; consider phrasing the test assertion as ">= 1.11.4" (parse the jar version) so a future benign bump does
  not turn it red for no security reason.
- Task 2.1's test constructs `LZ4CompressionCodec(new SparkConf())` — no SparkSession needed; keep it that way (no
  test currently boots Spark, and a SparkContext in testFull would be a new cost/flake source).
- Record D2(a) vs (b) results in evidence with the actual `dependencyClasspath` line, not just the SBOM, since the
  SBOM reads ModuleIDs and could in principle diverge from the physical jar list.
- Update the `ignoreUntil`-era comment in build.sbt (task 1.4) so it no longer says "no published fix anywhere".

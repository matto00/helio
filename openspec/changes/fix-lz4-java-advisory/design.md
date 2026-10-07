## Context

**Advisory (osv.dev, read 2026-10-07).** GHSA-mcr4-qmvw-px4g / CVE-2026-106451, GitHub-reviewed HIGH, CVSS v4
`AV:L/AC:H/AT:P/PR:L/...` (osv-scanner max_severity 7.3), CWE-367/377. `net.jpountz.util.Native.load()` extracts the
bundled JNI library into `java.io.tmpdir` under a predictable name opened without exclusive create; a local user sharing
that tmpdir can race it and get code loaded into the victim JVM (or, with `fs.protected_regular>=1`, force a DoS
fallback to the Java implementation). Affected: `at.yawk.lz4:lz4-java` < **1.11.4** (fixed), `org.lz4:lz4-java`
1.7.0..1.8.1 (last_affected, no fix on that coordinate).

**Reachability.** Spark's LZ4 codec (default `spark.io.compression.codec`) calls `LZ4Factory.fastestInstance()`, which
takes the native path. In prod the backend is a single-user Cloud Run container, so the shared-tmpdir precondition is
weak; exploitability is low but non-zero (dev machines, any multi-user host). We fix it regardless -- the gate is
CVSS-based and a fix exists.

**Dependency path (measured, not assumed).** `spark-core_2.13:3.5.9` declares `org.lz4:lz4-java:1.8.0` (compile);
`spark-sql_2.13` reaches it via spark-core. No Kafka client is on the classpath (0 hits in `Compile/dependencyTree`).
HEL-452 added `dependencyOverrides += "org.lz4" % "lz4-java" % "1.8.1"`. On Central, `org.lz4:lz4-java:1.8.1` is now a
Sonatype **relocation POM** (`<relocation><groupId>at.yawk.lz4</groupId>`), so the resolved artifact is
`at.yawk.lz4:lz4-java:1.8.1` (first line of the current `Compile/dependencyTree`). `org.lz4:lz4-java:1.8.0` is a real jar,
not a relocation.

**Fix availability.** Central has `at.yawk.lz4:lz4-java` 1.8.1..1.12.0. OSV query returns zero vulns for 1.11.4 and
1.12.0. 1.11.4 also clears GHSA-cmp6-m4wj-q63q (fixed 1.10.1) and GHSA-xx22-p4ch-683r (fixed 1.11.1), currently
suppressed in `backend/osv-scanner.toml` as "no fixed version exists anywhere upstream". It also clears the four
lower-severity advisories OSV reports against 1.8.1: GHSA-343h-94h5-c4wr (fixed 1.11.4), GHSA-4v53-57pg-c464 (1.11.2),
GHSA-6cx8-rjf8-pr8g (1.11.2) and GHSA-gm45-99xc-r7wv (1.11.4); 1.11.4 is the lowest version fixing all seven. Same
`net.jpountz.*` packages, Java 7 bytecode, Apache-2.0, maintained by the advisory's own publisher (yawkat).

## Goals / Non-Goals

**Goals:** one lz4-java jar on the classpath at `at.yawk.lz4:1.11.4`; CI `security` green; `sbt testFull` green; Spark's
LZ4 codec proven working on the new jar; stale lz4 suppressions removed.

**Non-Goals:** Spark upgrade; other suppressions; CI workflow changes.

## Decisions

**D1 -- target `at.yawk.lz4:lz4-java:1.11.4`, the minimal fixed version, not 1.12.0.** Smallest behavior delta from the
1.8.x line Spark 3.5.9 was built against; 1.12.0 is a new minor with no security reason to take it. Alternative
(allowlist) rejected: a fixed version exists, and the ticket says to prefer a bump.

**D2 -- mechanism: the executor must pick it empirically and prove a single jar.** Two candidates:
(a) keep the org.lz4 override at 1.8.1 (relocation) and add `dependencyOverrides += "at.yawk.lz4" % "lz4-java" % "1.11.4"`;
(b) `exclude("org.lz4", "lz4-java")` on the spark artifacts and add `"at.yawk.lz4" % "lz4-java" % "1.11.4"` as an
explicit dependency. Whether Coursier applies an override to a relocation *target* is not something to assume.
Acceptance for either: the regenerated SBOM has exactly one `lz4-java` component, group `at.yawk.lz4`, 1.11.4, and no
`org.lz4` component; and `show Compile/dependencyClasspath` shows one lz4 jar. Prefer (a) if it holds (no excludes to
maintain on every Spark artifact); else (b). The losing variant's measured result is recorded in the commit/evidence.

**D3 -- remove the cmp6/xx22 suppressions.** Their stated reason becomes false at 1.11.4. Leaving a suppression
whose justification is false is exactly the false-clean risk `osv-scanner.toml`'s header warns about. Proof: osv-scanner
run on the new SBOM *without* those entries reports nothing for lz4-java.

**D4 -- red/green proof for the gate.** Run the CI's own osv-scanner (v2.5.1) + the CVSS>=7 jq filter locally against
the SBOM on `main` (must report the lz4 group -- red) and on the branch (must report zero groups -- green), then CI's
`security` job on the PR is the authoritative check.

**D5 -- runtime proof of the codec.** `sbt testFull` alone may not exercise Spark's LZ4 path. Add a small backend
test that round-trips bytes through Spark's `org.apache.spark.io.LZ4CompressionCodec` (on a minimal `SparkConf`) and
asserts `net.jpountz.lz4.LZ4Factory`'s code source is the 1.11.4 jar. Mutation check: temporarily revert the pin and
confirm the version assertion goes red.

## Risks / Trade-offs

- **API drift 1.8 -> 1.11 under Spark 3.5.9.** yawkat's line kept the `net.jpountz` API; D5's codec round-trip and
  `testFull` are the guard. If it breaks, escalate rather than pin back.
- **Supplier change.** The groupId changes, but Central's own relocation already moved us to at.yawk.lz4 -- we are on
  that supplier today; this only raises its version.

## Planner Notes

- Self-approved: not a new external dependency (the relocation already resolves to at.yawk.lz4 on main); a version
  override, not an architectural change.
- Self-approved: D3 suppression removal is in scope -- same artifact, same file, false justification.

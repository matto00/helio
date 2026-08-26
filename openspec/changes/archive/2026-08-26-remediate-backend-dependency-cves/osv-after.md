# HEL-452 post-change OSV scan — before/after

Re-scanned on the post-change tree (branch `task/remediate-backend-dependency-cves/HEL-452`), same
methodology as `osv-baseline.md`: `sbt -batch 'set ThisBuild/asciiGraphWidth := 400' "Compile/dependencyTree"`
and `"Test/dependencyTree"`, sanity-checked (`grep -c evicted` == `grep -c '(evicted by:'` on both dumps
before and after), then `osv-scan.py compile=... test=...`.

Raw dumps: `/tmp/hel452-compile-after.txt`, `/tmp/hel452-test-after.txt`, `/tmp/hel452-after-scan.txt`
(not committed — regenerate with the commands above from the updated `backend/build.sbt`).

**Cycle-2 correction:** the tool's raw output under-counts by 2. `osv-scan.py` has a fourth defect (see
`design.md` Context and the tool's own header comment): relocated Maven coordinates are silently invisible
to it. `org.lz4:lz4-java` relocates to `at.yawk.lz4:lz4-java` at the pinned version and drops out of the
`dependencyTree` dump entirely, so the scanner never queries it and never reports its remaining advisories.
The totals and remaining-advisories table below are corrected by hand for that gap — the raw tool output is
70 -> 3 / 23 -> 2; the true after-state, verified by direct OSV query against the relocated coordinate, is
**70 -> 5 / 23 -> 3**.

## Totals

| scope | resolved coords (before -> after) | evicted rows excluded (before -> after) | advisories (before -> after) | vulnerable artifacts (before -> after) |
|---|---|---|---|---|
| compile (SHIPS IN PRODUCTION) | 250 -> 249 | 692 -> 691 | **70 -> 5** | **23 -> 3** |
| test-only delta | 33 -> 32 | 0 -> 0 | 1 -> 0 | 1 -> 0 |

Compile-scope severity split, before -> after:

| severity | before | after |
|---|---|---|
| CRITICAL | 1 | 1 |
| HIGH | 30 | 2 |
| MODERATE | 34 | 2 |
| LOW | 5 | 0 |

The single test-only advisory (`commons-lang3` GHSA-j288-q9x7-2f5v) is now fully cleared: the compile-scope
`dependencyOverrides` pin to 3.18.0 also lands in test scope (no separate test-only version remains).

## Remaining advisories (5) — every one already in the design.md D5 deferred set

| artifact | resolved | severity | advisory | fixed in | justification |
|---|---|---|---|---|---|
| `org.apache.zookeeper:zookeeper` | 3.6.3 | CRITICAL | GHSA-7286-pgfv-vxvh | 3.7.2,3.8.3,3.9.1 | Design D5: reached only through Spark's HA/cluster-coordination path. This deployment runs Spark in local/driver mode on Cloud Run (`spark.masterUrl = "local[*]"` in `application.conf`) and never contacts a ZooKeeper ensemble — verified: `SparkJobSubmitter.scala` is the only `SparkSession.builder()` in the tree, `SPARK_MASTER_URL` has zero hits in `infra/` or `.github/`, no `spark.deploy.recoveryMode` / Curator / ZK connect string exists anywhere. Fixing would require Spark's HA path to be exercised, which it never is. |
| `io.airlift:aircompressor` | 0.27 | HIGH | GHSA-vx9q-rhv9-3jvg | 2.0.3 | Design D5: fix is only at 2.0.3, a major version bump with an API-breaking change to the decompressor interface that Spark 3.5.x's own decompression path calls directly; not achievable without a Spark major bump, which is out of scope. |
| `org.lz4:lz4-java` (resolved as `at.yawk.lz4:lz4-java` 1.8.1, relocated) | 1.8.1 | HIGH | GHSA-cmp6-m4wj-q63q | - (no fix published) | Design D5: no fixed version exists anywhere. **Not detected by `osv-scan.py`** — the relocated coordinate is absent from the `dependencyTree` dump (defect #4, see `design.md`/`osv-scan.py` header); established instead by a direct OSV query for `at.yawk.lz4:lz4-java` at `1.8.1`, which still returns this advisory. The artifact was never fixed; it only became invisible to the tool. |
| `org.apache.zookeeper:zookeeper` | 3.6.3 | MODERATE | GHSA-r978-9m6m-6gm6 | 3.8.4,3.9.2 | Same artifact/reachability argument as the CRITICAL zookeeper row above. |
| `org.lz4:lz4-java` (resolved as `at.yawk.lz4:lz4-java` 1.8.1, relocated) | 1.8.1 | MODERATE | GHSA-xx22-p4ch-683r | - (no fix published) | Design D5: no fixed version exists anywhere. **Not detected by `osv-scan.py`**, same relocation gap as the HIGH lz4-java row above — confirmed still open at `1.8.1` by direct OSV query. |

No new members were added to design.md's D5 deferred set — all five remaining advisories are exactly the
`zookeeper`, `aircompressor`, and `lz4-java` (unfixable pair) items design.md already named before
implementation. `design.md` D5 is unchanged; only its Context section gained the fourth scanner-defect
writeup.

## Notes on the scan mechanics

- `org.lz4:lz4-java` GHSA-vqf4-7m7x-wgfc (HIGH) **is** genuinely fixed: bumped via `dependencyOverrides` to
  1.8.1, confirmed on the resolved classpath (`sbt -batch 'show Compile/dependencyClasspath'` shows
  `.../at/yawk/lz4/lz4-java/1.8.1/lz4-java-1.8.1.jar`). That part of the 4.3a bump did its job.
- However, the artifact's other two advisories (GHSA-cmp6-m4wj-q63q, GHSA-xx22-p4ch-683r — both already
  named in design.md D5 as having no published fix) are **still open at 1.8.1** and remain so regardless of
  version, since no fix exists. The scan **under-counts here**: because `org.lz4:lz4-java:1.8.1`'s POM is a
  Maven relocation to `at.yawk.lz4:lz4-java`, `sbt-dependency-graph` drops the node from the tree dump
  entirely, so `osv-scan.py` never queries that coordinate and silently reports zero advisories for it. A
  direct OSV query against `at.yawk.lz4:lz4-java` (and, redundantly, `org.lz4:lz4-java`) at `1.8.1` confirms
  both advisories still match. The table above has been corrected by hand to include them; the raw scanner
  output (3 advisories / 2 artifacts) undercounts the true shipped exposure (5 / 3) for this reason alone.
  See `design.md`'s Context section and `osv-scan.py`'s header comment for the general defect writeup — this
  is not yet guarded in the tool itself.
- `io.grpc:grpc-netty-shaded` and `com.google.protobuf:protobuf-java` advisories (GHSA-prj3-ccx8-p6x4,
  GHSA-735f-pc8j-v9w8) are cleared via direct `dependencyOverrides` (design D2.4a fallback), not a
  `google-cloud-storage` bump: no GCS release in a safe range was established to pull
  `grpc-netty-shaded >= 1.75.0`, so `google-cloud-storage` stays at 2.40.1 and the overrides do the work
  instead.
- All Jackson artifacts (`jackson-core`, `jackson-databind`, `jackson-annotations`, `jackson-module-scala`,
  `jackson-datatype-jsr310`, `jackson-dataformat-toml`) are now pinned together at 2.18.9 and proven by a
  full green `sbt test` (3391 tests, 0 failures) — no step-down within 2.18.x was needed.
- The netty family (12 artifacts, including `netty-buffer` and `netty-resolver`) is pinned together at
  4.1.137.Final.

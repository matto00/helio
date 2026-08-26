## 1. Backend — establish the measured baseline

- [x] 1.1 From `backend/`, dump both trees SEPARATELY and UNTRUNCATED: `sbt -batch 'set ThisBuild/asciiGraphWidth := 400' "Compile/dependencyTree" > /tmp/hel452-compile-before.txt`, same again for `"Test/dependencyTree"` -> `/tmp/hel452-test-before.txt`
- [x] 1.2 Run `python3 <change-dir>/osv-scan.py compile=/tmp/hel452-compile-before.txt test=/tmp/hel452-test-before.txt > /tmp/hel452-before-scan.txt`
- [x] 1.3 Confirm compile scope reports 250 resolved coordinates, 70 advisories / 23 artifacts (1 CRITICAL, 30 HIGH, 34 MODERATE, 5 LOW); a materially different count means a degraded scan, not a clean tree (design D4)
- [x] 1.3a Sanity-check each dump before trusting it: `grep -c evicted` must equal `grep -c '(evicted by:'`. The scanner aborts on truncated rows; do not work around that by widening the filter
- [x] 1.4 Record `npm audit` output for root, `frontend/`, and `helio-mcp/` as the npm-already-clean evidence

## 2. Backend — direct dependency bumps

- [x] 2.1 Bump `org.apache.spark` `spark-core` and `spark-sql` 3.5.5 -> 3.5.9, preserving every existing `exclude(...)` clause verbatim
- [x] 2.2 Bump `org.postgresql:postgresql` 42.7.4 -> 42.7.13 (GHSA-98qh-xjc8-98pq, GHSA-hq9p-pm7w-8p54, GHSA-j92g-9f8w-j867)
- [x] 2.3 Bump `ch.qos.logback:logback-classic` 1.5.18 -> 1.5.38 (clears the 4 logback-core advisories)
- [x] 2.4 Try bumping `com.google.cloud:google-cloud-storage` (2.40.1; 2.72.0 is current) to a release whose closure clears `grpc-netty-shaded` >= 1.75.0 (GHSA-prj3-ccx8-p6x4) and `protobuf-java` >= 3.25.5 (GHSA-735f-pc8j-v9w8) — design D1
- [x] 2.4a FALLBACK for 2.4, if no GCS release in a safe range pulls gRPC >= 1.75.0: override `grpc-netty-shaded`/`protobuf-java` directly under D2, or defer under D5 with justification. Do not assume such a GCS release exists — verify it
- [x] 2.5 Bump the remaining direct deps only where the scan attributes an advisory to them; leave clean deps untouched
- [x] 2.6 Run `sbt compile` and fix any resolution/compile failure before proceeding

## 3. Backend — Jackson pin

- [x] 3.1 Raise the existing `dependencyOverrides` Jackson pin from 2.15.4 to **2.18.9** (all four artifacts together, one consistent version)
- [x] 3.1a Rationale for 2.18.9 over 2.18.8: D2 takes the lowest version clearing EVERY advisory in the set, and GHSA-5jmj-h7xm-6q6v is fixed only at 2.18.9. 2.18.8 would leave one MODERATE open and force a needless deferral write-up
- [x] 3.2 Update the stale inline comment, which currently asserts the pin matches Spark's bundled 2.15.x
- [x] 3.3 Verify `net.logstash.logback:logstash-logback-encoder` 7.4 still functions against the new Jackson line
- [x] 3.3a Confirm the override block covers EVERY Jackson artifact on the classpath: `jackson-datatype-jsr310` resolves to 2.15.2 and is currently outside the four-artifact pin
- [x] 3.4 Run the full `sbt test`; if Jackson 2.18.9 cannot be made green, step down within 2.18.x, and only if that also fails revert to 2.15.4 and move it to the deferred set with justification (design D6)

## 4. Backend — transitive overrides

- [x] 4.1 Extend `dependencyOverrides` per design D2: for each artifact take the MAXIMUM, over all its advisories, of the lowest fix within the major line D3 permits — i.e. the smallest single version clearing EVERY advisory on that artifact. Not "lowest per advisory" (that leaves HIGHs open; see D2's netty worked example)
- [x] 4.2 Cover the netty family together at ONE consistent `4.1.x` version so no two modules disagree. Per D2 the current family target is **4.1.137.Final** (driven by GHSA-8c42-7qj2-3j46 on `netty-codec-http`); re-derive it from your own scan output rather than trusting this number
- [x] 4.3 Cover `commons-lang3` (compile scope resolves **3.12.0** -> 3.18.0; the 3.14.0 seen in test scope is the same advisory, not a second one), `ivy` 2.5.1 -> 2.5.2, `protobuf-java` 3.25.3 -> 3.25.5, and the log4j 2.x artifacts at one consistent version (D2 currently gives **2.25.5**, driven by `log4j-api` GHSA-qv9r-c865-cp47; core and 1.2-api land at 2.25.4). Do NOT add pins for snappy-java, commons-io, commons-compress or guava — the corrected scan attributes them ZERO advisories
- [x] 4.3a Bump `org.lz4:lz4-java` 1.8.0 -> 1.8.1 to clear GHSA-vqf4-7m7x-wgfc (HIGH). Its other two advisories have no published fix and stay deferred — do not skip this artifact just because it appears in D5
- [x] 4.4 Give every added override an inline comment naming the advisory it clears, so it can be retired later
- [x] 4.5 Run `sbt compile` after the override block and resolve any eviction warnings that indicate a conflict

## 5. Backend — verify the count actually moved

- [x] 5.1 Re-dump BOTH trees with `asciiGraphWidth := 400` and re-run `osv-scan.py compile=... test=...` into `/tmp/hel452-after-scan.txt`
- [x] 5.2 Diff before/after compile-scope totals; every advisory still present must be in the deferred set with a justification. An advisory that disappears because its artifact became `(evicted by:)` is genuinely fixed, not hidden — the scanner already excludes evicted rows
- [x] 5.3 Write `osv-after.md` in the change dir recording before/after totals and the full remaining-advisory table
- [x] 5.4 Update `design.md` D5 if the executor added any member to the deferred set

## 6. Tests

- [x] 6.1 Run `sbt compile` clean from the backend and confirm zero errors
- [x] 6.2 Run the full `sbt test` suite and confirm it is green
- [x] 6.3 If a test touches the shared dev Postgres and fails on Flyway history, diagnose as a cross-worktree collision (another run is active) before treating it as a defect in this change
- [x] 6.4 Run `npm run lint` and `npm test` at the repo root and in `frontend/` to confirm the npm side is untouched and still green
- [x] 6.5 Write `files-modified.md` in the change dir listing every file this change touches

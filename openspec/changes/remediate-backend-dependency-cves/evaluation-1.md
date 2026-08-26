# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit reviewed: `62d9caa6` on `task/remediate-backend-dependency-cves/HEL-452`.
All gate results below are from my own fresh runs in the worktree, not from the executor's report.

## Phase 1: Spec Review — FAIL

PASS on:

- Restated scope (per `ticket.md` + `premise-validation.md`) is what was implemented: backend Maven only.
- Direct bumps 2.1–2.3 present and verbatim-preserving the Spark `exclude(...)` clauses.
- 2.4/2.4a: the GCS bump was correctly NOT assumed to exist; the D2.4a override fallback was taken and disclosed.
- Overrides cover exactly the artifacts the scan attributes advisories to. **No dead pins**: `snappy-java`,
  `commons-io`, `commons-compress`, `guava` are not pinned, and I confirmed their *resolved* (non-evicted)
  versions carry zero advisories (1.1.10.5, 2.16.1, 1.26.2, 33.1.0-jre / 33.3.x-android — all clean at OSV).
  The vulnerable versions of those four appear only on `(evicted by:)` rows.
- No scope creep: the diff touches `backend/build.sbt` plus change-dir docs only.
- npm genuinely untouched — `git diff --name-only main...HEAD` matches no `package.json`, no lockfile,
  no `frontend/**`.
- The CRITICAL zookeeper reachability justification is **honest and independently re-verified**:
  `application.conf:145` `masterUrl = "local[*]"`, `SparkJobSubmitter.scala` holds the only `SparkSession`
  builder in the tree, `SPARK_MASTER_URL` has zero hits in `infra/` or `.github/`, and
  `recoveryMode`/`curator`/`zookeeper` have zero hits in backend/infra/CI.

FAIL on:

**The ticket's acceptance criterion "Every remaining (un-remediated) advisory is listed with a written
justification for why it was not fixed — no silent omissions" is violated.** Two advisories that verifiably
still ship are absent from `osv-after.md`'s remaining-advisories table and from its headline counts. Detail
under Change Request 1. Because this ticket's only real deliverable is the *measured* reduction, a headline
number that reads better than the shipped reality is a defect in the deliverable itself, not a doc nit.

## Phase 2: Code Review — FAIL

### Gates (my own runs, in `WORKTREE_PATH`; `CLEAN_WORKTREE` not set)

| gate | result |
|---|---|
| `sbt clean test` (backend) | **PASS** — `Total number of tests run: 3391`, `Suites: completed 215, aborted 0`, `Tests: succeeded 3391, failed 0`, `All tests passed.` |
| `npm run lint` (root) | PASS (exit 0) |
| `npm run format:check` | PASS (exit 0) |
| `npm test` (root + frontend) | PASS — 257 suites / **2833 tests** passed |
| `npm --prefix frontend run build` | PASS (exit 0) |

The executor's claimed 3391 backend / 2833 frontend figures reproduce exactly.

### Independent re-scan (from my own untruncated dumps)

Re-dumped both trees with `set ThisBuild/asciiGraphWidth := 400`, sanity-checked the eviction invariant, and
re-ran the change's own `osv-scan.py`:

- compile dump: `grep -c evicted` = 691 == `grep -c '(evicted by:'` = 691. Invariant holds. (Test dump: 758 == 758.)
  The three `..`-terminated lines in each dump are sbt `[info] loading settings…` banner lines, not coordinate rows.
- Scanner output reproduced the executor's numbers **exactly**: compile scope 249 resolved coordinates,
  691 evicted rows excluded, 3 advisories / 2 artifacts (1 CRITICAL, 1 HIGH, 1 MODERATE); test-only delta 0.

So the reported numbers are faithfully reproducible **from the tool**. The problem is that the tool is blind
here — see Change Request 1.

### D2 override-target verification (per artifact, against OSV)

Every pinned coordinate resolves to exactly its pin and is clean at that version; and for each family target
I checked one notch lower and found it still vulnerable — i.e. **every pin is exactly minimal, none too low,
none needlessly high**:

| pin | clean at pinned version | one notch lower |
|---|---|---|
| jackson (6 artifacts) 2.18.9 | clean | 2.18.8 → GHSA-5jmj-h7xm-6q6v (+2 more) still open |
| netty family (12 artifacts) 4.1.137.Final | all 12 clean | codec-http 4.1.136 → GHSA-8c42-7qj2-3j46 open |
| `grpc-netty-shaded` 1.75.0 | clean | 1.74.0 → GHSA-prj3-ccx8-p6x4 open |
| `protobuf-java` 3.25.5 | clean | 3.25.4 → GHSA-735f-pc8j-v9w8 open |
| `ivy` 2.5.2 | clean | 2.5.1 → GHSA-2jc4-r94c-rp7h open |
| `commons-lang3` 3.18.0 | clean | 3.17.0 → GHSA-j288-q9x7-2f5v open |
| log4j 2.x (3 artifacts) 2.25.5 | clean | log4j-api 2.25.4 → GHSA-qv9r-c865-cp47 open |
| spark 3.5.9 / pgjdbc 42.7.13 / logback-core 1.5.38 | clean | (D1 direct bumps, not D2-bounded) |

D3 is respected everywhere: netty stays `4.1.x`, protobuf `3.25.x`, commons-lang3 `3.x`; no major crossing.
Every override carries the inline advisory comment task 4.4 required.

Code-quality (`CONTRIBUTING.md`): no inline FQNs, no dead code, no TODO/FIXME, comments name the advisory
they retire. Two accuracy defects — Change Requests 2 and 3.

## Phase 3: UI Review — N/A

No UI-affecting file changed. `git diff --name-only main...HEAD` matches none of `frontend/**`,
`backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, `openspec/specs/**` (the only `openspec/`
paths touched are this change's own `openspec/changes/` artifacts). Dev servers were not started.

## Overall: FAIL

The remediation work itself is correct, minimal, and fully green — the D2 derivation is exact to the notch and
I could not find a single pin that is wrong in either direction. The failure is entirely in the **evidence
artifact**, which is this ticket's actual deliverable: `osv-after.md` reports a shipped-vulnerability count
that is lower than what ships.

## Change Requests

**1. `osv-after.md` under-reports the shipped advisory count: the true after-figure is 5, not 3. Correct the
headline totals, the severity split, and the remaining-advisories table.**

Independently verified, and the hypothesis is confirmed in full:

- The patched jar **is** genuinely on the compile classpath — `sbt 'show Compile/dependencyClasspath'` yields
  `.../coursier/.../at/yawk/lz4/lz4-java/1.8.1/lz4-java-1.8.1.jar`. So GHSA-vqf4-7m7x-wgfc **is** really fixed;
  the 4.3a bump did its job and that part of the write-up is sound.
- But querying OSV directly for the relocated coordinate returns the other two advisories **at 1.8.1**:

  ```
  POST api.osv.dev/v1/query {"package":{"ecosystem":"Maven","name":"at.yawk.lz4:lz4-java"},"version":"1.8.1"}
    -> ['GHSA-cmp6-m4wj-q63q', 'GHSA-xx22-p4ch-683r']
  POST api.osv.dev/v1/query {"package":{"ecosystem":"Maven","name":"org.lz4:lz4-java"},"version":"1.8.1"}
    -> [('GHSA-cmp6-m4wj-q63q','HIGH'), ('GHSA-xx22-p4ch-683r','MODERATE')]
  ```

  OSV matches these advisories under **both** coordinates at 1.8.1. They did not get fixed and they did not
  become inapplicable — they became **invisible to the tool**, exactly as suspected. The artifact is absent
  from the post-change tree dump (`grep -i lz4 /tmp/…-compile.txt` → no hits), so `osv-scan.py` never queries it.

Required edits to `osv-after.md`:
- Totals table: compile-scope advisories `70 -> 3` becomes `70 -> 5`; vulnerable artifacts `23 -> 2` becomes `23 -> 3`.
- Severity split after-column: HIGH `1` → `2`, MODERATE `1` → `2` (CRITICAL 1, LOW 0 unchanged).
- Add two rows to the remaining-advisories table for `org.lz4:lz4-java` (resolved: `at.yawk.lz4:lz4-java` 1.8.1)
  — GHSA-cmp6-m4wj-q63q HIGH and GHSA-xx22-p4ch-683r MODERATE — each with the D5 justification already written
  in `design.md` ("no fixed version published anywhere"), and each explicitly flagged as *not detected by the
  scan, established by direct OSV query against the relocated coordinate*.
- Rewrite the "Notes on the scan mechanics" lz4 bullet: it currently ends "…they also no longer surface in the
  scan. The underlying exposure (no fix exists) is unchanged from the baseline." That sentence is true, but it
  sits under a headline that already silently banked the disappearance as progress. Once the table and totals
  carry the two rows, the note should say the scan **under-counts** here and that the table has been corrected
  by hand.
- Change the table's heading line "Remaining advisories (3) — every one already in the design.md D5 deferred
  set" to (5), which is still accurate on the D5 point: `design.md` D5 already names the lz4 pair explicitly, so
  this correction adds no new deferred member and needs no D5 edit.

Note for the record: the executor **did** disclose the mechanism in prose, and the disclosure is technically
accurate. The defect is that the numbers a reader actually carries away — "70 → 3", a three-row table titled
"every remaining advisory" — do not reflect it. That is the specific failure mode this repo has been bitten by
before, and the ticket AC forbids exactly this ("no silent omissions").

**2. `osv-scan.py` has a fourth defect class: relocated Maven coordinates are silently invisible. Guard it in
the tool, or at minimum record it as a known limitation next to the other three.**

The tool's three prior defects are each guarded *in the tool* (glyph capture, evicted rows, truncation abort),
and `design.md`'s Context section documents that pattern deliberately. This one is currently documented only as
a passing remark inside a results file. Any artifact whose POM is a relocation drops out of the tree dump
entirely and is therefore never queried — a false-clean, which is the same class of failure as defect #1.

Minimum acceptable: add the limitation to `design.md`'s Context list of scanner defects, and to `osv-scan.py`'s
header comment, worded so a future reader knows a clean result is not sufficient on its own.
Preferred: have `osv-scan.py` (or a documented companion step) cross-check the tree-derived coordinate set
against `sbt 'show Compile/dependencyClasspath'` and report any jar on the classpath whose `groupId/artifactId`
path has no corresponding tree node, so a relocated artifact surfaces rather than vanishes.

**3. `backend/build.sbt:125-128` — the comment asserts a bump that did not happen.**

```scala
      // HEL-452: bumped from 2.40.1; the grpc-netty-shaded / protobuf-java advisories
      ...
      "com.google.cloud" % "google-cloud-storage" % "2.40.1",
```

The dependency is still 2.40.1 — nothing was bumped. Reword to state what is actually true, e.g. "HEL-452:
deliberately left at 2.40.1 — no GCS release in a safe range was established to pull grpc-netty-shaded >= 1.75.0,
so those advisories are cleared by the dependencyOverrides pins below instead (design D2.4a fallback)." A
false claim in a shipped source comment is the precise trap `design.md`'s own evidence discipline exists to catch.

## Non-blocking Suggestions

- `files-modified.md` says the netty family override covers "11 artifacts"; the block pins **12**
  (`netty-buffer` and `netty-resolver` included). `osv-after.md`'s closing bullet repeats the 11. Worth
  correcting while touching these files for CR 1, but it changes no result.
- The PR body still owes the AC's `package: from -> to (GHSA/CVE id)` list; make sure the lz4 line there reads
  as one advisory fixed and two accepted, consistent with the corrected `osv-after.md`.

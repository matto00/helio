## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review of `task/remediate-backend-dependency-cves/HEL-452` @ `48e86085`.
Everything below I ran or read myself; nothing is carried from the executor's or
evaluator's narrative.

### What I verified (with evidence)

**Diff surface.** `git diff main...HEAD --stat`: `backend/build.sbt` is the only source
file; everything else is this change's own `openspec/changes/` artifacts. Zero
`package.json` / lockfile / `frontend/**` files touched — the npm side is genuinely
untouched, as required.

**Fresh, untruncated dependency dumps.** Re-dumped from the worktree myself:
`sbt -batch 'set ThisBuild/asciiGraphWidth := 400' "Compile/dependencyTree"` and the
Test equivalent, plus `show Compile/dependencyClasspath`.
Eviction invariant holds on both: compile `grep -c evicted` = 691 == `grep -c '(evicted by:'` = 691;
test 758 == 758.

**Re-derived the after-state independently.** Running the change's own `osv-scan.py`
on my fresh dumps reproduces the raw figure exactly: compile scope 249 resolved
coordinates, 691 evicted rows excluded, **3 advisories / 2 artifacts** (CRITICAL 1,
HIGH 1, MODERATE 1); test-only delta **0** advisories (baseline's one commons-lang3
MODERATE is genuinely cleared by the 3.18.0 pin landing in test scope too).

**Hunted defect class 4 and a possible fifth — full classpath-vs-tree cross-check.**
I parsed all 251 third-party jars off `Compile/dependencyClasspath` into
group:artifact:version and diffed against the 249 tree coordinates the scanner sees.
Four classpath artifacts have **no scanned tree node**:

| coordinate | why invisible | OSV result (queried directly by me) |
|---|---|---|
| `at.yawk.lz4:lz4-java:1.8.1` | Maven relocation (documented defect #4) | GHSA-cmp6-m4wj-q63q (HIGH), GHSA-xx22-p4ch-683r (MODERATE) — **still open** |
| `com.google.apis:google-api-services-storage:v1-rev20240621-2.0.0` | **NEW, undocumented**: `osv-scan.py`'s `COORD` version group is `[0-9][...]`, so a `v`-prefixed Maven version is silently dropped even though the row *is* in the tree dump | CLEAN |
| `com.google.apis:google-api-services-sqladmin:v1beta4-rev20240925-2.0.0` | same regex gap | CLEAN |
| `org.scala-lang:scala-library:2.13.15` | not emitted as a tree node | CLEAN |

So there **is** a fifth blind spot, but it changes no number: both artifacts it hides
are OSV-clean today. With the whole classpath now accounted for,
**70 -> 5 advisories / 23 -> 3 artifacts is true and complete of what ships.**
I independently re-confirmed both lz4 advisories still match at 1.8.1 under both
`at.yawk.lz4:lz4-java` and `org.lz4:lz4-java`.

**Internal consistency of `osv-after.md`.** Totals row (`70 -> 5` / `23 -> 3`),
severity split (1+2+2+0 = 5), table title ("Remaining advisories (5)") and the actual
5 data rows all agree, and agree with my scan plus my direct OSV queries. The
raw-vs-corrected split is disclosed up front. Baseline is internally consistent too:
`osv-baseline-raw.txt` compile section has exactly 70 advisory rows against its
`TOTALS: 70 advisories across 23 vulnerable artifacts` / 1-30-34-5 split.

**Deferrals honestly justified — checked the code, not the narrative.**
- CRITICAL `zookeeper` 3.6.3 reachability: `application.conf:145` sets
  `spark.masterUrl = "local[*]"`; `SparkJobSubmitter.scala:37` is the only
  `.master(...)`/`SparkSession.builder()` in the tree; `SPARK_MASTER_URL` has **zero**
  hits under `infra/` or `.github/` (only `CLAUDE.md`, `docs/spark-setup.md`,
  `.env.example`, `application.conf` itself); no `spark.deploy.recoveryMode`, no
  Curator, no ZK connect string anywhere. The argument holds.
- `aircompressor` 0.27 -> 2.0.3 is a major bump, explicitly out of scope per ticket.
- Both remaining `lz4-java` advisories: I confirmed via direct OSV query that neither
  has any fixed version published. Correctly deferred, and correctly *not* silently dropped.

**Every pin is correct, live, minimal, and within its major line.** I OSV-queried all
24 pinned/bumped coordinates individually — **all CLEAN** (logback 1.5.38 incl.
logback-core, postgresql 42.7.13, spark-core/spark-sql 3.5.9, all six Jackson
artifacts at 2.18.9, netty at 4.1.137.Final, grpc-netty-shaded 1.75.0, protobuf-java
3.25.5, ivy 2.5.2, commons-lang3 3.18.0, all three log4j at 2.25.5,
google-cloud-storage 2.40.1). I then grepped the fresh tree for each of the 22
override artifacts: **every one resolves at exactly its pinned version** — no dead
pins, no pin that failed to take, no two netty/log4j/Jackson modules disagreeing.
No pin crosses a major boundary (jackson 2.15->2.18, netty 4.1.x, log4j 2.x,
protobuf 3.25.x, ivy 2.5.x, commons-lang3 3.x, grpc 1.x).

**Jackson 2.15.4 -> 2.18.9 coverage.** All six Jackson coordinates on the compile tree
are at 2.18.9 with **no straggler at any other version** — `jackson-datatype-jsr310`
and `jackson-dataformat-toml`, previously outside the pin, are now inside it. Runtime
safety against Spark 3.5.9 / logstash-logback-encoder 7.4 is evidenced by the full
green backend suite (below), which exercises the real request/JSON paths.

**Gates, run by me on this commit:**

| gate | result |
|---|---|
| `sbt test` (implies compile) | **PASS** — `Suites: completed 215, aborted 0`; `Tests: succeeded 3391, failed 0, canceled 0, ignored 0, pending 0`; `All tests passed.`; exit 0 |
| root `npm run lint` | **PASS** — `eslint . --max-warnings=0`, exit 0 |
| `npm test` (root + frontend) | **PASS** — 257 suites / **2833 tests** passed, exit 0 |
| `npm audit` root / `frontend/` / `helio-mcp/` | **0 vulnerabilities in all three** |

All match the claimed figures exactly.

### Verdict: REFUTE

The remediation itself is correct and I could not break it: the pins are right, the
after-state really is 70 -> 5, and the deferrals are honest. I am refuting on the
evidence artifact, because on this ticket **the numbers are the product** — and one
delivered artifact still publishes the known-wrong number that cycle 1 was refuted for.

### Change Requests

1. **`openspec/changes/remediate-backend-dependency-cves/files-modified.md` lines 6-7
   state a false advisory count.** It reads *"Clears 67 of 70 baseline backend Maven
   advisories (70->3)"*. The true, corrected after-state — established in
   `osv-after.md`, reproduced by me above — is **70 -> 5**, i.e. it clears **65 of 70**.
   `70 -> 3` is precisely the raw-scanner figure that hides the two invisible
   `lz4-java` advisories; publishing it here re-creates the exact cycle-1 defect
   (a reader, and the PR body this file feeds, comes away with a better number than
   what ships). Correct to `Clears 65 of 70 baseline backend Maven advisories
   (70->5; raw scanner output reads 70->3 and undercounts by the two relocated
   lz4-java advisories — see osv-after.md)`. Also note the same file's netty prose
   should read 12 artifacts, matching `build.sbt` and `osv-after.md`.

2. **`osv-scan.py` has a fifth, previously-undocumented blind spot; the "FOUR defects"
   inventory in `osv-scan.py`'s header and `design.md`'s Context is now incomplete.**
   The `COORD` regex requires the version group to start with a digit
   (`r':([0-9][a-zA-Z0-9_.+-]*)'`, `osv-scan.py` ~line 61), so a Maven version that
   starts with a letter is silently dropped **even when its row is present in the tree
   dump**. Two shipped compile-scope artifacts hit this today:
   `com.google.apis:google-api-services-storage:v1-rev20240621-2.0.0` and
   `com.google.apis:google-api-services-sqladmin:v1beta4-rev20240925-2.0.0`. I
   verified both are OSV-clean, so **no delivered number changes** — but this is a
   second, independent false-clean mode in a tool whose header explicitly enumerates
   its false-clean modes, and the sibling CI-gate ticket will inherit it. Document it
   as defect #5 (unguarded, same framing as #4) in both `osv-scan.py`'s header and
   `design.md`'s Context, citing these two concrete coordinates. Fixing the regex is
   optional; leaving the inventory saying "FOUR" is not.

### Non-blocking notes

- The scanner's reported "249 resolved coordinates" includes two non-artifacts: the
  project's own `helio-backend:helio-backend_2.13:0.1.0-SNAPSHOT` and a spurious
  `2:13:54` parsed out of sbt's `[success] Total time ... 2:13:54 AM` footer line.
  Real third-party count is 247. Harmless (both are OSV misses, not hits), but worth
  a filter when this tool becomes a gate.
- `grpc-netty-shaded` jumps 1.66.0 -> 1.75.0 while `google-cloud-storage` stays at
  2.40.1. Low risk (GCS's default transport here is HTTP/JSON, not gRPC, and the suite
  is green), but it is the one pin whose runtime path the tests do not directly
  exercise — worth a smoke check of the `gcs` uploads backend after deploy.
- `CLAUDE.md`'s env table still documents `SPARK_MASTER_URL` as defaulting to
  `spark://localhost:7077`, while `application.conf:145` actually defaults to
  `local[*]`. Pre-existing doc drift, not introduced here, but it slightly undercuts
  the zookeeper deferral argument for anyone reading only the docs.

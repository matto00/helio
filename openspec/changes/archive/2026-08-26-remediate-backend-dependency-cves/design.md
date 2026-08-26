## Context

`backend/build.sbt` declares Spark 3.5.5 at **compile** scope (comment: "driver runs in this JVM"), so Spark's
transitive closure ships in the production image. It already carries a `dependencyOverrides` block pinning Jackson
to 2.15.4 with the comment "Spark 3.5.x bundles 2.15.x which is compatible" — so overriding Spark's transitive
versions is an established pattern in this file, not a new mechanism.

Baseline evidence (`osv-baseline.md`, `osv-baseline-raw.txt`, reproducible via `osv-scan.py`): **250 resolved
compile-scope coordinates carrying 70 advisories / 23 artifacts (1 CRITICAL, 30 HIGH, 34 MODERATE, 5 LOW)**. Test
scope adds NO new advisory (its one test-only row is the same `commons-lang3` GHSA-j288-q9x7-2f5v already counted
at compile scope, at a different version; the version that ships is 3.12.0). Only compile scope ships. The great
majority arrive transitively through Spark.

`osv-scan.py` has had FIVE real defects. The first three were each found before use and are guarded in the
tool itself; the fourth and fifth were found at the cycle-2 evaluation and cycle-3 skeptic gates respectively
and are real, currently unguarded gaps — documented here and in the tool's own header comment so a future
reader does not mistake a clean scan for proof of nothing:
- Its first draft silently returned **0** advisories: the dependency-tree `+-` glyph was captured into the groupId,
  so every lookup queried a nonexistent package. Treat a low advisory count as suspect until the resolved
  coordinate count is also confirmed (expect ~250 compile / ~280 test).
- Its second draft counted `(evicted by: ...)` rows — conflict losers that are **not on the resolved classpath and
  do not ship**. That overstated the count by 32% (106 -> 72 union) and invented a phantom CRITICAL
  (`zookeeper:3.4.8`, evicted by `3.6.3`). Evicted rows are now excluded, and scopes are reported separately.
- Its third draft trusted truncated input. `sbt dependencyTree` truncates rows to terminal width, ending them `..`,
  which destroys the `(evicted by:)` marker on deep rows and fabricates versions. Filtering on the substring
  `(evicted` is NOT sufficient — some rows truncate before that word begins. Every dump must set
  `ThisBuild/asciiGraphWidth := 400`, and the tool now **aborts** on any truncated coordinate row. Sanity check:
  `grep -c evicted` must equal `grep -c '(evicted by:'`.
- **NOT guarded — a real gap.** Relocated Maven coordinates are silently invisible to the tool. When a POM is a
  Maven "relocation" (groupId/artifactId moved — e.g. `org.lz4:lz4-java` -> `at.yawk.lz4:lz4-java`),
  `sbt-dependency-graph` drops the node from the tree dump entirely: the artifact IS on the resolved classpath
  (confirm with `sbt 'show Compile/dependencyClasspath'`) but never appears as a coordinate row, so `osv-scan.py`
  never queries it and reports nothing for it — a false-clean, not a fix. Found at the HEL-452 cycle-2
  evaluation gate: `lz4-java` 1.8.1 dropped out of the post-change tree dump after the 4.3a bump, and the
  scan's headline count silently banked that disappearance as two advisories fixed (GHSA-cmp6-m4wj-q63q,
  GHSA-xx22-p4ch-683r) when in fact neither has a published fix and both still match 1.8.1 at OSV under either
  coordinate — they were only ever invisible, never remediated. `osv-after.md`'s remaining-advisories table
  corrects this by hand; the tool itself does not yet cross-check the classpath against the tree, so a future
  run must repeat this manual check rather than trust a clean result on its own.
- **NOT guarded — a second, independent real gap.** The COORD regex's version group requires the version to
  start with a digit (`r':([0-9][a-zA-Z0-9_.+-]*)'`), so a letter-prefixed Maven version is silently dropped
  even when its coordinate row IS present, verbatim, in the tree dump — unlike defect #4 (a missing node),
  this hides a node the tree dump actually contains. Found at the HEL-452 cycle-3 skeptic gate via a full
  classpath-vs-tree cross-check: `com.google.apis:google-api-services-storage:v1-rev20240621-2.0.0` and
  `com.google.apis:google-api-services-sqladmin:v1beta4-rev20240925-2.0.0` both hit this (Google API client
  libraries version by API revision, not semver). Both happen to be OSV-clean today, so this changed no
  delivered HEL-452 number — but it is a distinct false-clean mode the sibling CI-gate ticket will inherit if
  left unguarded. Widening the regex risked reintroducing the glyph-capture failure mode defect #1 already
  had to fix once, so this was documented rather than force-fixed; a future change can revisit widening it
  with its own dedicated false-positive testing.

## Goals / Non-Goals

**Goals:**
- Remove every backend advisory that has a safe, non-breaking upgrade path.
- Make the result *measured*, not asserted: a before/after OSV scan is the acceptance oracle.
- Leave a written justification for every advisory that remains.

**Non-Goals:**
- Spark 3.5.x -> 4.x. Any advisory fixable only that way is deferred.
- npm changes (all three trees independently verified at 0 `npm audit` vulnerabilities).
- `dependabot.yml`, a CI CVE gate, or cadence docs (separate HEL-434 siblings).
- Shipping `osv-scan.py` as a CI gate. It stays a change-local evidence tool for this ticket; wiring it into CI is
  the sibling ticket's job.

## Decisions

**D1 — Prefer bumping the direct dependency over pinning its transitive.** Where a vulnerable artifact arrives via
a direct dependency that has a newer release carrying the fix, bump the direct dependency. This keeps the resolved
closure internally coherent and avoids accumulating pins that later silently mask upstream fixes. Concretely this
is expected to clear the `grpc-netty-shaded` / `protobuf-java` advisories via `google-cloud-storage`, rather than
pinning gRPC directly. *Alternative rejected:* pin everything transitively — fewer build.sbt edits, but produces a
pin set that nobody can safely retire later.

**D2 — Where no direct bump reaches the fix, use `dependencyOverrides` at the smallest version that clears EVERY
advisory on that artifact.** Stated precisely, because the naive reading is wrong: for each artifact, take the
**maximum, over all of that artifact's advisories, of the lowest fix lying within the major line permitted by D3**.
For a family pinned to one version (D3: netty), take the maximum of that value across the whole family. Worked
counterexample: `netty-codec-http` at 4.1.96.Final carries advisories fixed at 4.1.132, 4.1.133, 4.1.136 and
4.1.137 (GHSA-8c42-7qj2-3j46) — "the lowest fix per advisory" would yield 4.1.132 and leave several HIGHs open,
which D4/task 5.2 would then force into a bogus deferral write-up. Applying the rule correctly to the whole family
(max over every netty artifact of its own per-artifact maximum: codec 4.1.136, codec-http **4.1.137**, codec-http2
4.1.136, handler/transport-native-* 4.1.135, handler-proxy 4.1.133, common 4.1.118) gives a family target of
**4.1.137.Final**. Derive this from the scan output rather than copying it — the number moves as advisories land.
This is the same rule 3.1a applies to Jackson.
"Smallest safe remediation" therefore means the smallest version that actually finishes the job, not the smallest
version mentioned anywhere. Distance from Spark's tested closure is the main compatibility risk, so minimise it
subject to that constraint. Note this bounds **overrides** (section 4). D1 direct bumps are not held to it: taking
the current patch release of a direct dependency (spark 3.5.9, pgjdbc 42.7.13, logback 1.5.38) is preferred over
its bare D2 minimum (3.5.7 / 42.7.12 / 1.5.34), because a direct dependency's own patch line is the version its
maintainers actually test. *Alternative rejected:* track latest for overrides too — maximises the chance of a
subtle Spark/netty ABI break for no additional security benefit.

**D3 — Never cross a major-version boundary of a library Spark links against.** netty stays in `4.1.x`,
protobuf-java in `3.25.x`, commons-lang3 in `3.x`, guava within the `-jre`/`-android` line already resolved. A fix
that exists only across a major boundary is deferred under D5, not forced.

**D4 — The acceptance oracle is the re-scan, not a version checklist.** After the edit, re-run
the two dependency trees -> `osv-scan.py` and diff the totals against the 70/23 compile-scope baseline.
A bump that does not move the count (because something else pins the artifact back down) is not a fix, and must be
either corrected or documented. Note the asymmetry found at the design gate: `dependencyOverrides` (section 4)
rewrites the tree outright, so override-based fixes move the count cleanly; a **direct** bump (section 2) can leave
the superseded version printed as an `(evicted by:)` row, which is precisely why the scanner must exclude those
rows — otherwise a successful direct bump would look like an unfixed advisory and be wrongly written up as
accepted risk. This is what prevents "I bumped the version" from standing in for "the advisory is
gone" — the two are genuinely different claims in a transitive closure with existing overrides.

**D5 — Deferred set, with justification recorded in `design.md`, the PR body, and the ticket.** Known members:
- `io.airlift:aircompressor` **0.27** / GHSA-vx9q-rhv9-3jvg -> fixed only at 2.0.3 — major bump; Spark 3.5.x calls
  its decompressor API directly. (Note: `0.21` is evicted by `0.27` and does not ship, so GHSA-973x-65j7-xcf4 is
  already fixed in the resolved closure and is NOT part of the accepted risk.)
- `org.apache.zookeeper:zookeeper` **3.6.3** -> 3.9.x — reached only through Spark's HA/cluster-coordination
  path. This deployment runs Spark in local/driver mode on Cloud Run and never contacts a ZooKeeper ensemble —
  verified at the design gate: `backend/src/main/resources/application.conf` sets `spark.masterUrl = "local[*]"`,
  `SparkJobSubmitter.scala` is the only `SparkSession.builder()` in the tree, `SPARK_MASTER_URL` has zero hits in
  `infra/` or `.github/`, and no `spark.deploy.recoveryMode` / Curator / ZK connect string exists anywhere.
- `org.lz4:lz4-java` — **two** of its three advisories have no published fix anywhere: GHSA-cmp6-m4wj-q63q
  (HIGH) and GHSA-xx22-p4ch-683r (MODERATE). The third, GHSA-vqf4-7m7x-wgfc (HIGH), IS fixed at 1.8.1 and must
  be remediated — only the two unfixable ones are deferred. Do not defer the artifact wholesale.
The executor may add to this set, but every addition needs the same three-part justification: why the safe path
does not exist, what the exposure actually is here, and what would have to change to fix it.

**D6 — The Jackson pin moves to the lowest patched version, and is proven by the test suite, not by reasoning.**
The existing pin (2.15.4) is itself vulnerable (7 advisories, 3 HIGH). The lowest version clearing ALL SEVEN is
**2.18.9** (GHSA-5jmj-h7xm-6q6v is fixed only there; the other six are fixed by 2.18.8). Spark 3.5.x and
`logstash-logback-encoder` 7.4 both link Jackson, so this is the single highest-risk edit in the change. It is
gated on a full green `sbt test`, and `logstash-logback-encoder` must be re-checked since its 7.4 release declares
Jackson 2.15.2. If 2.18.9 cannot be made green, step down within 2.18.x, and only if that fails too revert to
2.15.4 and document under D5 rather than shipping a red suite.

## Risks / Trade-offs

- **Spark/netty ABI break.** Highest-likelihood failure mode. Mitigated by D2/D3 (minimum fixed version, no major
  crossings) and caught by `sbt test`, which exercises the pipeline execution paths that use Spark.
- **A pin outliving its usefulness.** Every override added here is a future maintenance liability that can mask an
  upstream fix. Mitigated by D1 (prefer direct bumps) and by each override carrying an inline comment naming the
  advisory it clears, so a later reader can tell when it is safe to drop.
- **Residual accepted risk.** The deferred set leaves real advisories in the image, including a CRITICAL ZooKeeper
  authorization bypass. The argument for accepting it is *reachability* (no ZooKeeper ensemble is ever contacted),
  not severity — that reasoning is recorded so it can be revisited if Spark's deployment mode ever changes.
- **Scan-tool trust.** `osv-scan.py` queries a live external API; a network failure or throttle degrades to a false
  clean. D4's resolved-coordinate-count check (expect ~250 compile / ~280 test) guards against accepting that.

## Planner Notes

Self-approved decisions, per the run's recorded decision authority
(`.concertino/runs/HEL-452/evidence/decision-authority.md`): escalate-and-halt is reserved for infra/deploy/cost
decisions. This change edits dependency versions in one file and spends nothing, so every decision above was taken
locally and recorded rather than escalated. The earlier `material-drift` ticket-drift escalation was raised,
recorded, and resolved as `proceed-with-restated-scope`.

No commit-gate-chain files (`.husky/**` or any script a pre-commit hook invokes) are touched by this change, so
CON-132's Gate-Chain Implications Checklist does not apply.

## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Baseline reproducibility — CONFIRMED, exactly.**
Ran the documented procedure myself from a cold worktree:
`sbt -batch "Compile/dependencyTree" "Test/dependencyTree"` (exit 0, 16607 lines) then
`osv-scan.py`. Output: `scanned 349 coordinates / TOTALS: 106 advisories across 39
vulnerable artifacts / CRITICAL 2, HIGH 45, MODERATE 50, LOW 9`. A `diff` of my raw scan
against `osv-baseline-raw.txt` (advisory rows) is **byte-identical**. The scanner is not
returning a silent-zero, the regex captures groupIds correctly, and the committed baseline
is a faithful record of what the tool produces. The `+-` glyph bug is genuinely fixed.

**ZooKeeper reachability argument (D5) — CONFIRMED, the claim is true of this repo.**
I checked the code rather than the narrative:
- `backend/src/main/resources/application.conf:143-146` — `spark.masterUrl = "local[*]"`,
  overridable only by `SPARK_MASTER_URL`.
- `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala:33-41` — the only
  `SparkSession.builder()` in the codebase; `.master(masterUrl)`, no `spark.deploy.*`,
  no `recoveryMode`, no ZK config keys anywhere.
- `grep -rn SPARK_MASTER_URL infra/ .github/` — **no hits**. It is never set on any deploy
  path; prod runs `local[*]`.
- No `spark.deploy.recoveryMode`, Curator, or ZK connect-string anywhere in `backend/src`.
ZooKeeper is reached by Spark only via standalone-master HA / cluster coordination, which
this deployment does not use. The deferral is honest, not an excuse. **Accepted.**

**aircompressor / lz4-java deferrals — accepted** (see CR 1 for a correction to how
aircompressor is described). Real remaining aircompressor exposure is `0.27` /
GHSA-vx9q-rhv9-3jvg, fixed only at `2.0.3` (major). lz4-java GHSA-cmp6-m4wj-q63q has no
published fix. Both deferrals stand.

**D2 (lowest fixed version) — sound, not rationalisation.** Minimising distance from
Spark's tested closure is the correct risk posture for a transitive override set, and for
the artifacts in question (netty 4.1.136.Final, protobuf 3.25.5) the "lowest fix" is
already at or near the top of the compatible line, so D2 costs nothing.

**D4 oracle vs. existing pins — partially sound, and better than I expected.** I checked
whether an `dependencyOverrides` pin leaves the pre-override version visible in the tree:
`grep -o 'jackson-databind:[0-9.]*' | sort -u` returns **only `2.15.4`**, with zero
`(evicted by:)` rows for Jackson. sbt's `dependencyOverrides` rewrites the tree outright,
so override-based fixes *will* move the scan count. D4 works for section 4. It does **not**
work cleanly for section 2 — see CR 1.

**`skip_specs: true` — CORRECT.** The change is confined to `backend/build.sbt` dependency
coordinates. No route, schema, wire shape, or behavior is altered; nothing in
`openspec/specs/**` describes dependency versions. No spec delta is owed.

**Decision authority — not challenged.** Per
`.concertino/runs/HEL-452/evidence/decision-authority.md`, version bumps are delegated
local decisions. I am not refuting on self-approval grounds.

**Evidence discipline note:** the baseline scan was run twice against the same tree with
identical results, and the eviction finding below is a deterministic text-filter effect,
not a flaky reading.

---

### Verdict: REFUTE

The baseline is *reproducible* but not *correct*. `osv-scan.py` counts dependency-tree rows
that sbt has explicitly marked as evicted — i.e. coordinates that are **not on the resolved
classpath and do not ship**. The tree contains **1424** `(evicted by: ...)` rows. Re-running
the identical scanner with a one-line filter that skips those rows gives:

```
scanned 297 coordinates
TOTALS: 72 advisories across 25 vulnerable artifacts
  CRITICAL: 1   HIGH: 30   MODERATE: 36   LOW: 5
```

So **34 of the 106 advisories (32%) are phantoms**, including **one of the two CRITICALs**.
Concretely, from my own tree output:
- `zookeeper:3.4.8 (evicted by: 3.6.3)` — line 2865. Its 4 advisories, including the
  CRITICAL GHSA-7286-pgfv-vxvh, are counted twice over; only the 3.6.3 instance is real.
- `aircompressor:0.21 (evicted by: 0.27)` — line 4233. GHSA-973x-65j7-xcf4 (HIGH, fixed in
  0.27) is **already fixed** in the resolved closure; the baseline reports it as open.
- `protobuf-java` 3.19.6 and 3.25.1 are both evicted; only 3.25.3 is real, turning three
  HIGH rows into one.

This matters beyond bookkeeping: proposal.md and design.md both assert that this stack
"ships inside the production Cloud Run image" and quote 106/39/2-CRITICAL as the live attack
surface. That statement is false for a third of the count, and it will propagate verbatim
into the PR body and the Linear ticket. This repo has a documented history of confidently
false security/config documentation being the actual defect; shipping an overstated CVE
count as the headline evidence artifact is exactly that failure mode.

It also breaks D4 as an oracle for **section 2** (direct bumps). A direct bump that changes
a transitive version leaves the *old* version printed as an `(evicted by:)` row, so its
advisories stay in the count. Task 5.2 ("every advisory still present must be in the
deferred set with a justification") would then force the executor to write deferral
justifications for advisories that are already fixed and for versions that are not on the
classpath — permanently mis-recording accepted risk.

---

### Change Requests

1. **Fix `osv-scan.py` to exclude evicted coordinates, then re-baseline.** In `coords()`,
   skip any line containing `(evicted by:`. Regenerate `osv-baseline.md` and
   `osv-baseline-raw.txt` from the corrected tool. Update every count quoted in
   `proposal.md` ("106 advisories across 39 artifacts", "2 CRITICAL"), `design.md` Context,
   and `tasks.md` 1.3 (which hardcodes `349 coordinates and 106 advisories / 39 artifacts`
   as the degraded-scan tripwire) to the corrected figures. My independently reproduced
   corrected numbers are **297 coordinates / 72 advisories / 25 artifacts / 1 CRITICAL,
   30 HIGH, 36 MODERATE, 5 LOW** — the executor should regenerate rather than copy these,
   but a materially different result means something else is wrong.

2. **Correct D5's aircompressor entry.** It currently cites `0.21/0.27 -> 2.0.3`. Version
   `0.21` is evicted and not on the classpath; GHSA-973x-65j7-xcf4 is already fixed by the
   resolved `0.27`. The deferral should name exactly one residual advisory —
   `aircompressor 0.27` / GHSA-vx9q-rhv9-3jvg, fixed only at `2.0.3` (major, API-breaking
   under Spark) — so the accepted-risk record is not overstated either.

3. **Separate Compile-scope from Test-scope in the baseline.** The scan concatenates
   `Compile/dependencyTree` and `Test/dependencyTree` into one undifferentiated coordinate
   set, then the proposal describes the whole result as shipping in the production image.
   Test-only artifacts (`embedded-postgres`, `mockito-core`, `json-schema-validator` and
   their closures) do not ship. Either scan the two trees separately and report two totals,
   or label each advisory row with its scope. Without this, "live attack surface" remains an
   unsupported characterisation and remediation priority cannot be judged.

4. **Give tasks 2.4 and 3.1 a stated fallback; neither is currently completable as written.**
   - 2.4 ("bump `google-cloud-storage` to a release whose closure clears `grpc-netty-shaded`
     and `protobuf-java`") assumes such a release exists. Clearing GHSA-prj3-ccx8-p6x4
     requires gRPC >= `1.75.0`, several years ahead of the `1.62.2` that `google-cloud-storage
     2.40.1` resolves; no evidence is offered that any GCS release in a safe range pulls it.
     Add the D2 fallback explicitly: if no such release exists, override
     `grpc-netty-shaded`/`protobuf-java` directly, or defer under D5 with justification.
   - 3.1 hardcodes Jackson `2.18.8`, but the baseline's own table shows GHSA-5jmj-h7xm-6q6v
     is fixed only in `2.18.9`. Under D2 ("lowest version that clears *the advisory*",
     applied across the set) the target is `2.18.9`, otherwise task 5.2 will demand a
     deferral write-up for an advisory the change could have cleared for free. State the
     target and the tie-break rule explicitly.

---

### Non-blocking notes

- D6's Jackson `2.15.4 -> 2.18.x` bump against Spark 3.5.9 is genuinely the riskiest edit
  here (`jackson-module-scala` is the usual break point), but the plan's gating is adequate:
  full `sbt test`, with a documented revert-and-defer fallback rather than shipping red. I
  do not consider it likely to burn cycles unrecoverably.
- Once CR 1 lands, consider having `osv-scan.py` print the evicted-vs-resolved split
  explicitly. It is a useful signal, and it prevents the next reader from re-deriving this
  finding.

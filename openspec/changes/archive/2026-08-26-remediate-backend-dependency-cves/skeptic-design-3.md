## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold review. Every number below was derived from dependency trees I dumped myself in this
worktree at base commit `b7f9681a`, not from the committed baseline or from rounds 1–2.

### What I verified (with evidence)

**1. Re-derived the baseline from scratch — it reproduces EXACTLY, byte for byte.**
```
cd backend
sbt -batch 'set ThisBuild/asciiGraphWidth := 400' "Compile/dependencyTree" > /tmp/sk3-compile.txt   # exit 0, 8161 lines
sbt -batch 'set ThisBuild/asciiGraphWidth := 400' "Test/dependencyTree"    > /tmp/sk3-test.txt      # exit 0
python3 osv-scan.py compile=/tmp/sk3-compile.txt test=/tmp/sk3-test.txt > /tmp/sk3-scan.txt
diff /tmp/sk3-scan.txt osv-baseline-raw.txt   -> no differences
```
```
### compile scope
resolved coordinates: 250   (excluded 692 evicted tree rows)
TOTALS: 70 advisories across 23 vulnerable artifacts
  CRITICAL: 1  HIGH: 30  MODERATE: 34  LOW: 5
### test-ONLY   resolved 33, 1 advisory / 1 artifact (MODERATE: 1)
```
Dump integrity: `grep -c evicted` == `grep -c '(evicted by:'` on both dumps (compile 692/692,
test 790/790). The only three lines ending `..` are sbt's own log lines
(`loading settings for project ...`), which carry no coordinate and are correctly ignored.
**250 / 70 / 23 and the 1/30/34/5 split are confirmed. No fourth counting defect found.**

**2. The truncation guard works and does not drop legitimate rows.**
I synthesised a truncated dump from my own wide dump (`awk` cut to 85 chars + `..`), which
reproduces the round-2 corruption (`evicted` 663 vs `(evicted by:` 601). The tool aborts:
```
ABORT: 262 coordinate row(s) are truncated to terminal width.  ...  rc=2
```
It aborts in a pre-pass over *all* inputs before any OSV query, so a truncated test dump cannot
be scanned after a clean compile dump. It cannot be bypassed by the round-2 vector (rows
truncated before the word `evicted`) because the test is on the row shape, not the substring.
It does not drop legitimate rows: truncated rows `continue` but then raise, and the wide-dump
run is byte-identical to the committed baseline. One residual blind spot, non-blocking, see notes.

**3. CR1–CR5 are genuinely fixed in the artifacts, not merely asserted.**
- CR1 — `tasks.md` 1.1 and 5.1 both mandate `set ThisBuild/asciiGraphWidth := 400`; 1.3a adds the
  `grep -c` equality check; `osv-scan.py:66-88` implements the abort (verified firing above).
- CR2 — every quoted figure is 250/70/23, 1/30/34/5, in `proposal.md`, `design.md` (Context),
  `ticket.md` and `osv-baseline.md`. All match my independent scan.
- CR3 — `ticket.md:11` now carries the corrected compile-scope figures. I swept all four
  artifacts for the stale values (`349`, `106`, `39`, `265`, `71`, `24`, `72`, `35`,
  `2 CRITICAL`): the only surviving hits are `design.md:19`'s explicitly-historical
  "overstated the count by 32% (106 -> 72 union)" and `ticket.md:5`'s quotation of the original
  filing. **No stale figure survives anywhere that could propagate a false claim into the PR
  body or the Linear ticket.**
- CR4 — confirmed against my own scan: `commons-lang3` is `3.12.0` at compile scope and `3.14.0`
  test-only, both `GHSA-j288-q9x7-2f5v` — one advisory, two versions. `tasks.md` 4.3 targets 3.12.0.
- CR5 — D2's *rule text* is now correct ("maximum, over all of that artifact's advisories, of the
  lowest fix within the major line permitted by D3"). Its **worked example is wrong** — see Verdict.

**4. Spot-checked the facts tasks.md assumes.** All true in `backend/build.sbt`: spark-core/sql
3.5.5 (L126/L133), postgresql 42.7.4 (L99), logback-classic 1.5.18 (L90), google-cloud-storage
2.40.1 (L122), a four-artifact Jackson `dependencyOverrides` pin at 2.15.4 (L142-146) with the
stale "matching Spark's 2.15.x" comment 3.2 targets. `jackson-datatype-jsr310` resolves to
**2.15.2** on three non-evicted rows and is indeed outside the pin (3.3a correct). Jackson 2.15.4
carries 7 advisories, 3 HIGH, and `GHSA-5jmj-h7xm-6q6v fixed=2.18.9,...` is the only one not
cleared by 2.18.8 — 3.1's 2.18.9 target is right. D5's deferred set is honest: my scan shows
exactly one CRITICAL (`zookeeper 3.6.3 GHSA-7286-pgfv-vxvh`), one aircompressor row (0.27 only,
0.21 evicted), and `lz4-java GHSA-cmp6-m4wj-q63q` with no fixed version. Tasks 4.3's "ZERO
advisories" claim for snappy-java / commons-io / commons-compress / guava is confirmed — none
appear in the compile-scope table.

**Reproduction discipline.** The finding below is deterministic text present in both my fresh
scan and the committed `osv-baseline.md:95`. Not a flaky reading.

---

### Verdict: REFUTE

One blocking defect, and it is inside the exact decision CR5 was raised to fix.

D2's netty worked example — the concrete number `tasks.md` 4.1/4.2 tell the executor to mirror —
**understates the target by one patch release and would leave a real advisory open.**

`design.md:54-56`:
> `netty-codec-http` at 4.1.96.Final has fixes at 4.1.132, 4.1.133 (x2) and 4.1.136 (x3) ...
> The correct target is 4.1.136.Final.

That enumeration covers only the artifact's 6 HIGH advisories. `netty-codec-http` at 4.1.96.Final
actually carries **19** advisories (6 HIGH, 12 MODERATE, 1 LOW), and one of them is fixed only
above 4.1.136 — from my scan and from the committed baseline table (`osv-baseline.md:95`):
```
MODERATE io.netty:netty-codec-http 4.1.96.Final GHSA-8c42-7qj2-3j46 fixed=4.1.137.Final,4.2.17.Final
         | Netty Vulnerable to Cache Poisoning and Information Disclosure via CORS Vary Header
```
Applying D2's own rule (max over ALL of the artifact's advisories) gives **4.1.137.Final**, not
4.1.136.Final. I checked the whole family for the D2 family-max clause; 4.1.137.Final is also the
family maximum (netty-codec 4.1.136, netty-codec-http2 4.1.136, netty-handler /
netty-transport-native-epoll / -kqueue 4.1.135, netty-handler-proxy 4.1.133, netty-common 4.1.118).

This is blocking rather than a nit because the design states the wrong number as normative and
`tasks.md` 4.1 explicitly defers to it ("see D2's netty worked example"), while 4.2 requires one
consistent family version. An executor following the artifact as written pins 4.1.136.Final,
`GHSA-8c42-7qj2-3j46` survives the re-scan, and task 5.2 then forces it into the deferred set —
producing precisely the "bogus deferral write-up" D2 exists to prevent, and shipping an
accepted-risk claim into the PR body and the Linear ticket for an advisory that has a safe,
in-major-line fix one patch away.

### Change Requests

1. `design.md:54-56` (D2 worked counterexample) — correct the target to **4.1.137.Final** and fix
   the enumeration. `netty-codec-http` at 4.1.96.Final has 19 advisories, not 6; the binding one is
   `GHSA-8c42-7qj2-3j46` (MODERATE, fixed=4.1.137.Final). Keep the point of the example — that
   "lowest fix per advisory" is wrong — but state a number that survives the rule. If the example
   is deliberately restricted to HIGHs, say so explicitly, because D2's rule is over *all*
   severities and tasks 4.1 mirrors the number, not the caveat.
2. `tasks.md` 4.2 — name the family target explicitly (`4.1.137.Final`) rather than leaving it to
   be re-derived, and add the derivation check: for each netty module, `grep` its rows in
   `osv-baseline.md` and confirm no `fixed=` entry inside `4.1.x` exceeds the chosen pin. That
   check is what would have caught this one, and it is cheap.

### Non-blocking notes

- **Residual guard blind spot.** `coords()` flags a row as truncated only when it ends `..` **and**
  a full `group:artifact:version` still matches. A row truncated *before* its version (e.g.
  `+-com.google.foo:some-very-long-artifact-na..`) matches neither test and is silently dropped —
  undercounting rather than aborting. Zero real occurrences at 85 columns in my synthesised dump
  (the only two such rows were sbt's `set current project to helio-backend (in build file:...` log
  lines), and the mandated width of 400 makes it unreachable in practice, so this is not blocking.
  A one-line widening (`stripped.endswith("..") and ":" in stripped`) would close it if touched.
- `scripts/concertino/next-report-number.sh` does not exist in this worktree (it has only
  `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`, `start-servers.sh`, `lib/`, `README.md`);
  I ran the copy from the main checkout. Environmental, not a defect in this change.
- Compile has 250 resolved coordinates and test 280, yet test-only is 33, not 30. That is correct,
  not an arithmetic slip: three compile coordinates (including `commons-lang3 3.12.0`) are evicted
  at test scope by higher versions test deps pull in. It is also why compile and test both total
  70 advisories while test-only shows 1. Worth a sentence in `osv-baseline.md` so a later reader
  does not re-litigate it.

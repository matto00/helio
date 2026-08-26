## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold review. Every number below was derived from trees I generated myself in this worktree,
not from the committed baseline or from round 1's report.

### What I verified (with evidence)

**Re-derived the trees from scratch.**
```
cd backend && sbt -batch "Compile/dependencyTree" > /tmp/sk2-compile.txt   # exit 0, 8156 lines
              sbt -batch "Test/dependencyTree"    > /tmp/sk2-test.txt      # exit 0, 8456 lines
```

**CR1 (eviction filter) — the code change is present and the line-splitting worry is
unfounded, but the filter is still broken (see Verdict).**
`osv-scan.py:41` now defines `EVICTED = "(evicted by:"` and `coords()` skips those lines.
I checked the specific hazard I was asked about — whether a whole-line skip can drop a
genuinely-resolved coordinate that shares a line with an evicted one. It cannot:

```
/tmp/sk2-compile.txt evicted_lines 601 multi 0 resolved 265
/tmp/sk2-test.txt    evicted_lines 699 multi 0 resolved 295
```
`multi 0` = **zero** `(evicted by:` lines carry more than one coordinate match. sbt prints
one coordinate per row and an evicted node has no children. The whole-line skip is safe.

**CR2 (aircompressor) — FIXED and independently true.** `design.md` D5 now names only
`0.27` / GHSA-vx9q-rhv9-3jvg -> 2.0.3, and explicitly records that `0.21` is evicted. My
own corrected scan shows exactly one aircompressor row: `io.airlift:aircompressor 0.27
GHSA-vx9q-rhv9-3jvg fixed=2.0.3`. GHSA-973x-65j7-xcf4 is absent. Accurate.

**CR3 (scope separation) — FIXED mechanically.** `osv-scan.py` now takes `label=path` args
and emits `compile scope` / `test scope` / `test-ONLY` sections separately. See CR 3 below
for a factual problem with how the test-ONLY result is *characterised*.

**CR4 (fallbacks) — FIXED.** `tasks.md` 2.4a is an explicit D2/D5 fallback with "Do not
assume such a GCS release exists — verify it". `tasks.md` 3.1 targets **2.18.9**, with 3.1a
recording the tie-break. I verified the underlying fact from my own scan output:
`GHSA-5jmj-h7xm-6q6v fixed=2.18.9,2.21.5,2.22.1,3.1.4` — 2.18.8 would indeed leave it open.
The target is correct.

**Deferred set (D5) still honest after the corrections — CONFIRMED against my scan.**
My compile-scope rows contain exactly one CRITICAL (`zookeeper 3.6.3
GHSA-7286-pgfv-vxvh`), the single aircompressor advisory, and `lz4-java`
GHSA-cmp6-m4wj-q63q with no fixed version. Round 1's code-level ZooKeeper reachability
check is unaffected by anything in this round. D5 is not overstated.

**Reproduction discipline.** The defect below is deterministic text, and I converged on the
same advisory totals by **two independent routes** (a widened `asciiGraphWidth` re-dump, and
a corrected substring filter over the original narrow dump). Both give 70/23. This is not a
flaky reading.

---

### Verdict: REFUTE

**There is a third scanner defect, exactly as suspected — and it is the same class as the
first two: sbt's own output is lying to the tool.**

`sbt dependencyTree` **truncates each row to the terminal width** (~87 chars here), ending
it with `..`. That silently destroys the `(evicted by: ...)` marker on deep rows, so the
`EVICTED = "(evicted by:"` substring test does not fire and the evicted coordinate is
counted as **resolved**:

```
$ grep -c "evicted"       /tmp/sk2-compile.txt   -> 663
$ grep -c "(evicted by:"  /tmp/sk2-compile.txt   -> 601      # 62 rows the filter MISSES
```
Sample rows (real bytes in the file, verified with `cat -A`):
```
[info]   | | | | | +-com.google.errorprone:error_prone_annotations:2.28.0 (evicted by..
[info]   | | | | |   | +-com.google.errorprone:error_prone_annotations:2.28.0 (evicte..
[info]   | | | | +-com.fasterxml.jackson.datatype:jackson-datatype-jsr310:2.15.1 (evi..
```
Loosening the filter to `"(evicted"` is **also insufficient** — the last row above truncates
to `(evi..`, and re-dumping with a wide graph shows **692** evicted rows, i.e. 29 more that
are truncated before the word `evicted` appears at all.

Truncation causes a second, distinct corruption: the *version string* itself gets cut, so
one artifact fabricates many nonexistent coordinates that are then queried against OSV and
return a guaranteed-clean no-hit:
```
$ grep -o "listenablefuture:[^ ]*" /tmp/sk2-compile.txt | sort -u
listenablefuture:9999.0-empty-to-avoid-..
listenablefuture:9999.0-empty-to-avoid-co..
... (9 fabricated versions; the real one never appears untruncated)
```

**The fix, verified working.** Re-dumping with the graph width raised removes all of it:
```
$ sbt -batch 'set ThisBuild/asciiGraphWidth := 400' "Compile/dependencyTree" > /tmp/sk2-compile-wide.txt
$ grep -c "evicted" ...  -> 692     $ grep -c "(evicted by:" ...  -> 692     # now equal
$ grep -o "listenablefuture:[^ ]*" ... | sort -u
listenablefuture:9999.0-empty-to-avoid-conflict-with-guava
```

**Corrected authoritative baseline** (`osv-scan.py` unmodified, run over the wide dumps):
```
### compile scope
resolved coordinates: 250   (excluded 692 evicted tree rows)
TOTALS: 70 advisories across 23 vulnerable artifacts
  CRITICAL: 1   HIGH: 30   MODERATE: 34   LOW: 5
### test-ONLY (does NOT ship in the production image)
resolved coordinates: 33   TOTALS: 1 advisories across 1 vulnerable artifacts   (MODERATE: 1)
```
vs. the committed `osv-baseline-raw.txt`: **265 / 71 / 24, 35 MODERATE**. Row-level diff of
the two compile-scope advisory tables shows exactly one difference — a phantom:
```
< MODERATE  io.netty:netty-transport-native-epoll 4.1.63.Final GHSA-w573-9ffj-6ff9 ...
```
`4.1.63.Final` is evicted by `4.1.96.Final`; it survived only because its eviction marker was
truncated. The resolved `4.1.96.Final` instance carries the same advisory and is already
counted, so this is a duplicate as well as a phantom.

This is blocking for the same reason CR1 was: `tasks.md` 1.3 makes the coordinate/advisory
counts the executor's **degraded-scan tripwire**, and `design.md` D4 makes the count the
**acceptance oracle**. Both are calibrated 15 coordinates and 1 advisory off, against an
input format that silently corrupts itself as the tree gets deeper — which it will, once
`dependencyOverrides` grows.

---

### Change Requests

1. **Eliminate the truncation at the source, and make the tool refuse truncated input.**
   - Change tasks 1.1 and 5.1 to dump both trees with the graph width raised, e.g.
     `sbt -batch 'set ThisBuild/asciiGraphWidth := 400' "Compile/dependencyTree" > ...`
     (verified above to produce zero truncated dependency rows).
   - Add a **hard guard** in `osv-scan.py`: if any line matching a coordinate ends in `..`,
     abort with a diagnostic rather than scanning. A substring filter for `(evicted` is not a
     fix — 29 rows truncate before the word `evicted` even begins. This is the third
     silently-wrong-input defect in this tool; the guard is what stops a fourth.
   - Same class of guard is warranted for the fabricated-version symptom
     (`listenablefuture:9999.0-empty-to-avoid-co..`), which the `..` check also catches.

2. **Re-baseline and update every quoted figure to the corrected numbers.** Regenerate
   `osv-baseline.md` / `osv-baseline-raw.txt`, then correct:
   - `proposal.md` "71 advisories across 24 artifacts at compile scope (1 CRITICAL, 30 HIGH,
     35 MODERATE, 5 LOW)" -> **70 / 23 (1 CRITICAL, 30 HIGH, 34 MODERATE, 5 LOW)**.
   - `design.md` Context "265 resolved compile-scope coordinates carrying 71 advisories / 24
     artifacts" -> **250 / 70 / 23**; and D4's "expect ~265 compile / ~295 test" tripwire ->
     **~250 compile / ~280 test**; and the "71/24 compile-scope baseline" in D4.
   - `tasks.md` 1.3 "265 resolved coordinates, 71 advisories / 24 artifacts (… 35 MODERATE …)"
     -> the corrected figures.
   - Add the truncation defect to `design.md`'s "osv-scan.py has had two real defects" list
     (it is now three) so the next reader does not re-derive it.

3. **`ticket.md:11` still asserts the fully stale, twice-refuted figures as fact.**
   > "An OSV.dev scan of all **349 resolved backend Maven coordinates** … finds **39
   > vulnerable artifacts carrying 106 advisories: 2 CRITICAL, 45 HIGH, 50 MODERATE, 9 LOW**."

   Every number there is wrong, including the headline "2 CRITICAL" (there is one). Round 1's
   CR1 enumerated proposal/design/tasks and the executor updated exactly those three; the
   ticket body was missed. This is the *most* load-bearing copy of the number — it is the
   restated-scope record that feeds the PR body and the Linear ticket, which is precisely the
   false-security-documentation failure mode CR1 was raised to prevent. Correct it to the
   corrected compile-scope figures, and label it compile-scope (it currently describes a
   merged Compile+Test set as "resolved backend Maven coordinates").

4. **The "test-only adds 1 MODERATE" claim is not a test-only exposure.** `proposal.md` says
   "plus 1 further moderate that is test-only" and `osv-baseline.md`'s totals table reports it
   as additional. It is not additional — it is the *same advisory* at a different version:
   ```
   compile:   MODERATE org.apache.commons:commons-lang3 3.12.0 GHSA-j288-q9x7-2f5v fixed=3.18.0
   test-ONLY: MODERATE org.apache.commons:commons-lang3 3.14.0 GHSA-j288-q9x7-2f5v fixed=3.18.0
   ```
   (This is also why compile and test scope both total 70 despite test-ONLY reporting 1 — an
   arithmetic inconsistency a reader will otherwise trip over.) State it as "test scope
   resolves the same already-counted advisory at a different version; test adds **no** new
   advisory", and note in `tasks.md` 4.3 that the commons-lang3 override target is the
   **compile-scope** `3.12.0 -> 3.18.0`, since 3.12.0 is the version that actually ships.

5. **D2 is not stated precisely enough to be applied without guessing.** D2 says "the LOWEST
   version that clears **the advisory** … the minimum fixed version stated by OSV", but every
   artifact that matters here carries *several* advisories with *different* minimum fixes, and
   OSV states fixes across *several major lines*. `tasks.md` 4.1 restates it as "the LOWEST
   fixed version **per advisory**", which read literally is wrong. Worked example from my scan
   — `netty-codec-http` at 4.1.96.Final has fixes at `4.1.132`, `4.1.133` (x2) and `4.1.136`
   (x3); "lowest per advisory" yields 4.1.132 and leaves three HIGHs open, which task 5.2 would
   then force into a bogus deferral write-up. Restate D2 (and mirror it in 4.1) as:
   > For each artifact, take the **maximum, over all its advisories, of the lowest fix that lies
   > within the major line permitted by D3** — i.e. the smallest single version that clears
   > *every* advisory on that artifact without crossing a major boundary. For a family pinned to
   > one version (D3/4.2, netty), take the maximum of that value across the whole family.

   3.1a already applies exactly this rule to Jackson ("lowest version clearing EVERY advisory
   in the set") — D2 and 4.1 just need to say the same thing.

---

### Non-blocking notes

- `proposal.md`'s What Changes asserts overrides for "netty, snappy-java, commons-io,
  commons-lang3, commons-compress, protobuf-java, ivy, log4j, guava". My corrected compile
  scope shows **zero** advisories for snappy-java, commons-io, commons-compress and guava.
  `tasks.md` 4.3 hedges correctly ("as the scan requires"); the proposal reads as a commitment
  and could lead the executor to add four permanent pins that clear nothing. Trim the list to
  what the scan actually attributes (netty family, protobuf-java, commons-lang3, ivy, log4j).
- Task 3.1 says to move the Jackson pin "all four artifacts together, one consistent version".
  Note that `jackson-datatype-jsr310` resolves to **2.15.2**, not 2.15.4 — i.e. it is currently
  *outside* the existing pin. Worth confirming the override block actually covers every Jackson
  artifact on the classpath, not just the four already listed.
- Round 1's non-blocking suggestion to have the scanner print the evicted-vs-resolved split was
  taken (`excluded N evicted tree rows`) — and it is what made this round's defect visible at a
  glance (601 vs. `grep -c evicted` 663). Good change; keep it.
- The worktree's `scripts/concertino/` is a partial copy without `next-report-number.sh` /
  `persist-evidence.sh`; I used the ones in the main checkout. Not a defect in this change.

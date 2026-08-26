## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold review at `a0b12432`. Round 1 already cleared the remediation itself; per the gate brief I
did not re-litigate it, but every number below was derived by me, from the live build, not read
out of another agent's report.

### What I verified (with evidence)

**0. Scope of this cycle is what it claims to be**
- `git diff --name-only 48e86085..HEAD` → only `design.md`, `evaluation-2.md`, `files-modified.md`,
  `osv-scan.py`, `skeptic-final-1.md`. **`backend/build.sbt` has zero diff this cycle** — confirmed
  independently, so the dependency closure and the sbt gate carry over.
- npm side untouched across the WHOLE branch: `git diff --name-only main...HEAD | grep -Ei
  'package|npm|frontend|helio-mcp'` → `NONE`. AC "no npm change expected" holds literally.

**1. CR1 — count correction is real and internally consistent**
Every place a count appears now agrees, and agrees with my own scan:
- `files-modified.md`: "Clears 65 of 70 … (70->5)" — 70−5 = 65 ✓; explicitly names the raw
  70->3 undercount and its cause, so the raw number is no longer published unqualified.
- `osv-after.md` totals row: **70 -> 5 / 23 -> 3** ✓.
- Severity split after: CRITICAL 1, HIGH 2, MODERATE 2, LOW 0 = **5** ✓.
- Table title "Remaining advisories (5)" with exactly **5 rows** spanning exactly **3 artifacts** ✓.
- Netty artifact count corrected 11 → 12 in `files-modified.md`; I counted the `dependencyOverrides`
  block in `backend/build.sbt`: **12** `io.netty` entries ✓.
- The prose-vs-headline disagreement that recurred twice is gone: I found no surviving "67", "70->3"
  or "3 advisories" presented as the delivered result anywhere outside an explicitly-labelled
  "raw scanner output" caveat.

**2. Independent scan — I did not use `osv-scan.py` at all**
To sidestep both of the tool's known blind spots I scanned the *resolved compile classpath jars*
directly:
`sbt -batch "export Compile/dependencyClasspath"` → 255 jars → 251 Maven coordinates parsed from the
coursier paths → OSV `querybatch`. Result:

```
at.yawk.lz4:lz4-java 1.8.1        ['GHSA-cmp6-m4wj-q63q', 'GHSA-xx22-p4ch-683r']
io.airlift:aircompressor 0.27     ['GHSA-vx9q-rhv9-3jvg']
org.apache.zookeeper:zookeeper 3.6.3 ['GHSA-7286-pgfv-vxvh', 'GHSA-r978-9m6m-6gm6']
TOTAL advisories 5
```

5 advisories / 3 artifacts — **exactly** the corrected published figure, and exactly the five rows in
the `osv-after.md` table, ID for ID. Severities pulled from OSV individually: CRITICAL / MODERATE /
HIGH / HIGH / MODERATE → matches the published split precisely. This is the classpath, so the
relocated `at.yawk.lz4` node is visible to me and confirms the hand-correction was right, not
generous. (The 251-vs-249 coordinate delta against the tree-derived count is the relocation/dump
gap already documented; every one of those coordinates is OSV-clean, so no delivered number moves.)

**3. All pins actually resolve at their pinned versions**
Checked all 30 bumped/pinned artifacts against the same classpath: 6 Jackson @ 2.18.9, 12 netty @
4.1.137.Final, grpc-netty-shaded 1.75.0, protobuf-java 3.25.5, ivy 2.5.2, commons-lang3 3.18.0,
3× log4j @ 2.25.5, lz4-java 1.8.1, logback-classic 1.5.38, postgresql 42.7.13, spark-core/sql 3.5.9
— **all OK, no mismatches, no dead pins**.

**4. CR2 — defect #5 documentation is honest**
- `osv-scan.py` header, item 5: titled "**KNOWN LIMITATION, NOT GUARDED**", states the row "IS
  present, verbatim, in the tree dump … silently skipped rather than counted or flagged",
  distinguishes itself from defect #4, and tells the future reader what to do instead (hand
  cross-check the classpath). A reader cannot come away thinking a clean scan is self-sufficient.
- `design.md` Context: "FOUR" → "FIVE" updated in the lead sentence *and* the fourth/fifth are jointly
  described as "real, currently unguarded gaps". No stale "four" left in that section.
- The quoted regex is verbatim correct — `osv-scan.py:82` is literally
  `r':([0-9][a-zA-Z0-9_.+-]*)'`. The claim is checkable and checks out.
- Both named artifacts really are OSV-clean, queried by me directly:
  `com.google.apis:google-api-services-storage:v1-rev20240621-2.0.0` → `[]`,
  `com.google.apis:google-api-services-sqladmin:v1beta4-rev20240925-2.0.0` → `[]`.
  So "changed no delivered HEL-452 number" is true, not an excuse.
- `python3 -m py_compile osv-scan.py` → OK (the header edit didn't break the tool).

**5. No new false claim introduced in shipped code comments**
Spot-checked the load-bearing, falsifiable claims in `backend/build.sbt` against OSV:
- "GHSA-5jmj-h7xm-6q6v is fixed only at 2.18.9" → OSV `affected` for
  `com.fasterxml.jackson.core:jackson-databind` includes a range fixed at exactly `2.18.9` ✓.
- "4.1.137.Final is required by GHSA-8c42-7qj2-3j46 on netty-codec-http" → OSV fixed events are
  `4.1.137.Final` (1.x line) and `4.2.17.Final` ✓.
- The lz4 comment correctly says the other two advisories have no published fix and are deferred
  (my query confirms both still match at 1.8.1) — no over-claim.
- The GCS comment (fixed in 48e86085) correctly describes the D2.4a override fallback.

**6. AC trace**
| AC | Evidence |
|---|---|
| build.sbt remediates every safe path | 30 pins verified resolving; only unfixable/major-bump items remain |
| before/after recorded | 70 -> 5 / 23 -> 3, reproduced independently by me |
| every remaining advisory justified | 5 rows = my 5 findings, ID-for-ID, each with justification |
| `sbt compile`/`sbt test` pass | evaluation-2 pastes `Tests: succeeded 3391, failed 0`; build inputs unchanged since, and my own sbt invocation resolved/loaded cleanly |
| npm recorded clean, no npm change | zero npm-tree files in `main...HEAD` |
| PR description lists remediations | not yet applicable (no PR at this gate); the `package: from -> to (GHSA)` mapping exists in build.sbt comments + files-modified.md to compose it from |

No UI changes exist on this branch, so §4 (visual/design judgment) does not apply — verified by the
diff stat: only `backend/build.sbt` and change-dir docs.

### Verdict: CONFIRM

Both round-1 change requests are genuinely fixed in the committed files, not merely asserted, and the
corrected numbers survived a scan I ran myself by a *different* method than the one that produced
them. Nothing regressed. This ships.

### Non-blocking notes
- The last AC ("PR description lists every remediation as `package: from -> to (GHSA/CVE id)`") is the
  one thing not yet satisfiable at this gate. Delivery should compose the PR body from the build.sbt
  comment block, which already carries the full mapping.
- `osv-after.md` refers to the lz4 relocation gap as "a fourth defect" in its Cycle-2 correction
  paragraph. That numbering is still correct (relocation *is* #4), but a reader arriving from
  `design.md`'s new five-item list may briefly wonder. Purely cosmetic; no number is wrong.
- Two coordinates present on the resolved classpath do not appear in the tree-derived count (251 vs
  249). Both are clean, so nothing is hidden today — but it is the same class of gap as defects #4/#5
  and is worth folding into the sibling CI-gate ticket's scoping.

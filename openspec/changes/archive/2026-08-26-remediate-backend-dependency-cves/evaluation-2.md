# Evaluation Report — Cycle 2 (evaluation-2.md)

Commit reviewed: `48e86085` (on top of `62d9caa6`, reviewed in `evaluation-1.md`).
Scope of this cycle: verification of the three cycle-1 change requests. Everything below that I call verified,
I ran myself; where I carry a cycle-1 result forward I say so explicitly and give the reason.

## The diff really is comment-and-docs only — verified mechanically

Files changed `62d9caa6..48e86085`: `backend/build.sbt`, `design.md`, `osv-after.md`, `osv-scan.py`,
`evaluation-1.md`. Nothing else.

I did not take "only a comment moved" on trust. Stripping comments and blank lines from both revisions of
`backend/build.sbt` and diffing:

```
diff <(git show 62d9caa6:backend/build.sbt | sed 's://.*::' | grep -v '^[[:space:]]*$') \
     <(git show 48e86085:backend/build.sbt | sed 's://.*::' | grep -v '^[[:space:]]*$')
  -> NO NON-COMMENT CHANGE ANYWHERE IN build.sbt
```

And extracting every `"group" %(%) "artifact" % "version"` coordinate from each revision: 56 coordinates on
both sides, **byte-identical**. So no dependency version changed this cycle, the resolved closure is
unchanged, and cycle-1's dependency-level verification (D2 minimality, D3 major-line compliance, no dead
pins) transfers intact. I re-confirmed the closure is unchanged anyway by re-dumping the trees — see below.

Across the **whole branch** (`main...48e86085`), no `package.json`, no lockfile, no `frontend/**` file is
touched. The npm side is genuinely untouched, as the ticket requires.

## CR1 — corrected after-state — RESOLVED

Re-derived from scratch rather than checked against the document.

Fresh untruncated dumps (`sbt -batch 'set ThisBuild/asciiGraphWidth := 400' Compile/dependencyTree`, same for
Test), eviction invariant re-checked on both:

- compile: `grep -c evicted` = 691 == `grep -c '(evicted by:'` = 691
- test: 758 == 758

Re-running the change's own `osv-scan.py` on those fresh dumps reproduces the **raw** figure exactly:
compile scope 249 resolved coordinates, 691 evicted rows excluded, **3 advisories / 2 artifacts**
(CRITICAL 1, HIGH 1, MODERATE 1). And the blind spot is still exactly as diagnosed: `grep -ci lz4` on the
compile dump returns **0** nodes, while the classpath carries
`.../at/yawk/lz4/lz4-java/1.8.1/lz4-java-1.8.1.jar`.

Independently re-confirmed both lz4 advisories still match at 1.8.1, under both coordinates:

```
at.yawk.lz4:lz4-java 1.8.1 -> [('GHSA-cmp6-m4wj-q63q','HIGH'), ('GHSA-xx22-p4ch-683r','MODERATE')]
org.lz4:lz4-java     1.8.1 -> [('GHSA-cmp6-m4wj-q63q','HIGH'), ('GHSA-xx22-p4ch-683r','MODERATE')]
```

So raw 3 + the 2 invisible = **5 advisories across 3 artifacts** (zookeeper, aircompressor, lz4-java), with
severity CRITICAL 1 / HIGH 2 / MODERATE 2 / LOW 0. That is exactly what the corrected `osv-after.md` now
claims.

Cycle 1's defect was that the headline numbers and the prose disagreed, so I checked the four places that
must agree, mechanically rather than by reading:

| location | value |
|---|---|
| Totals table, compile row | `70 -> 5` advisories, `23 -> 3` artifacts |
| Severity split after-column | CRITICAL 1 + HIGH 2 + MODERATE 2 + LOW 0 = **sums to 5** |
| Remaining-advisories table title | "Remaining advisories (**5**)" |
| Actual data rows in that table | **5** rows: zookeeper CRITICAL, aircompressor HIGH, lz4 HIGH, zookeeper MODERATE, lz4 MODERATE |

All four agree, and agree with my scan. The document also now states the raw-vs-corrected split up front
("the raw tool output is 70 -> 3 / 23 -> 2; the true after-state … is **70 -> 5 / 23 -> 3**"), which is the
honest framing that was missing: a reader can no longer come away with a better number than what ships. Both
lz4 rows are flagged **"Not detected by `osv-scan.py`"** with the direct-OSV-query provenance, and each
carries the D5 "no fixed version exists anywhere" justification. The claim that no new D5 member was added is
correct — `design.md` D5 already named the lz4 pair, and D5 itself is unchanged.

## CR2 — scanner blind spot documented — RESOLVED

Documented in both required places, and worded to exactly the standard I asked for.

`design.md` Context now reads "`osv-scan.py` has had **FOUR** real defects", separates the first three
(guarded in the tool) from the fourth, and labels it "**NOT guarded — a real gap.**" `osv-scan.py`'s header
comment carries the matching item, including the load-bearing sentence:

> A clean-looking result from this tool is therefore NOT sufficient proof that nothing at that coordinate is
> vulnerable

and closes with "Unlike defects 1-3 above, this one is NOT guarded in the tool itself -- it is a real gap,
documented here deliberately so it isn't mistaken for a solved problem." Both writeups tell a future reader
how to detect it (`sbt 'show Compile/dependencyClasspath'` cross-check) and both cite the concrete HEL-452
instance. This meets the "minimum acceptable" bar CR2 defined. The preferred in-tool classpath cross-check
was not implemented, which is fine — CR2 offered that as the optional stronger option, and the gap is now
clearly labelled as unguarded rather than quietly presented as solved.

## CR3 — false comment corrected — RESOLVED

`backend/build.sbt` now reads "HEL-452: deliberately left at 2.40.1 -- no GCS release in a safe range was
established to pull grpc-netty-shaded >= 1.75.0, so those advisories (and protobuf-java's) are cleared by the
dependencyOverrides pins below instead (design D2.4a fallback)." Every clause is true of the code beneath it:
the dependency is still `2.40.1`, and the `grpc-netty-shaded` 1.75.0 / `protobuf-java` 3.25.5 overrides do
exist further down the same block (both verified clean at those versions in cycle 1). The false "bumped
from 2.40.1" claim is gone.

## Non-blocking suggestion from cycle 1

The netty count was corrected: `osv-after.md` now says "The netty family (12 artifacts, including
`netty-buffer` and `netty-resolver`)", matching the 12 pins actually in `build.sbt`. (The orchestrator's relay
said the file "already said 12" — it did not; the executor fixed it in this commit. Either way it is right
now.) `files-modified.md` still says 11 in its prose summary; that is cosmetic, changes no result, and I am
not blocking on it.

## Gates

Re-run by me **this cycle**, against `48e86085`:

| gate | result |
|---|---|
| `sbt test` (backend) | **PASS** — `Suites: completed 215, aborted 0`; `Tests: succeeded 3391, failed 0, canceled 0, ignored 0, pending 0`; `All tests passed.`; `[success] Total time: 183 s` |
| `Compile/dependencyTree` + `Test/dependencyTree` + `show Compile/dependencyClasspath` | PASS — all resolved cleanly; eviction invariant holds on both dumps |
| `osv-scan.py` on fresh dumps | PASS — reproduces 249 coords / 3 raw advisories |

**Carried over from my own cycle-1 runs, not re-run this cycle:** `npm run lint` (exit 0),
`npm run format:check` (exit 0), `npm test` root+frontend (257 suites / 2833 tests passed),
`npm --prefix frontend run build` (exit 0). I am carrying these rather than asserting a fresh run because I
proved above that this cycle touches no npm manifest, no lockfile, and no file under `frontend/**` — the
inputs to those four gates are byte-identical to the tree I ran them against in cycle 1. The executor
separately claims it re-ran them; I did not verify that claim and it is not load-bearing here.

## Phase 1: Spec Review — PASS

The AC that failed in cycle 1 — "Every remaining (un-remediated) advisory is listed with a written
justification for why it was not fixed — no silent omissions" — is now satisfied: all five remaining
advisories are listed, each with a justification, and the two that the tool cannot see are explicitly marked
as such with their provenance. The measured-reduction AC is satisfied with before/after numbers that match an
independent scan plus a disclosed manual correction. Remaining ACs were verified in cycle 1 and their inputs
are unchanged. No scope creep this cycle.

## Phase 2: Code Review — PASS

Comment-and-docs only, mechanically proven. The one source-file change (`build.sbt` comment) is now factually
true of the code it sits above. Cycle-1 code findings — every D2 pin exactly minimal, D3 respected, no dead
pins, no dead code or TODOs, every override commented with the advisory it retires — carry forward on a
byte-identical dependency set.

## Phase 3: UI Review — N/A

No UI-affecting file changed, this cycle or across the branch. No `frontend/**`, no `ApiRoutes.scala`, no
`schemas/**`, no `openspec/specs/**` (only this change's own `openspec/changes/` artifacts). Dev servers not
started.

## Overall: PASS

All three cycle-1 change requests are genuinely resolved, and the corrected evidence artifact now survives the
check that broke it last cycle: its headline number, severity split, table title, and table contents all agree
with each other and with a scan I ran myself. The remediation is unchanged and remains correct — 70 → 5
shipped advisories, the five remaining being the pre-approved D5 set (CRITICAL zookeeper on a
reachability argument I verified in source, HIGH aircompressor behind a Spark major bump, and the two
lz4-java advisories for which no fix exists anywhere).

Worth recording for whoever picks up the sibling CI-gate ticket: `osv-scan.py` ships with a known, deliberately
unguarded false-clean mode. It is correctly documented here, but it must be closed before this tool becomes a
gate, since a gate that can silently pass on a relocated coordinate is worse than no gate.

## Change Requests

None.

## Non-blocking Suggestions

- `files-modified.md` still describes the netty override as covering 11 artifacts; `build.sbt` and
  `osv-after.md` both correctly say 12. Cosmetic only.
- When the CI CVE gate ticket (epic HEL-434) is picked up, implement the classpath-vs-tree cross-check that
  CR2 offered as the preferred fix, so the relocated-coordinate gap is closed in code rather than in prose.

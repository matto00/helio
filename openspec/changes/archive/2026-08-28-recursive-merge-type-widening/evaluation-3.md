# Evaluation Report — Cycle 3 (evaluation-3.md)

Commit under review: `8db1a47a` on `bug/recursive-merge-type-widening/HEL-858`
(cycle 2 `fce18e1b`, cycle 1 `50f3140b`, base `7972247c`). Every number below is from my own run
or my own independent recomputation. I did not take the executor's counts, and I did not take the
orchestrator's arithmetic.

Tooling note unchanged: `next-report-number.sh` / `persist-evidence.sh` / `emit-event.sh` do not
exist at this repo revision, so numbering, durable-copy and verdict-event emission could not run.
Filename per the orchestrator's explicit instruction. Not a BLOCKER.

---

### Question 1 — the 73/8 vs 72/8 "discrepancy": CONFIRMED, not a finding

I re-ran the revert myself rather than reconciling on paper. Reverting both source files to the
base commit and running the targeted suite gives:

```
[info] Total number of tests run: 81
[info] Tests: succeeded 73, failed 8, canceled 0, ignored 0, pending 0
[info] *** 8 TESTS FAILED ***
```

That is exactly the regenerated transcript's headline, and it reconciles with my cycle-2
measurement of 72/8-of-80. The reconciliation holds, with one refinement to the orchestrator's
phrasing that is worth stating precisely rather than waving through:

- Suite size 80 → 81: the 3.10 split replaced one test with two.
- Passing 72 → 73: the added test, **3.10a**, passes on revert. Correct — it is the `[CHAR]` half.
- Failing stays at **8**, but the failing *set* is not literally "identical". The 8th failure is
  now **3.10b** ("pin the WR-only fixture's full field-by-field schema") where it was previously
  the old combined 3.10 test. Same artifact, narrowed and renamed — the count is unchanged
  because the split moved the red-causing assertions into 3.10b and left the green-both-ways
  assertions in 3.10a. The other seven are the original `[RED]` set, unchanged and identical by
  name in my run: 3.1, 3.2, 3.3, 3.6, 3.8b, 3.9 (all `SchemaInferenceEngineSpec`) and 3.4
  (`SparkJobSubmitterSpec`).

So: confirmed, and the arithmetic is not merely consistent — it is the measured outcome.

I also spot-checked the transcript's individual failure messages against what the code must
produce. The new 3.1 failure is reported as
`Map("id" -> IntegerType, "stats.a" -> IntegerType)` vs the pinned four-entry map. That is exactly
right for pre-fix: `mergeObjects` takes `id` and the whole `stats` subtree from element 0
(`{"a": 3}`) wholesale, so the pre-fix schema has precisely two fields and `stats.a` is integral.
Not a plausible-looking invention — it is the only value the deleted code could produce.

### Question 2 — revert completeness: CONFIRMED complete

Two independent checks:

1. **Scope.** `git diff --name-only 7972247c..HEAD` filtered to non-test, non-openspec paths
   returns exactly two files: `JsonFlattener.scala` and `SchemaInferenceEngine.scala`. There is no
   third production file, no resource consumed at runtime, no build change. So restoring those two
   is by construction a total behavioural revert of this change — the orchestrator's reading is
   correct.
2. **Execution.** The transcript states the revert used
   `git checkout 7972247c -- <both files>`, naming both. I reproduced it that way and verified
   mid-revert that `git diff 7972247c --stat -- backend/src/main` was **empty** — i.e. both files
   were genuinely at their pre-fix state simultaneously, not just `SchemaInferenceEngine.scala`.
   Restoring afterwards left `git status --porcelain` clean.

Worth noting why this matters less than it might: `JsonFlattener.scala`'s entire diff is nine
scaladoc lines with zero changes to the `object JsonFlattener` body (verified in cycle 1 and
re-verified here), so reverting it cannot move behaviour either way. Including it is correct
belt-and-braces, and the transcript's own claim to have done so is true. A revert restoring less
than the whole change would produce a weaker red than it appears to — that risk does not
materialise here.

### Question 3 — sweep of cycle-3 changes for the CR2 pattern

**Does the 3.10a / 3.10b classification hold? Yes — measured, both directions.**

- **3.10b `[RED]`** — failed on revert in my run (present in the 8), passes at HEAD.
- **3.10a `[CHAR]`** — absent from the failing list on revert *and* passing at HEAD, so it is
  genuinely green both ways. It is a real characterisation test, not a relabelled red one. This is
  the split doing what design D6 asks: one outcome per artifact.

I went further and checked whether 3.10b's pin is *correct*, not merely self-consistent. I
re-derived all 63 `(name, type, nullable)` triples from the fixture using my own independent
reimplementation of `inferJsonType` (including the `scale <= 0 || remainder(1) == 0` integer rule),
`JsonFlattener`'s dotted-leaf traversal and the D3 join, then parsed the 63 pinned triples out of
the test source and compared:

```
mine 63  pinned 63
IDENTICAL
pinned already sorted? True
```

Every triple matches, and the pinned `Seq` is already in the sorted order the test compares
against. So the "no other field changes name, type, or nullability" claim is now both true and
self-enforcing — exactly what CR1's preferred form asked for, and it independently re-confirms
`wr-fixture-characterisation.md`'s four-diff table for a second time.

**Does the rewritten symmetry comment state something the file can back up? Yes — the false claim
is gone and the replacement is correct.** `NestedJsonFlatteningSymmetrySpec.scala:12-23` now says
the whole-array assertion *under this exact equality relation* failed pre-HEL-858 **and still
fails deliberately post-HEL-858**, gives the reason (union semantics mean the schema legitimately
carries fields no single row has), cites design D6 by name, states the per-row scope is unchanged,
and redirects to `assertAgreement` (3.8a/3.8b) for the subset+union+no-duplicates property that
does hold whole-array. That matches D6 verbatim and matches the tests that actually exist — I
confirmed in cycle 1 that `assertAgreement` asserts all three clauses on the un-folded `Seq`. The
invariance claim the file could not back up has been replaced by a scope explanation that is true
and that points at where the real assertion lives.

**Non-blocking precision nit on that same comment.** "It still fails, deliberately, against the
post-HEL-858 implementation" is true of the implementation in general (heterogeneous input), but
not of *this file's own fixture*: `hel599/sleeper-wr-projections-slice.json` is single-shape, all
three rows carry the same 63 paths, so a whole-array equality assertion would in fact pass here.
The QB/`stats.rec` example given is from the `hel858` fixture, in a different spec. The statement
is correct about the implementation and the direction of error is conservative (it argues for
keeping a narrower scope), so this is precision, not falsehood. One clause — "on heterogeneous
input; this file's own fixture is single-shape, so the per-row scope is defensive here" — would
close it.

**Both cycle-2 non-blocking suggestions were taken, and taken correctly.**

- 3.1 now pins `Map("id" -> IntegerType, "stats.a" -> FloatType, "stats.b" -> FloatType,
  "stats.c" -> StringType)` *before* the relative comparisons, so the ticket's central test can no
  longer be satisfied by a degenerate implementation returning the same empty schema for every
  input. The pinned values are the right ones — `stats.a` widens across rows 0/1 (`3`, `2.5`) and
  `stats.b` across rows 1/2 (`1`, `4.4`) — and the inline comments say exactly that.
- 3.10's "no other field changes" is now enforced by the 63-field pin rather than attested.

**Nothing else in the cycle-3 diff matches the pattern.** The diff is one comment block, two test
methods, `tasks.md`'s reclassification, `files-modified.md`, the regenerated transcript, and my
cycle-2 report. I read every changed comment: `tasks.md`'s 3.10a/3.10b descriptions match the
tests that exist; `files-modified.md`'s cycle-3 entries describe what actually changed and why,
naming the finding that drove each; the transcript's abridgement label is accurate and its
`[CHAR]`/`[RED]` lists match my measured split. The transcript also does the thing D6 demands and
cycle 2 failed to do — it reports the `[CHAR]`-went-red event explicitly, in its own section,
rather than absorbing it.

---

### Phase 1: Spec Review — PASS

All cycle-1 and cycle-2 findings are resolved. AC1-AC4 remain covered as verified in cycles 1-2
(3.2, 3.1, 3.3+3.4, 3.9 respectively, all measured red on revert). AC5 is satisfied on the reading
established in cycle 2 — the nullability flip is an order-dependent wrong answer being replaced by
an order-independent right one, not a rule change — and that reasoning is now recorded in design
D2, in `evidence/wr-fixture-characterisation.md`, and pinned in code by 3.10b.

Planning artifacts now match the implementation: `tasks.md`'s 3.10 classification describes the
tests that exist, and the transcript describes the suite that exists. Task 4.4 (spec sync via
archive) remains correctly unchecked as a delivery-phase action. Scope is unchanged and tight — no
production file has been touched since cycle 1.

### Phase 2: Code Review — PASS

Gates, all re-run by me at `8db1a47a`:

| Gate | Result |
|---|---|
| `sbt "testOnly *SchemaInferenceEngineSpec *JsonFlattenerSpec *NestedJsonFlatteningSymmetrySpec *SparkJobSubmitterSpec"` | **81 succeeded, 0 failed** |
| `sbt test` (full backend suite) | **238 suites, 3664 succeeded, 0 failed, 0 aborted** |
| Revert re-run (both source files at base) | **73 succeeded, 8 failed of 81** — matches the committed transcript exactly |
| `npm run check:scala-quality` | clean (140 soft warnings) |
| `npm run format:check` | clean |
| `npm run check:openspec` | `openspec/ is clean` |
| `npm run check:spec-structure` | passed, 341 canonical specs, 0 issues |

The executor's 81/81 and 3664/3664 are confirmed. No production code changed this cycle, so cycle
1's code-quality assessment stands: `inferFromObjects` is a single readable fold with a named
accumulator, `widenJson` is a total lattice with an accurate divergence comment, `mergeObjects`
and `flattenObject` are deleted rather than left dead, `JsonFlattener`'s traversal is untouched,
and no type-safety, security or error-handling surface is affected.

### Phase 3: UI Review — N/A

Backend-only, unchanged across all three cycles. No `frontend/**`, no `ApiRoutes.scala`, no
`schemas/**`, no `openspec/specs/**` outside the change dir.

---

### Overall: PASS

Both cycle-2 blocking findings are properly resolved, and — the part that matters on this
particular ticket — the resolution was verified by re-running the thing, not by editing the
numbers. I measured the revert independently and got the committed transcript's 73/8-of-81 exactly,
with 3.10a green and 3.10b red, which is the split `tasks.md` now claims. The 63-field pin
reproduces my own from-scratch recomputation triple-for-triple, so the change's central
characterisation claim is now self-enforcing rather than attested, and it has been independently
confirmed twice by different means.

This ticket's whole history was evidence-shaped non-evidence. What is committed now is the
opposite: a red that a complete revert genuinely produces, a fixture whose adequacy is asserted in
code rather than vouched for by checksum, a truncation test whose declared type comes from the
inference under test rather than from the test author's hand, and a behaviour change on an
existing source that is measured, classified, pinned, and written into the design instead of being
absorbed as "legitimate widening". The remaining items are all suggestions, none of them
load-bearing.

### Change Requests

None.

### Non-blocking Suggestions

- **3.10a could back its own claim.** Its comment says "63 fields, same names, same sorted order",
  but the test asserts `size shouldBe 63` plus three name memberships. Pinning the full sorted
  63-name `Seq` would make the `[CHAR]` half self-enforcing too, and it stays green both ways (I
  verified the name set is identical pre- and post-fix, with no additions or removals). Cheap, and
  it would make the pair symmetric: names pinned in 3.10a, names+types+nullability in 3.10b.
- **One clause on the symmetry comment**, per the precision nit above: whole-array equality fails
  on *heterogeneous* input; this file's own fixture is single-shape, so the per-row scope is
  defensive rather than forced here.
- **`SchemaInferenceEngineSpec.scala` is now 574 lines** against the 250-line soft budget (it was
  458 at cycle 1; the 63-field pin is most of the growth). The gate treats this as a soft warning
  and 140 other files already exceed it, so it is not a blocker — but if it is ever split, the
  natural seam is the HEL-858 `describe` block, which is self-contained.
- **File the D2 follow-up before archiving.** "A path absent from some sampled rows should infer
  as nullable" is still a paragraph in `design.md`, not a ticket. Cycle 2's Question-1 analysis is
  the reasoning for why it is the remaining real weakness in the nullability rule, and this change
  makes it more visible, not less: union-over-paths makes non-nullable-but-usually-null columns
  the common case on heterogeneous sources, and that flag reaches the assistant's column semantics
  via `WorkspaceContextService.scala:378`.
- **Carry task 4.3's note into the delivery report with its concrete instance.** `inferJsonType`
  types `2.0` as `IntegerType`; `stats.pts_half_ppr`'s pre-fix `259.0 → IntegerType` on the WR
  fixture is a live example, not a hypothetical. Naming it concretely stops it being mistaken for
  a miss of AC3.
- Task 4.4 (spec sync via archive) is still correctly unchecked — remember it at the archive step.

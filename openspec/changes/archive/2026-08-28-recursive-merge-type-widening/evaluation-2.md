# Evaluation Report — Cycle 2 (evaluation-2.md)

Commit under review: `fce18e1b` on `bug/recursive-merge-type-widening/HEL-858` (cycle-1 commit
`50f3140b`, base `7972247c`). Everything below is from my own fresh runs and my own independent
recomputation, not from the executor's report.

Tooling note unchanged from cycle 1: `next-report-number.sh` / `persist-evidence.sh` /
`emit-event.sh` do not exist at this repo revision, so numbering, durable-copy and verdict-event
emission could not be run. Filename per the orchestrator's explicit instruction. Not a BLOCKER.

---

### Cycle-1 change requests — all three verified addressed

**CR1 (record the task-3.10 finding) — DONE, and independently verified accurate.**
`evidence/wr-fixture-characterisation.md` is new and cross-referenced from `files-modified.md`.
I did not take its table on trust: I reimplemented BOTH algorithms independently (the pre-fix
top-level `mergeObjects` + `withNulls` + flatten, and the post-fix per-path union/widen, including
`inferJsonType`'s `scale <= 0 || remainder == 0` integer rule and the D3 lattice) and ran both over
`hel599/sleeper-wr-projections-slice.json`. Result:

- 63 fields pre-fix, 63 post-fix, **no additions and no removals** — matches the document.
- **Exactly four** differing fields, exactly the four claimed, in exactly the claimed directions:
  `player.injury_body_part` and `player.injury_status` `(String,false) → (String,true)`;
  `stats.pts_half_ppr` and `stats.rec_fd` `(Integer,false) → (Float,false)`.
- Nothing else differs in name, type or nullability — so the document's "No other field changes"
  claim is true, not merely asserted.

The `integer → float` pair is correctly classified as legitimate widening, and I confirmed the
mechanism from the raw fixture text: `pts_half_ppr` is `259.0`, `256.6`, `235.1` and `rec_fd` is
`140.0`, `134.5`, `134.3`. Pre-fix only element 0 was consulted, and `259.0` hits
`inferJsonType`'s `remainder(1) == 0` branch → `IntegerType`; post-fix the join with element 1's
`256.6` gives `FloatType`. This is also a live instance of the `2.0`-types-as-integer quirk that
task 4.3 flags as out of scope — worth knowing it is not hypothetical.

**CR2 (fix the false comment) — DONE.** `SchemaInferenceEngineSpec.scala:276-292`'s comment now
states the two flips explicitly, attributes them correctly, and points at the new evidence file.
The test was strengthened beyond what I asked: it now asserts both flipped fields' type and
`nullable = true` and both widened numerics' `FloatType`. That is the right direction — but it has
a consequence the executor did not follow through on. See Change Request 1 below.

**CR3 (correct design.md D2) — DONE.** D2 now separates "unchanged as a RULE" from "the rule's
observed OUTPUT changes", names the fixture and the two fields, states the type is unchanged,
states the direction is `false → true`, and explicitly says the flat "exactly" claim overstated
it. It holds itself to the same standard D7 already did. Accurate, and it does not overcorrect
into claiming a regression.

**Non-blocking suggestion also taken:** `red-verification.md`'s "Raw sbt output" heading is
relabelled as abridged, with the abridgement described. Good — though the section it labels is now
wrong for a different reason (Change Request 1).

---

### Question 1 — is the `nullable false → true` flip the D2 rule correctly reaching further, or a latent defect in D2 that was merely invisible?

**It is the rule correctly reaching further. Not a latent defect. AC5 is genuinely satisfied on
that reading.** The two hypotheses are separable, and here is what separates them.

The decisive question is whether the pre-fix behaviour was *the D2 rule applied to a smaller
domain*, or *a different rule that happened to coincide with D2 on the top level*. It is the
second — and that is what makes this a correction rather than a spread.

D2's rule is: `nullable = true` iff some sampled object carries `JsNull` **at that path**. What
the pre-fix code actually computed for a *nested* path was not a restriction of that rule. Read
the deleted code: the `withNulls` pass wrote `JsNull` only at top-level keys, and `player` is a
`JsObject` that is never itself `JsNull`, so that pass never contributed anything to any nested
path. Nested nullability came from a completely different place — `inferJsonType(value)` returning
`true` only for `JsNull`, applied to **whichever single object's subtree won `mergeObjects`'
first-non-null-wins race**. So the pre-fix nested rule was effectively "nullable iff *element 0's*
value at that path is null": a function of array ORDER, not of the sampled set. Reverse the WR
fixture's three elements pre-fix and `player.injury_body_part` flips to nullable. That is not D2
evaluated over a smaller domain; it is order-dependence, the exact defect class this whole ticket
exists to remove, wearing nullability's clothes rather than the type system's.

So the flip is D2 replacing an unsound order-dependent computation, not D2's own reach growing to
expose a flaw in D2. The three corroborating checks:

1. **Direction.** A latent defect spreading would produce false claims. This produces a *true*
   claim where a false one stood: element 2 really does carry `null` there, so `nullable = true`
   is the accurate description. The pre-fix `false` was the wrong answer, and it was wrong for a
   reason (order) unrelated to D2.
2. **Blast radius is nil.** I checked every consumer of `.nullable`
   (`DataTypeProtocol.scala:45`, `PanelCapabilityService.scala:69`, `WorkspaceContextService.scala:378`,
   `DataTypeService`, `SchemaInferenceFacade`, the three `PatchSet*` carriers, `DataSourceService`,
   `SourceService`). Every one is a pure carrier — it copies the flag onto a wire/response type.
   Nothing validates against it, nothing rejects nulls in a non-nullable column, and
   `SparkJobSubmitter.scala:121` hardcodes `nullable = true` on every `StructField` regardless. So
   `false → true` cannot break anything at rest; it can only make a report truer. Had the
   direction been `true → false`, the same audit would have made this blocking.
3. **The genuine latent weakness in D2 is a different one, and it is the opposite sign.** D2 does
   have a known soft spot — absence does not imply nullable, so a heterogeneous source will
   advertise `stats.rec` non-nullable even though most rows lack it. D2 names this itself, records
   the misleading-an-LLM consequence, and defers it with a follow-up to file. That is a
   false-*negative* (claims non-null where nulls will appear); the flip we are examining is a
   false-negative being *removed*. They point in opposite directions, so the flip is not that
   defect surfacing. It remains correctly deferred — but see the non-blocking note about actually
   filing it.

**AC5 ("nullability behaviour is unchanged for existing sources") — satisfied on this reading.**
AC5's purpose is to stop this refactor silently degrading nullability information. Nothing became
less nullable anywhere; the field-name set on an existing single-shape source is byte-identical
(63 = 63, verified); the rule is unchanged; the only movement is a previously order-dependent
answer becoming order-independent and correct. The literal reading of "unchanged" is what D2 now
concedes it overstated, and the design says so in the artifact rather than papering over it. That
is the honest disposition, and I accept it.

---

### Question 2 — sweep for the CR2 pattern (assertions anchored to a stated expectation; comments claiming invariance the code does not guarantee; tests that would pass if the thing they name stopped being true)

Two real findings, plus three minor notes. The sweep was worth running.

**Finding A (blocking) — the strengthened 3.10 test is now RED on revert, while both tasks.md and
the committed transcript still assert it is GREEN.** This is the CR2 pattern one level up: an
*evidence artifact* anchored to a stated expectation rather than to observed behaviour. I re-ran
the revert myself (`git checkout main -- SchemaInferenceEngine.scala`, targeted suite, restore):

```
Cycle 1: Tests: succeeded 73, failed 7   (7 [RED] tests)
Cycle 2: Tests: succeeded 72, failed 8   (the same 7, PLUS 3.10)
[info] - should characterise the existing WR-only fixture's inferred schema field-by-field
        (pins the two nullability flips) *** FAILED ***
```

Necessarily so: the new assertions pin `nullable = true` and `FloatType`, which are the post-fix
answers. But `tasks.md` still classifies 3.10 `[CHAR]`, and `evidence/red-verification.md` still
says "73 succeeded, 7 failed", lists 3.10 under "[CHAR] tests — all stayed green on revert", and
concludes "No `[CHAR]` test went red on revert; no finding to report on that front." All three
statements are now false, and design D6 is explicit that "the committed transcript must show
EXACTLY that split" and that "a characterisation test that goes red on revert is itself a finding
and must be reported". The test change is an improvement; leaving the evidence describing the
previous version of it is precisely the stale-attestation failure this ticket keeps re-encountering.
Nobody re-ran the revert after strengthening the test. See Change Request 1.

**Finding B (blocking) — a comment claiming an invariance the code does not guarantee, in
`NestedJsonFlatteningSymmetrySpec.scala:13-18`.** This is a cycle-1 task-1.5 edit that I did not
catch in cycle 1; it surfaced only because this sweep was asked for. Clause 1 defines the
"symmetry" assertion as *"the field-name set `SchemaInferenceEngine` infers must **equal** the
column-key set `PipelineRowJson.jsRowToRow` materialises"*, notes it is deliberately scoped per row
object, and now ends:

> "...HEL-858 replaced `mergeObjects` with a union/widen over leaf paths
> (`SchemaInferenceEngine.inferFromObjects`), which is now schema/row-agreement-safe across a
> whole heterogeneous array too, not just per row."

That final clause is **false** under the equality relation the same comment just defined, and it
contradicts design D6 head-on: *"Naive 'schema field-name Seq == the row's key set' is WRONG: it
fails a CORRECT implementation on every heterogeneous input, including D5's collision and the
ordinary `stats.rec` case."* Under union semantics the schema deliberately carries fields no single
row has — a QB row's key set does not equal a schema containing `stats.rec` — so widening this
per-row equality assertion to the whole array would fail *today*, on the very fixture this change
adds. The relation that is safe whole-array is the three-sided subset+union property of D6, which
is a different assertion, and the comment does not say so. Worse, the comment is unfalsifiable by
its own file: the test remains scoped per row, so nothing would ever catch the claim being wrong.
Same shape as CR2 — a confident invariance claim with no assertion behind it. See Change Request 2.

**Minor note 1 (non-blocking) — test 3.1 is vacuity-tolerant.** The central order-independence test
asserts only `reversed shouldBe forward` and `shuffled shouldBe forward`. A degenerate `fromJson`
returning `InferredSchema(Seq.empty)` for everything would pass all three comparisons. It is not
vacuous in fact (it went red on revert, and 3.2/3.9 pin content), but for the ticket's *central*
test I would add one line asserting the forward schema's expected field names/types, so the test
cannot be satisfied by an implementation that stopped producing fields at all.

**Minor note 2 (non-blocking) — 3.10's comment still asserts slightly more than 3.10's test.** The
comment says "No other field changes name, type, or nullability on this fixture"; the test asserts
4 specific fields plus 3 name memberships, not the absence of other changes. The claim happens to
be true — I verified all 63 fields independently — but it is again a stated invariance without an
assertion. Pinning the whole sorted `Seq[InferredField]` (or its size plus a sorted
name/type/nullable tuple list) would make the comment self-enforcing. Cheap, and it would have
made Finding A visible automatically.

**Minor note 3 (non-blocking, inherent) — the agreement helpers can co-drift.** `assertAgreement`
(3.8a/3.8b) and `NestedJsonFlatteningSymmetrySpec`'s symmetry test both compare
`SchemaInferenceEngine` output against `PipelineRowJson.jsRowToRow`, and both sides derive from the
same `JsonFlattener.leaves` traversal. A change that broke both identically would keep them green.
That is intrinsic to a symmetry property and is exactly what design D6 intends (the point is that
the two projections agree), and the negative control in `NestedJsonFlatteningSymmetrySpec` item 2
plus 3.9's absolute assertions cover the "both broke" case. Recorded for completeness, not as a
defect.

Nothing else in the diff matched the pattern. I re-read every new comment and assertion:
`widenJson`'s divergence comment is accurate (I checked `widenType` at line 166 — it does widen
`IntegerType` to `BooleanType` on `"true"`); `inferFromObjects`' block comments describe what the
code does; `JsonFlattener`'s scaladoc fix is accurate; 3.9's adequacy assertions are anchored to
the fixture and fail on `-1`; 3.4 derives its declared type rather than stating it; 3.5, 3.7 and
3.3b assert observed behaviour with no expectation-shaped shortcuts.

---

### Phase 1: Spec Review — FAIL

All cycle-1 spec findings are resolved (see CR1/CR2/CR3 above), and no AC regressed. AC1-AC4 remain
covered as verified in cycle 1; AC5 is satisfied on the reading established in Question 1 and is
now honestly documented in D2 and in the new evidence file.

The new failure is that `tasks.md`'s `[CHAR]` classification of 3.10 no longer describes the test
that exists, and `evidence/red-verification.md` no longer describes the suite that exists — a
planning artifact and an evidence artifact both stale relative to the implemented behaviour
(Finding A), plus a false invariance claim in a committed comment (Finding B).

### Phase 2: Code Review — FAIL

Gates, all re-run by me at `fce18e1b`:

| Gate | Result |
|---|---|
| `sbt "testOnly *SchemaInferenceEngineSpec *JsonFlattenerSpec *NestedJsonFlatteningSymmetrySpec *SparkJobSubmitterSpec"` | **80 succeeded, 0 failed** |
| `sbt test` (full backend suite) | **238 suites, 3663 succeeded, 0 failed, 0 aborted** |
| Revert re-run (my own stash-equivalent) | **72 succeeded, 8 failed** — contradicts the committed transcript's 73/7 |

The executor's green-suite counts are confirmed. No source file changed this cycle — the entire
cycle-2 diff is one test method, one comment block, three markdown files and the cycle-1 report —
so cycle 1's code-quality assessment stands unchanged, and the fix logic itself remains correct.
The FAIL is Finding A's evidence contradiction and Finding B's false comment, not the code.

### Phase 3: UI Review — N/A

Backend-only, unchanged from cycle 1. No `frontend/**`, no `ApiRoutes.scala`, no `schemas/**`, no
`openspec/specs/**`.

---

### Overall: FAIL

Close. All three cycle-1 change requests are genuinely and accurately addressed — and CR1's
artifact survived an independent recomputation of both algorithms, which is a higher bar than it
was asked to clear. Question 1 resolves in the change's favour: the nullability flip is a
correction, not a spread, and AC5 holds.

What fails is that strengthening the 3.10 test moved it from characterisation to red-on-revert and
nobody re-ran the revert, so the committed transcript now asserts a split (73/7, "no [CHAR] test
went red") that my own run contradicts (72/8, 3.10 red). On a ticket whose entire history is
evidence-shaped non-evidence, shipping a transcript that describes the previous version of the
suite is the one thing that must not go out. Plus one false invariance claim the sweep turned up.
Both are cheap: no source change, no re-planning.

### Change Requests

1. **Reconcile task 3.10's classification and the revert transcript with the test that now
   exists.** The strengthened 3.10 test asserts post-fix answers (`nullable = true`,
   `FloatType`) and therefore fails on revert — I measured **72 succeeded / 8 failed**, the
   cycle-1 seven plus 3.10. Either:
   - **(preferred)** split 3.10 into a `[CHAR]` half that genuinely holds both ways (field-name
     `Seq` and its size — 63 fields, identical pre and post) and a `[RED]` half pinning the four
     changed fields; or
   - reclassify 3.10 wholesale as `[RED]` in `tasks.md`.

   Then **actually re-run the revert** and rewrite `evidence/red-verification.md` from the new
   capture: update the 73/7 headline, move 3.10 out of the "[CHAR] — all stayed green" list, and
   replace the closing "No `[CHAR]` test went red on revert; no finding to report on that front"
   with what is now true. Do not hand-edit the counts to 72/8 without re-running — that would
   substitute exactly the reconstructed attestation this ticket keeps failing on.

2. **Fix the false invariance claim at
   `backend/src/test/scala/com/helio/domain/engine/NestedJsonFlatteningSymmetrySpec.scala:16-18`.**
   Delete or correct "which is now schema/row-agreement-safe across a whole heterogeneous array
   too, not just per row." Under the per-row **equality** relation the same comment defines, a
   whole-array assertion still fails post-HEL-858 and *should* — design D6 says so explicitly, and
   union semantics make it inevitable (a QB row has no `stats.rec`, but the schema does). Replace
   it with the accurate statement: the per-row scope remains correct; the relation that holds
   whole-array is D6's three-sided subset + union + no-duplicates property, which is asserted
   separately in `SchemaInferenceEngineSpec`'s `assertAgreement` tests (3.8a/3.8b), not here.

### Non-blocking Suggestions

- Add one content assertion to test 3.1 (expected field names/types on the forward schema) so the
  ticket's central test cannot be satisfied by an implementation that returns an empty schema.
- Make 3.10's "No other field changes name, type, or nullability" claim self-enforcing by pinning
  the full sorted `Seq[InferredField]` rather than four hand-picked fields. This would also have
  caught Finding A automatically.
- `stats.pts_half_ppr`'s `259.0 → IntegerType` pre-fix is a live instance of the
  `inferJsonType` quirk task 4.3 records as out of scope. Worth naming it concretely in the
  delivery report — "observed on the WR fixture", not "in principle" — so the follow-up has a real
  example attached.
- The D2 follow-up the design promises ("a path absent from some sampled rows should infer as
  nullable") is still a paragraph, not a ticket. File it before archiving; Question 1's analysis
  above is the reasoning for why it is the remaining real weakness in the nullability rule.

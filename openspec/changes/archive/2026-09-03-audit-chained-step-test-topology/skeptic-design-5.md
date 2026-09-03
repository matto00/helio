## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

**Round-4 CR is addressed in all three parts.** design.md D2a now enumerates three
buckets, with bucket 3 ("already guarded, independent of topology — red under BOTH")
explicitly barred from being reported as bucket 1; D2 carries the per-ASSERTION
granularity rule with the bucket-1 claim restricted to an assertion green under
old topology + mutation; and D2a replaces the old test-level bucket-2 prediction
for 234/235 with a per-assertion prediction, recording the correction rather than
dropping it. tasks.md 4.4 and 4.5 enforce both. The non-blocking items are folded
in: D2's 544/545 row now carries the full `domain/engine/` path, D5's evidence
bullet is realigned to three buckets + per-assertion, and task 7.2 covers the
"13 known" vs 12 discrepancy.

**Buckets are mutually exclusive and jointly cover the observed outcome space
for the assigned mutations.** Over the 2x2 of {old, new} x {green, red}: green/red
= bucket 1, red/red = bucket 3, green/green = bucket 2. The only unenumerated cell
is red-old/green-new (see note 1) — theoretically possible, not expected for any
assigned mutation.

**234/235 prediction — verified against source; the bucket-3 half is right, the
bucket-1 half is not observable and is wrong on its own terms.** Ground truth:
`backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:408`
`val steps = allSteps.filter(_.enabled)` (D2 cites 407; the line is 408 — the
comment above it is 405-407). Test at
`backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala:229-247`.
- `resp.steps should have size 1` -> 2 under the mutation in BOTH topologies. Red
  under both = bucket 3. **Prediction correct.**
- `step.inputSchema.map(_.name) should contain allOf ("order_id", "amount")` is
  asserted on `resp.steps(0)`, and it is preceded in the same block by
  `resp.steps should have size 1` and `step.type shouldBe "select"`. ScalaTest
  aborts the block at the first failed assertion, so under the mutation this
  assertion is **never evaluated in either topology**. Independently, were it
  reached: with the filter dropped `resp.steps(0)` is the un-filtered `rename`,
  not `select`, and `rename`'s inputSchema is still the source schema
  (`order_id, amount`) — so it would pass, not go red. It is therefore not bucket 1
  under this mutation.
This makes the prediction's second half refutable-and-refuted rather than
false-evidence-producing: task 4.5 explicitly instructs the executor to *confirm
or refute* it, and D2a's precondition routes an unobservable/inert assertion-level
target to "measurement error — report the mis-specification", not to an AC4
finding. A compliant executor records bucket 3 for this test plus a refutation of
the prediction's second half. That is honest evidence, and it is exactly what the
recorded-prediction mechanism exists to produce. I give the arithmetic in note 2
so the executor does not spend a cycle re-deriving it.

**Executability end-to-end.** D1/D2/D2a/D3/D4/D5/D6 and tasks 1-7 chain without a
gap: census -> corrections -> per-test mutation with justification -> three-bucket
per-assertion recording -> D3 diagnosis for the predicted `Vector(0,1)` red ->
rename as the compiler-enforced completeness gate -> audit-report.md deliverable.
Settled ground truth from rounds 1-4 was not re-litigated.

### Verdict: CONFIRM

### Non-blocking notes

1. **A fourth cell exists that the enumeration cannot express: RED under old /
   GREEN under new.** That would mean the topology correction *removed* coverage —
   an alarming signal, not a nothing-result. Not expected for any assigned
   mutation, and D2a's measurement-error clause gives the executor a path, but if
   it occurs it should be reported as its own outcome, never squeezed into
   bucket 2.
2. **Give the executor the 234/235 arithmetic above up front** (size assertion
   fails first and short-circuits the block; `steps(0)` becomes the `rename` under
   the mutation). Expected honest outcome for that test: bucket 3 at test
   granularity, with the prediction's `inputSchema` half refuted as unobservable
   under this mutation.
3. **`PipelineRunRoutesSpec` 468/469 is likely bucket 3 as well.** With the
   preview target being the ancestor `select`, `pathToRoot(select)` is `[select]`
   under BOTH shapes, so widening it to all steps applies `limit(1)` and turns
   `rowCount shouldBe 2` red either way. That is a legitimate result now that
   bucket 3 exists — worth flagging so it is not mistaken for a mis-assignment and
   mutation-shopped.
4. D2 cites `PipelineService.scala:407`; the filter is at line 408.
5. tasks.md has two tasks numbered `4.3` (the D2a precondition task and the
   revert-the-break task). Cosmetic; renumber the second.

## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Tooling note: `scripts/concertino/next-report-number.sh`, `persist-evidence.sh` and
`emit-event.sh` do not exist in this worktree (`scripts/concertino/` contains only
assert-phase/cleanup/setup-worktree/start-servers + lib). Filename chosen as instructed;
verified `skeptic-design-2.md` did not already exist. No event emitted — no emitter present.

### What I verified (with evidence)

- Worktree HEAD is `7972247c HEL-599 Flatten nested JSON ... (#462)`; all source read from
  this worktree only.
- `SchemaInferenceEngine.scala:82-99` — `mergeObjects` confirmed: first-non-null-wins
  (`case Some(_) => m`), top-level only, plus a second pass that overwrites any key seen as
  `JsNull` in ANY object back to `JsNull`. Both ticket defects reproduce by reading.
- `JsonFlattener.scala:36-39` — scaladoc does reserve the union/widen-over-paths move for
  HEL-858 "without needing any change to this traversal itself". D1 is genuinely pre-authorised.
  `leaves` dedupes per object (line 58-61) — so D5's cross-row collision is indeed outside its reach.
- `SparkJobSubmitter.scala:234-244` — `jsValueToAny(v, dt)` with
  `case (JsNumber(n), IntegerType) => n.toInt`; declared type comes from `sparkDataType` over the
  static source's `config.columns[].type` (lines 118-122). `PipelineRowJson.jsValueToAny:53-59` is
  unconditional `n.toDouble`. D6's claim about which site narrows is CORRECT.
- `SparkJobSubmitterSpec.scala` — `new SparkJobSubmitter("local[*]", mockDsRepo, null)` (line 37)
  and ~10 direct `loadDataFrame(ds)` calls over `StaticSource`. D6's feasibility claim is CORRECT.
- Prior CRs 1/4/5 checked against D5, task 3.9 and D2: substantively addressed (see below).

### Verdict: REFUTE

Three defects, all in the same family the prior round was already about: a test classified in a
way its own mechanics cannot satisfy, and a behavioural consequence of the fix that is not just
unrecorded but actively contradicted by the design's own risk text.

Addressed satisfactorily and NOT re-raised: CR1 (D5 "emit both" is right — it is the ordinary
heterogeneous case, it composes correctly with the join since each path is typed only from values
actually seen at it, and it adds no nullability, since neither `a` nor `a.b` is ever `JsNull`);
CR4 (task 3.9's in-test adequacy assertion is computed from the fixture and genuinely fails on a
degenerate or resampled capture); CR5 (D2's rewritten rationale is honest and names the shipped
consequence with real consumer sites). D6's three-sided agreement property (subset + union +
no-duplicates asserted on the `Seq`) is the correct invariant: clause (3) is exactly the
HEL-599 failure mode, asserted on the un-folded `Seq` where it actually lived.

### Change Requests

1. **Task 3.4 is classified `[RED]` but cannot go red, and task 3.11 therefore demands an
   impossible transcript.** As written, the test lives entirely inside `SparkJobSubmitterSpec`
   and declares the column type from a hand-written `StaticSource` `config.columns[].type`
   (`SparkJobSubmitter.scala:118-122`). Reverting the `SchemaInferenceEngine` change does not
   touch that path, so the test is green before and after — the same "evidence-shaped
   non-evidence" the prior CR2 rejected, relocated rather than removed. Fix by one of:
   (a) make the test actually depend on the fix — derive the static source's declared column
   types from `SchemaInferenceEngine.fromJson` over JSON rows containing `3` then `2.5`, so
   pre-fix inference declares `integer`, Spark truncates `2.5`→`2`, and post-fix inference
   declares `float` and it does not; this is red on revert and is the only wording that makes
   AC3's "no truncation occurs on materialisation" load-bearing; or (b) keep it as a pure
   narrowing-site demonstration and reclassify it `[CHAR]`, stating in the task that AC3's
   truncation clause is then evidenced only by the type change, not by an end-to-end value.
   (a) is strongly preferred; it is what spec scenario "No truncation on materialisation of a
   widened column" (spec.md:103-105) actually asserts.

2. **Task 3.8's split classification `[RED for the union half, CHAR for the subset half]` is
   incoherent, and the subset half is not characterisation.** A test is one artifact and either
   fails or passes on revert, so a per-half label cannot be checked by 3.11's transcript. Worse,
   the subset clause is NOT green pre-fix: the adversarial set explicitly includes heterogeneous
   shapes, and pre-fix a row carrying `stats.rec` has a key absent from the merged schema, so
   "every row's key set ⊆ schema field-name set" fails today too. Split 3.8 into separately
   classified tests — e.g. `[CHAR]` for the clauses that hold pre-fix (no-duplicates on the
   within-object collision input; subset/union on single-shape input) and `[RED]` for the
   subset+union clauses over heterogeneous and cross-row-collision input — and state each one's
   expected revert outcome individually.

3. **The change silently NARROWS the type of every null-containing column, and design.md's Risks
   section asserts the opposite.** Today, `mergeObjects`' second pass (`SchemaInferenceEngine.scala:93-97`)
   overwrites a key with `JsNull` whenever ANY sampled object has it null, so `inferJsonType(JsNull)`
   makes that column `StringType, nullable = true` — even when other rows carry numbers. Under D2/D3
   ("`JsNull` never participates in the join") the same column becomes `IntegerType`/`FloatType`,
   nullable. That is `String → Integer`, a narrowing, on the very common "some rows null" case
   including single-shape sources. It directly contradicts the Risks bullet "widening is strictly
   loosening (never `float → integer`), so re-inference cannot narrow a column out from under an
   existing panel binding" — re-inference can and will do exactly that. It also makes task 3.10's
   `[CHAR]` wording unsafe: a WR-only-fixture column that flips `string → integer` is not "where
   widening legitimately applies", so the exception clause would absorb a real, unflagged change.
   Required: (i) correct the Risks bullet to state the narrowing and its blast radius on existing
   panel bindings that expect a string column; (ii) record it as a decision (it is defensible —
   `StringType` for a numeric column with one null is itself a defect — but it must be a stated
   choice, not a side effect); (iii) add a spec scenario pinning it ("a path null in one object and
   integral in another infers `IntegerType`, nullable", alongside the existing float scenario at
   spec.md:95-97, which today reads as merely about floats); (iv) reword 3.10 so a
   `string → numeric` flip on the existing fixture must be reported explicitly rather than
   qualifying as legitimate widening.

### Non-blocking notes

- design.md at 164 lines vs the 150-line guideline: the excess is process history, not design.
  D2's second paragraph (~lines 44-50, relitigating the round-1 rationale) and D6's "the first
  wording was wrong" preamble (~lines 94-96) are review artefacts. The DECISIONS survive without
  them; the reasoning belongs in this report chain. Cutting those two passages lands the doc
  under the guideline without losing a single normative statement.
- Task 3.3 bundles six widening assertions into one `[RED]` test; that is fine for the label
  (it goes red overall), but its "all-null infers nullable string" clause is green pre-fix.
  If it is split for readability, classify the pieces.
- `inferJsonType` typing `2.0` as `IntegerType` (Planner Notes, task 4.3) is correctly scoped out
  and correctly slated for the delivery report.

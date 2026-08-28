## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold gate. Every number below is from a command I ran myself in this worktree
(`/home/matt/Development/helio/.claude/worktrees/bug/recursive-merge-type-widening/HEL-858`, base `7972247c`,
3 commits: `50f3140b`, `fce18e1b`, `8db1a47a`). I read the executor/evaluator reports as claims and
re-derived each one. No UI changes in this diff (backend Scala + test resources only), so the
design-judgment section does not apply.

### What I verified (with evidence)

**1. Independent adversarial probes against the built code — the agreement property (design D6).**
I did not rely on the committed tests to tell me the committed tests are adequate. I compiled a probe
(`scala.tools.nsc.Main` against `Test/fullClasspath`, outside the repo — no repo file was modified)
that calls the shipped `SchemaInferenceEngine.fromJson` and `PipelineRowJson.jsRowToRow` directly and
asserts all three D6 clauses on the un-folded `Seq`:
(1) every row's key set ⊆ schema field-name set; (2) schema field-name set == union of all rows' key
sets; (3) `schemaNames.distinct == schemaNames`.

Inputs covered: within-object collision `{"a.b":1,"a":{"b":2}}`; cross-row leaf-vs-subtree
`{"a":1}`/`{"a":{"b":2}}`; that collision *combined* with a literal dotted key in a third row; dots
inside keys; unicode (`café`, `日本`) and empty-string keys; nulls in leaf, nested and all-null
positions; heterogeneous shapes; depth at `MaxDepth` and at `MaxDepth+5`; empty arrays, arrays of
scalars, empty object values, empty object rows; mixed scalar kinds at one path. Plus:
- **exhaustive 3-value cross-product** over `{JsNull, 1, 2.5, true, "2024-01-15", "q", [1], {k:1}}`
  (512 triples × all 6 permutations each) checking both agreement and schema equality across
  permutations — an empirical commutativity/associativity check on the D3 join as *actually
  accumulated*, not on the join function in isolation;
- **3,000 fuzzed row-sets** (1–4 rows, depth 2–4, keys drawn from a pool that deliberately includes
  `a.b`, `a.b.c`, `a..b`, `x.`, `.y`, `""`, unicode) × up to 24 permutations each;
- **500 deep-fuzzed row-sets** at depth 12 (past `MaxDepth`).

Result: `ALL PROBES PASSED` — zero agreement violations, zero duplicate field names, zero
order-dependent schemas across roughly 90k `fromJson` invocations. I could not construct an input
where the schema and the rows disagree. The HEL-599 failure mode (a duplicate-named field surviving
in the schema `Seq` because only the row side folds into a `Map`) is structurally closed here:
`inferFromObjects` accumulates into a `Map[String, PathAcc]` keyed by path and emits one field per
key, and `JsonFlattener.leaves` already dedupes per object, so duplicates cannot be constructed on
either side.

**2. Order-independence, adversarially.** Beyond the committed fixture: all permutations for row-sets
of ≤5 and seeded shuffles above that, over collisions, mixed null/integral/fractional/string at the
same path, and permutations that change which row is first for a given path. `InferredSchema` values
compared whole (name, displayName, type, nullable, sequence order). No permutation produced a
different schema. Spot values I printed and checked by hand: `null,int → (IntegerType,true)` in both
orders; `ts,str,num → (StringType,false)`; `array,int → StringType`.

**3. Acceptance criteria traced to real evidence.**
- **AC1** (field present in any row appears regardless of position) — `SchemaInferenceEngineSpec` 3.2,
  and independently reproduced by my probe's heterogeneous cases.
- **AC2** (order-independence, central) — 3.1 pins the *content* map as well as relative equality, so
  a degenerate implementation cannot satisfy it; independently reproduced at scale in probe 2.
- **AC3** (mixed integral/fractional → float, no truncation) — 3.3 for the type, and 3.4 end-to-end
  through `SparkJobSubmitter.loadDataFrame` where the declared type is *derived from*
  `SchemaInferenceEngine.fromJson`, not hand-declared. I confirmed by revert that this test is red
  pre-fix (`"[integer]" was not equal to "[float]"`), i.e. it is genuinely load-bearing — the
  hand-declared variant the design warns about would have been green both ways.
- **AC4** (mixed-position Sleeper URL yields the full `stats.rec*` family) — I parsed
  `backend/src/test/resources/hel858/sleeper-mixed-projections-slice.json` myself: 15 elements,
  descending `pts_ppr`, element 0 = Josh Allen (QB, no `rec`/`rec_yd`/`rec_td`), element 1 = Jahmyr
  Gibbs (RB, all three present) — exactly the ticket's reported ordering. The payload is a genuine
  live capture, not a hand-built stub: real `player_id`s (Gibbs = 9221), epoch-ms `last_modified`,
  `company: "rotowire"`, nested `player.metadata.{channel_id,genius_id,rookie_year}`, `null`-valued
  `status`/`opponent`/`week`/`injury_*`. Its SHA-256 is
  `c9c6fc1b7dfc7928a78d5445e8beee1341ac4814e446f5d58499a3c490a6d16c`, which matches the
  post-`prettier` checksum recorded in `evidence/live-probe-transcript.md`, and my independent
  position/`rec`-presence table matches that transcript's row-for-row. Test 3.9 asserts the adequacy
  property (`firstIdxWithout >= 0`, `laterIdxWith > firstIdxWithout`) in code before asserting the
  outcome, so a degenerate or resampled capture fails loudly rather than passing vacuously.
- **AC5** (nullability unchanged for existing sources) — 3.5 pins absence-≠-nullable and stayed green
  on my revert. The two nested `false → true` flips on the WR fixture are real, are the unchanged D2
  rule reaching a nested path for the first time, are in the strictly-more-accurate direction, and are
  disclosed in design D2, in the test comment, and in `evidence/wr-fixture-characterisation.md` rather
  than absorbed.

**4. Evidence artifacts audited for reconstruction — I re-ran the revert.**
`git checkout 7972247c -- SchemaInferenceEngine.scala JsonFlattener.scala`, then the targeted suite:
**81 tests run, 73 succeeded, 8 failed** — the exact headline in `evidence/red-verification.md`. The
failing *set* is exactly the 8 the transcript names (3.1, 3.2, 3.3, 3.6, 3.8b, 3.9, 3.10b in
`SchemaInferenceEngineSpec`; 3.4 in `SparkJobSubmitterSpec`), and every test classified `[CHAR]` in
`tasks.md` (3.3b, 3.5, 3.7, 3.8a, 3.10a) stayed green. The artifact is not stale — it describes the
suite that actually exists. Restored with `git checkout HEAD -- <same two files>`; `git status`
clean afterwards (only the untracked `evaluation-3.md`).

**5. Design decisions judged as shipped.**
- **D3 (lattice)** — implemented as specified and empirically confirmed commutative/associative/
  idempotent through the accumulator over the full value cross-product. The divergence from CSV's
  order-sensitive `widenType` is stated normatively in the spec delta *and* at the join in code.
- **D5 (emit both on collision)** — correct: it is the only option that neither deletes a column a row
  genuinely carries nor reintroduces order dependence, and it needs no special case. Verified by probe
  and by 3.6 in both row orders.
- **D7 (String→numeric narrowing for null-containing columns)** — a real, deliberate behaviour change
  on a common input class, argued in design.md, pinned by its own spec scenario, and surfaced (not
  absorbed) by 3.10b. I checked the one place a `nullable` flag could bite at runtime:
  `SparkJobSubmitter.loadDataFrame` hardcodes `nullable = true` on every `StructField`
  (`SparkJobSubmitter.scala:120`), so nothing fails at materialisation because a union-schema column
  is absent from a row. No persisted DataType is rewritten. I accept the trade.
- **D2 (deferring absence-implies-nullable)** — correctly scoped out, with the misleading-flag
  consequence and its named consumers recorded and a follow-up owed at Delivery.

**6. Gates re-run by me.** Targeted suite at HEAD: **81/81 green** (run twice — before any revert and
again after restoring). Full `sbt test` at HEAD: **3664 succeeded, 0 failed, exit 0**. Compile clean.

### Verdict: CONFIRM

The central risk this gate exists to catch — the two projections disagreeing under adversarial input —
does not materialise. I attacked it directly with ~90k independent invocations over the exact input
classes the ticket enumerated, including the collision class that defeated HEL-599, and the property
held every time. The red-verification artifact reproduces exactly. The AC4 fixture is real, exercises
the defect, and has its adequacy asserted in code rather than attested.

### Non-blocking notes

- **Inference cost grew ~25× on large payloads.** I measured `fromJson` over a 3,120-element
  reconstruction of the Sleeper response: **~250 ms** post-fix vs **~10 ms** on the reverted source
  (steady-state, 3 iterations each). This is expected — pre-fix flattened one merged object, post-fix
  flattens all 3,120 — and 250 ms one-off on the largest realistic payload is fine. But design.md's
  "not a new order of cost" understates it; the JSON path also has no sample cap where the CSV path
  caps at 100 rows. Worth a line in the delivery report, not a change here.
- **Non-object array elements remain a schema/row disagreement, pre-existing and unchanged.** For
  `[{"x":1}, "nope", 42]` the schema is `["x"]` while `jsRowToRow` yields `{"value"}` for the two
  non-object elements. `fromJson` filters to `JsObject` (it did pre-fix too, `elements.collect`), so
  this is not introduced here, and test 3.8a correctly declines to run `assertAgreement` on it.
  Reachable in principle via `RestApiConnectorDriver.toRows`. Candidate spinoff.
- **Spec prose tension.** The MODIFIED "JSON schema inference" requirement still reads "an inferred
  dotted field is always a field the rows actually carry", which under union semantics is true only of
  *some* row. The added union scenario disambiguates it, but the sentence would read better as "a
  field some sampled row actually carries".
- **`inferJsonType` types `2.0` as `IntegerType`**, so a fractional column sampling only whole floats
  still infers `integer` (visible in the WR fixture: `stats.rec` = `63.0` → `IntegerType`).
  Deliberately out of scope per task 4.3 and already slated for the delivery report; noting it so it is
  not mistaken for a miss.
- **Tooling.** `next-report-number.sh` / `persist-evidence.sh` / `emit-event.sh` do not exist at this
  revision, as the orchestrator stated. This report is written at the instructed path; no durable copy
  and no `verdict` event could be emitted. Not a BLOCKER.

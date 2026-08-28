## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Worktree base is correct.** `git log --oneline -3` in the worktree → HEAD `7972247c HEL-599 Flatten
  nested JSON into dotted row columns via one shared traversal (#462)`. `JsonFlattener.scala` is present
  here. All source below was read from this worktree, never from `/home/matt/Development/helio` (release/v1.7).
- **The bug is real and as the ticket describes.** Read `SchemaInferenceEngine.scala` lines 82–99.
  `mergeObjects` folds `objects` shallowly: `case Some(_) => m` keeps the first non-null value (defect 2,
  no widening) and a nested `JsObject` value is kept whole so later rows' sub-keys never join (defect 1).
- **The field report's diagnosis is indeed wrong, and the plan correctly rejects it.** `mergeObjects`
  (line 83) *does* `foldLeft` over all `objects`. proposal.md Non-goals explicitly rules out sampling
  more rows. No artifact drifts back toward the sampling non-fix. Good.
- **HEL-599 scaladoc read** (`JsonFlattener.scala` header): it does reserve exactly this move —
  "HEL-858 is expected to replace row-set-level merge with a union/widen over the leaf *paths* this
  produces, without needing any change to this traversal itself." D1 is pre-authorised, not invented.
- **D1 edge cases checked against `JsonFlattener` source**, and the plan is equivalent to today on each:
  empty `JsArray` → no paths → empty schema (matches current `mergeObjects(Nil)` → empty `JsObject`);
  non-object array elements → still dropped by `collect { case obj: JsObject }`; root `JsObject` via the
  single-element case is byte-identical to the current direct call; objects at/over `MaxDepth` are already
  leaves inside `leaves` and infer `StringType` via `inferJsonType`'s catch-all. No regression found here.
- **D3's join is genuinely a lattice — I tried to break it and could not.** Order the types
  `Integer < Float < String`, `Timestamp < String`, `Boolean < String`, `String` top. For every
  incomparable pair the set of common upper bounds is exactly `{String}` (`{Int,Bool}`: `≥Int` =
  {Int,Float,String}, `≥Bool` = {Bool,String}, meet = String; `{Float,Ts}`, `{Int,Ts}`, `{Bool,Ts}`,
  `{Bool,Float}` likewise). A join over a poset is commutative, associative and idempotent by
  construction, so no associativity-breaking triple exists. **D3 is CONFIRMED.**
- **The CSV divergence is justified, not rationalised.** `widenType` (line 135) takes
  `(DataFieldType, String)`, not two types — it is not the same kind of function and is genuinely
  order-sensitive (`Integer` then `"true"` → `Boolean`; `Integer` then `1.5` then `"true"` → `String`).
  It could not be reused without destroying the order-independence AC. Divergence is stated in the
  spec delta. Fine.
- **`mergeObjects` really has no other caller.** `grep -rn "mergeObjects" backend/src` → only its own
  definition, the `fromJson` call, one `JsonFlattener` scaladoc mention and one test-file comment.
  Task 1.4's deletion is safe (both prose references will need updating — see note).
- **Truncation site traced.** `PipelineRowJson.jsValueToAny` converts `JsNumber(n)` → `n.toDouble`
  **unconditionally**, with no reference to the declared `DataFieldType`. The only declared-type-driven
  narrowing I found in main sources is `SparkJobSubmitter.scala:237`
  (`case (JsNumber(n), IntegerType) => n.toInt`). This contradicts task 3.4 — see CR2.

### Verdict: REFUTE

The core approach (D1 flatten-then-merge-over-paths) and the widening lattice (D3) are sound and I
would ship them. What fails the gate is a genuinely new failure class D1 creates that nothing in the
plan covers (CR1), and an evidence standard that a plausible executor can satisfy while proving
nothing (CR2–CR4) — the exact class of defect this epic's own history says to gate on.

### Change Requests

1. **Decide and specify the cross-row leaf-vs-subtree path collision — a NEW failure class this change
   creates.** Today `mergeObjects` runs before flattening, so if row 0 is `{"a": 1}` and row 1 is
   `{"a": {"b": 2}}`, row 0's scalar wins and only the column `a` is ever emitted. Under D1 each row is
   flattened independently, so the path union is `{"a", "a.b"}` and the schema advertises **both** — a
   scalar column and a column nested underneath it, which no single row can ever carry together.
   `JsonFlattener.leaves`' dedup does not help: it is strictly per-object, and the collision is
   *between* objects. This is not in the adversarial probe set (ticket / task 3.6 lists only the
   *within-object* collision `{"a.b":1,"a":{"b":2}}`), is not in the spec delta, and has no decision in
   design.md. Required: a `D6` recording the chosen semantics (candidates: emit both paths; or widen the
   colliding prefix to `StringType` and drop the sub-paths; or last-wins mirroring `leaves`' own D4), a
   spec scenario pinning it, and a case in the task 3.6 agreement property. Whatever is chosen, state
   how the schema-vs-rows agreement property is expected to read on it — under "emit both", the schema
   legitimately holds a name no row carries, which the property as currently worded (schema field-name
   `Seq` "agrees with the row's key set") would flag as a failure against a *correct* implementation.

2. **Task 3.4 tests a path that cannot truncate; it is green before and after the fix.**
   `PipelineRowJson.jsValueToAny` maps `JsNumber(n)` → `n.toDouble` with no consultation of the declared
   `DataFieldType`, so "a widened `float` column materialised through `jsRowToRow` retains its fractional
   values" holds identically under today's `IntegerType` misinference. That is evidence-shaped
   non-evidence. Either (a) re-point 3.4 at the actual declared-type-driven narrowing site
   (`SparkJobSubmitter.scala:237`, `case (JsNumber(n), IntegerType) => n.toInt`) and demonstrate the
   truncation there, or (b) record in design.md that AC3's "and no truncation occurs on materialisation"
   clause is vacuous on the in-process engine path and is satisfied by the type fix alone — and say so in
   the delivery report rather than shipping a test that proves nothing. Do not leave it as written.

3. **Task 3.8's "prove EVERY new test RED by reverting" is unsatisfiable, and an executor resolving it
   the wrong way will weaken the tests.** Several planned tests are *characterisation* tests that MUST be
   green before and after: 3.5 (nullability unchanged — that is literally what AC5 pins), the WR-only
   control half of 3.7, and the within-object-collision cases of 3.6 (already green since HEL-599).
   Confronted with "every new test must be RED", a plausible executor either fudges the transcript or
   reshapes those tests until they do fail — losing the regression value. Required: classify each test in
   tasks.md as **must-be-RED-on-revert** (3.1, 3.2, 3.3, 3.7-mixed, and the new cross-row cases of 3.6)
   or **characterisation, must be GREEN both before and after** (3.5, 3.7-WR-control, existing-collision
   3.6 cases), and require the revert transcript to show *exactly that split* — a characterisation test
   that goes red on revert is itself a finding.

4. **The fixture-integrity standard (task 2.2) is self-referential and, in practice, unfalsifiable.**
   A checksum computed by the executor over bytes the executor captured proves only that it did not edit
   them afterward. HEL-599's actual standard was an **independent re-fetch and byte comparison** — but
   Sleeper *projections* are recomputed continuously, so a re-fetch days later will legitimately not
   byte-match, and the check will be quietly waived. Required: keep the URL/timestamp/checksum record,
   but make fixture adequacy an assertion in code rather than a trusted claim — task 2.1 already states
   the property ("at least one QB-first element lacking `stats.rec*`, at least one later element carrying
   the full `rec_*` family"); assert it in the test itself so a degenerate or resampled fixture fails
   loudly instead of turning 3.7 green for the wrong reason.

5. **D2's stated justification is factually wrong, and the real consequence is unrecorded.** D2 rejects
   absence-implies-nullable on the grounds that "it would alter nullability for existing single-shape
   sources' every optional key, which AC5 forbids". For a genuinely single-shape source every key is
   present in every row, so absence never occurs and nullability would be unchanged — the rule would only
   move nullability on *heterogeneous* sources, which are exactly the sources this change already
   re-shapes. The deferral may still be the right call (smaller blast radius, separate requirement), but
   it must be defended on honest grounds. Required: correct D2's rationale, and record the actual
   consequence being shipped — union-over-paths makes `nullable = false` columns that are null in most
   rows the *common* case, and that flag is surfaced to consumers (`DataTypeProtocol.scala:45`,
   `PanelCapabilityService.scala:69`, `WorkspaceContextService.scala:378` — the last feeding the
   assistant's column semantics). Name the follow-up explicitly rather than leaving it as "a follow-up
   candidate".

### Non-blocking notes

- Task 1.4 deletes `mergeObjects`, but two prose references will dangle:
  `JsonFlattener.scala:36` (its scaladoc contract block) and
  `NestedJsonFlatteningSymmetrySpec.scala:15`. Add a task to update both — a deleted symbol named in a
  contract doc is exactly the confidently-false documentation this repo keeps re-learning about.
- `inferJsonType` types `2.0` as `IntegerType` (`n.scale <= 0 || n.remainder(1) == 0`, line 117), so a
  column that is fractional-valued but happens to sample only whole floats still infers `integer`. Out of
  scope and correctly left alone, but worth one sentence in the delivery report so it is not later
  mistaken for a miss of this ticket.
- D4's claim that the field `Seq` is stable across permutations is correct given `leaves` sorts globally
  by path and the accumulator emits in sorted path order — verified against `JsonFlattener.leaves`.
- Environmental note, not a blocker: this worktree's `scripts/concertino/` predates
  `next-report-number.sh` / `persist-evidence.sh` / `emit-event.sh`. I ran them from the main checkout at
  `/home/matt/Development/helio/scripts/concertino/` against this worktree's change dir.

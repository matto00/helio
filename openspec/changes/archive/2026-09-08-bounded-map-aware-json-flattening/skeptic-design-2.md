## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**D2's table recomputed from scratch, from the staged files, including the intersection column** (python over
`.hel1015-realdata/`; coverage = mean(|keys(row)| / |union|) over object-rows, intersection = keys in EVERY object-row):

| field | file | obj-rows | union | intersection | coverage | design claim |
| -- | -- | -- | -- | -- | -- | -- |
| `adds` | tx.json | 36/36 | 22 | 0 | 0.045 | CONFIRMED |
| `drops` | tx.json | 17/36 | 16 | 0 | 0.062 | CONFIRMED |
| `players_points` | matchups.json | 12/12 | 173 | 0 | 0.083 | CONFIRMED |
| `stats` | projections-sample-200.json | 200/200 | 52 | 16 | 0.580 | CONFIRMED |
| `settings` | tx.json | 22/36 | 3 | 1 | 0.682 | CONFIRMED |
| `metadata` | tx.json | 22/36 | 1 | 1 | 1.000 | CONFIRMED |
| `player` | projections-sample-200.json | 200/200 | 14 | 14 | 1.000 | CONFIRMED |

Every figure in D2 reproduces exactly. **CR1 is genuinely closed**: `projections-sample-200.json` is present (200 real
rows, 265,734 bytes), and `stats`/`player` are now recomputable by anyone. Tasks 4.3/4.4 name the staged file; task 5.3
resolves the tension by forcing a deliberate commit-or-inline decision.

**Synthetic variant counterexample recomputed:** 10 variants x 4 fields + shared `type` -> union 41, coverage
**0.1220**, intersection **1** -> compound rule says STRUCT. **CR4's claim is CONFIRMED numerically**; coverage alone
would have said MAP. The Risks entry now says the failure is SILENT, matching `ticket.md` §1 — CR4 closed.

**CR3 closed:** D2a states outermost-wins, parent-present denominator, and never classifying at `MaxDepth`; task 4.4b
adds the map-of-objects fixture; task 2.1a makes it an implementation task. **CR5 closed:** D7 now states the residual
in the invariant's own words (stored schema advertises `drops.<id>` while the run's rows carry compact-JSON `drops`).

**Consumer inventory re-verified from source** (`grep -rn "JsonFlattener\.\(leaves\|flattenJsObject\)"` over
`backend/src/main`): exactly the three named sites, `SchemaInferenceEngine.scala:113`, `PipelineRowJson.scala:100`,
`SourceService.scala:421`. Note `SourceService` reaches the traversal through **`flattenJsObject`**, not `leaves`
(see CR1 below). Test callers: `JsonFlattenerSpec` (10 `leaves` + 1 `flattenJsObject`), `SchemaInferenceEngineSpec:68`,
`ExpressionEvaluatorSpec:432,445` (both `flattenJsObject`).

**HEL-1030** is referenced in `proposal.md`, `design.md`, `ticket.md` and task 6.2 as owning persisted-schema
remediation only; no migration/backfill work appears anywhere in `tasks.md`. Guardrails intact: HEL-1009 remains
disjoint (`SchemaInferenceEngine.scala:144` still states `inferShallowFromJsObjects` deliberately does not call
`JsonFlattener.leaves`); nothing absorbs HEL-1012/1013/868/869/891/599. `TICKET_TYPE: bug` and the
`domain/engine/PipelineAnalyzeService.scala` path are both corrected.

**I attacked the compound rule as instructed.** Three measurements:

1. *Single-anomalous-row brittleness (the question you most wanted answered): CONFIRMED REAL.* Take the same 10-variant
   payload and delete `type` from ONE row: coverage 0.1195, intersection **1 -> 0**, classification flips
   **STRUCT -> MAP**. One row out of ten (or out of a thousand) missing the discriminator silently collapses the
   struct. The design's residual ("a variant payload with NO key shared by every row") technically covers this, but it
   frames the residual as an exotic *shape*, when the measurement shows it is reached by a *single anomalous row in an
   otherwise well-formed variant payload*. The stated acceptance understates its reachability.
2. *The intersection conjunct has its own failure mode, in the MAP direction, and the design names it nowhere.*
   Because MAP requires intersection to be exactly empty, a genuine map whose sampled rows happen to share one key is
   classified STRUCT and **the bug is simply not fixed** (columns still explode). This is not hypothetical — measured
   on the staged real data, over all row subsets: `adds` n=2 -> non-empty intersection in **25/630** subsets (4.0%),
   n=3 -> **9/4000**; `drops` n=2 -> 1/136. (`players_points` is 0 at every n, and all three are 0 at full size, so
   the ticket's own ACs are unaffected.) Small real fetches are exactly where this lands.
3. *Struct side holds:* no staged struct scores intersection 0; no staged map scores intersection > 0 at full size.
   The rule is right on all real data present. My objection is to what the design *claims about its own residuals*,
   not to the rule.

### Verdict: REFUTE

The mechanism is sound and every number now reproduces — rounds 1's five CRs are substantively closed, and I would not
send this back for any of them. What sends it back is narrow: the compound rule is now the load-bearing decision, and
(a) its failure mode in the MAP direction is unnamed, which is round 1's CR4 defect relocated to the other direction,
and (b) CR2's compile-time guarantee is stated only for `leaves`, while the third consumer enters through
`flattenJsObject`, which the design never brings under the same requirement — leaving the exact silent hole CR2 was
raised to close. Both are cheap to close and neither is a redesign.

### Change Requests

1. **CR2's compile-time guarantee does not cover `flattenJsObject`, which is how the third consumer calls in.**
   `SourceService.scala:421` calls `JsonFlattener.flattenJsObject(obj)`, not `leaves`. D1 and task 2.2 make `mapPaths`
   required on `leaves` only; nothing in the design or tasks says what happens to `flattenJsObject`'s signature. If it
   keeps its single-argument shape (as `ExpressionEvaluatorSpec:432,445` and `JsonFlattenerSpec:144` will want it to),
   the preview consumer compiles cleanly while silently flattening maps — precisely the schema/row divergence D1 calls
   the worst risk, and precisely what round 1's CR2 asked be made impossible. Required: state in D1 (and in task 2.2)
   that `flattenJsObject` takes `mapPaths` as a REQUIRED parameter too, with its own separately-named unclassified
   variant for the test callers; or, if it is to be deleted/merged, say so. Do not leave the guarantee half-stated.

2. **Name the intersection conjunct's own failure mode (MAP direction) and state the accepted position.** Requiring
   `intersection` to be EXACTLY empty means a genuine map whose sampled rows coincidentally share a key is classified
   STRUCT and continues to explode. Measured on the staged real payloads: `adds` over 2-row samples has a non-empty
   intersection in 25/630 subsets (4.0%), over 3-row samples 9/4000; `drops` 1/136 at n=2. Required: add this to
   Risks in the same plain style D3 uses for its own limitation, WITH these measured rates and the note that it is the
   conservative direction (identical to today's behaviour, never a divergence), and either accept it explicitly or say
   what bounds it. An unnamed counterexample in the new load-bearing conjunct is the same defect round 1 refuted on the
   coverage conjunct, pointing the other way.

3. **Re-state the struct-side residual in terms of its measured reachability, not its shape.** Risks currently accepts
   "a variant payload with NO key shared by every row". Measurement: deleting the discriminator from ONE row of a
   ten-variant payload flips intersection 1 -> 0 and the classification STRUCT -> MAP (coverage 0.1195). Required: say
   that the residual is reached by a single row missing the shared key, not only by a payload that structurally lacks
   one — the accepted risk is materially more reachable than the current wording implies. Recommended (not required):
   pin it as a fixture alongside 4.4a so the behaviour is asserted rather than incidental.

### Non-blocking notes

- Task 4.4a says "~10 variants of ~4 fields ... measures coverage 0.122". The exact figure for 10x4-plus-discriminator
  is 0.1220 (union 41); if the fixture uses different arity the pinned number must be recomputed, not copied.
- `JsonFlattenerSpec` has ten `leaves(obj)` call sites that CR2's required-parameter change will break. Task 2.2a
  anticipates this, but 5.1's baseline comparison should expect a test-file edit here and should note explicitly that
  it is a signature migration, not a test weakened to pass (evidence-discipline item 4).
- D2's rejection note (c) says intersection alone is "too close to 0 to carry the decision" — my numbers agree
  (`settings`/`metadata` = 1), and this is honest rather than a strawman.

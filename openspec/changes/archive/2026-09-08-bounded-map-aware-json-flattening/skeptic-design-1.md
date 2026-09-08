## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

**Recomputed the D2 coverage table from the staged payloads myself** (python over
`.hel1015-realdata/{matchups.json,tx.json}`; coverage = mean(|keys(row)| / |union|) over rows where the path is an object):

| field | obj-rows / rows | union | intersection | coverage | design claim |
| -- | -- | -- | -- | -- | -- |
| `players_points` | 12/12 | 173 | 0 | **0.083** | 0.083 CONFIRMED |
| `drops` | 17/36 | 16 | 0 | **0.062** | 0.062 CONFIRMED |
| `adds` | 36/36 | 22 | 0 | **0.045** | 0.045 CONFIRMED |
| `stats` (projections) | — | — | — | **NOT MEASURABLE** | 0.580 UNVERIFIED (see CR1) |
| `player` (projections) | — | — | — | **NOT MEASURABLE** | 1.000 UNVERIFIED (see CR1) |

Two real struct data points the design does not mention, found in the staged `tx.json`: `settings` = **0.682**
(union 3, intersection 1 — `priority` is optional), `metadata` = **1.000**. These are genuine struct-side evidence and
partly rescue the threshold, but 0.682 is a *weaker* near-miss than the 0.580 the design leans on.

- `drops` null/object split: **19 null / 17 object / 36 total** — CONFIRMED, matches D5 exactly.
- `drops`/`adds` key set contains `MIN`, `CHI`, `WAS`, `PHI`, `TB` alongside numeric ids — the D2 rejection of the
  "keys look numeric/opaque" alternative is **honest, not a strawman**. Rejection (c) (non-empty intersection) is also
  honest: all three maps score intersection 0, `settings` scores 1.

**D5 arithmetic verified in source, not asserted.** `SchemaInferenceEngine.scala:113-138`: the `JsNull` branch does
`m.updated(path, prior)` — no increment, no widening join. `inferJsonType` (`:196-208`) has no `JsObject` case; the
catch-all `case _ => (StringType, false)` (comment: "arrays, objects at leaf") gives a map leaf `StringType`.
`nullable = presentNonNullCount < objects.size` → 17 < 36 → **`nullable = true`, one `drops` StringType column, zero
`drops.<id>` columns. D5 holds on the existing arithmetic unchanged.** Row side is consistent:
`PipelineRowJson.jsValueToAny:63` `case other => other.compactPrint`, so the `drops` cell is `null` or JSON text —
the stated downstream consequence is real, not asserted.

**Consumer inventory verified independently** (`grep -rn "JsonFlattener\.\(leaves\|flattenJsObject\)"` over
`backend/src/main`): exactly three production call sites — `SchemaInferenceEngine.scala:113`,
`PipelineRowJson.scala:100`, `SourceService.scala:421`. No fourth. `jsRowToRow` has exactly two callers,
`InProcessPipelineEngine.scala:647,655`, both `outcome.rows.map(...)` — the batch IS in hand at both, so D6's claim
holds there.

**D6's preview trap verified in source.** `SourceService.scala:420`: `val normalizedRows = jsRows.take(10).map { case
obj: JsObject => JsonFlattener.flattenJsObject(obj) ... }`. The `take(10)`-before-flatten is real, and the
classify-over-full-`jsRows`-then-take(10) prescription is sufficient **for that site** — with the caveat in CR2.

**HEL-1009 disjointness CONFIRMED.** `inferOutputSchema` is at `PipelineAnalyzeService.scala:447` (in
`domain/engine/`, not `services/` as the brief said) and derives an op's output schema from `currentSchema`, never
from `JsonFlattener`. `SchemaInferenceEngine.scala:143-148` documents `inferShallowFromJsObjects` as "deliberately NOT
calling `JsonFlattener.leaves`", and its only callers are `PipelineRunService.scala:724,1165`. Nothing in this fix
touches it. No escalation needed.

**HEL-1030 deferral is real.** Fetched from Linear: filed, Backlog, owns prod-count measurement + remediation shape +
owner sign-off. `proposal.md`/`design.md` reference it honestly and smuggle no migration work into scope. The
`PENDING_ESCALATION` in `workflow-state.md` is answered by it.

**Task hygiene:** 1.1/1.2 establish the RED arm from the real staged payloads before any fix; 4.6 is a labelled
mutation guard; 5.1 pins the baseline against 1.3. Evidence discipline is respected in the task shape.

### Verdict: REFUTE

The mechanism (D1/D4/D5/D6) is sound and I confirmed it against source and real data. What fails the gate is that the
**struct side of the load-bearing threshold is unverifiable from this worktree**, and two of the design's own risk
mitigations are false as written — including the one guarding the invariant the coordinator declared binding.

### Change Requests

1. **The projections payload is missing; the entire struct side of D2 is unverified.** `ticket.md`, `design.md` and
   `workflow-state.md` all say the payloads are staged at `.hel1015-realdata/{matchups.json,tx.json}` "plus a
   projections sample". `ls .hel1015-realdata/` returns **exactly two files**. `stats` = 0.580 and `player` = 1.000 —
   the only two struct data points, the near-miss that D2 explicitly calls load-bearing for AC3, and the numbers that
   make "3x above the highest map / 2.3x below the lowest struct" true — cannot be recomputed by anyone. This is
   precisely the evidence rule the run itself declares binding (real data over hand-built fixtures), and tasks **4.3
   and 4.4 both instruct the executor to use "the real projections sample"**, an artifact that does not exist.
   Required: either stage the projections payload in `.hel1015-realdata/` and re-state the two coverage figures as
   reproducible, **or** delete the 0.580/1.000 row from D2 and re-ground the struct side on evidence that *is* present
   — `settings` = 0.682 and `metadata` = 1.000 from `tx.json` (I measured both; state them in D2, and note the margin
   narrows to 2.7x on real staged data). Do not leave tasks pointing at a file that is not there.

2. **D1's mitigation "a missed consumer is a compile-time change site" is FALSE, and it is the mitigation for the
   worst risk in the change.** D1 deliberately *keeps* the single-argument `leaves(obj)` with today's behaviour and
   adds an overload. A missed call site therefore compiles cleanly and silently keeps flattening maps — the exact
   schema/row divergence the Risks table claims is compile-time-prevented. The only real net is task 3.4's grep, which
   is weak by construction. Required: make `mapPaths` a **required** parameter on the traversal used by the three
   production consumers (a `Set.empty` default or a separately-named legacy helper for the test-only call sites is
   fine, but production must not be able to omit it), so the invariant is enforced by the compiler as claimed — or,
   if the overload is kept, delete the compile-time claim from D1 and the Risks table and state plainly that grep +
   task 4.5 are the only protection.

3. **Nested classification is unspecified, and task 2.1 asks for behaviour D2 does not define.** D2 defines coverage
   for "a path P present as an object in rows R" — well-defined at the top level, undefined below it. Task 2.1
   nonetheless requires "classify at every depth". Three questions the executor cannot answer from the design:
   (a) for a nested path, is the denominator the number of sampled rows, or the number of rows in which the parent is
   present as an object? (b) is a path *underneath* a path already classified MAP itself classified/emitted, or is the
   rule outermost-wins and the subtree collapsed into the single map leaf? (c) how does classification interact with
   `MaxDepth`, where an object is already a leaf? Required: state the recursion rule explicitly in D2 (I believe
   outermost-wins with a parent-present denominator is the only choice consistent with D4's "one leaf", but the design
   must say so, not the reviewer), and add a fixture for a map whose values are objects.

4. **The threshold's failure direction is mis-stated, and a common real API shape lands on the wrong side.**
   The Risks table says a struct collapsing to one column is "loud (columns vanish), not silent" — but `ticket.md`'s
   own §1 says a vanished column "silently stops resolving, with no warning". Both cannot be true of the same event;
   the design's optimistic reading is the one carrying the weight of the 0.25 choice. Worse, the design never names
   the shape that actually breaks it in the struct→map direction: a **polymorphic/variant payload** (a `type`
   discriminator plus variant-specific fields — webhook/event feeds, and Sleeper's own transaction `metadata` varies
   by transaction type). Ten variants of five fields gives union 50, per-row 5, coverage 0.10 — a genuine struct
   classified MAP, collapsing columns pipelines are bound to, and D3's 2-row minimum does not help because such a
   sample has many rows. Required: (a) correct the Risks entry to match `ticket.md`'s own account of the failure mode;
   (b) name the variant-payload shape as the known struct→map counterexample and state the accepted position on it
   (fixture pinning it, a mitigating rule, or an explicit acceptance) — an unnamed counterexample in the direction the
   design calls "conservative" is the one thing that must not pass silently.

5. **D7 must state its residual in the invariant's own terms.** As written it says only that "two fetches can classify
   differently". The consequence that matters is one step further: the persisted schema is inferred on one fetch while
   rows are materialised on another, so after a shape change the stored schema can advertise `drops.<id>` columns
   while the run's rows carry a single compact-JSON `drops` — the same "schema advertises a column the row never
   carried" hazard, across fetches. I judge this **honestly bounded and acceptable** (it is strictly smaller than
   today's per-key instability, and today's code has the identical cross-fetch property), but the coordinator flagged
   it must not pass silently. Required: say it in those words in D7, so the acceptance is of the real thing.

### Non-blocking notes

- `workflow-state.md` has `TICKET_TYPE: feature` for what is unambiguously a bug ticket. The probe-confirmed root
  cause is already recorded so `systematic-debugging` is substantively satisfied, but the field is wrong.
- The brief and `workflow-state.md` cite `inferOutputSchema` at `services/.../PipelineAnalyzeService.scala:447`; the
  file is at `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala`. Disjointness is unaffected.
- Task 5.3's "remove `.hel1015-realdata/`" is in tension with CR1 — resolve CR1 first, then decide.
- `.openspec.yaml` does carry `skip_specs: true`, and the no-spec-delta justification (inference/materialisation
  correction, no product-level requirement change) holds: I found no spec-visible wire-shape change in the plan.

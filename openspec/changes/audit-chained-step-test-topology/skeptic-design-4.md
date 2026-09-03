## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

**Round-3 CR1 (distinct, individually justified mutation target per test) — FIXED
in the binding decisions.** design.md D2 now carries a four-row table, one row per
test, plus an explicit recorded paragraph ("Why 544/545 does NOT get the
prefix-walk mutation") naming the leaf/`pathToRoot` reason the earlier assignment
was inert, and a second paragraph flagging the two inert candidates for 346/347.

**Round-3 CR2 (justify-before-recording-a-not-red) — FIXED.** D2a's new
**Precondition** requires the executor to name which assertion would have changed
value had the mutation taken effect, and classifies a mutation with no such
assertion as a *measurement error to be corrected and reported*, not an AC4
finding. The anti-shopping rule is explicitly re-scoped to bite only after a
justified green. New task 4.3 (tasks.md) enforces it.

**New assignment 1 — 544/545 -> `InProcessPipelineEngine.scala:325` — VERIFIED
red-capable, and green under the old topology.** The line exists as named:
`backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala:325`
is `if (step.enabled) evalOneStep(currentRows, step, ctx) else
Future.successful(currentRows)` inside `evalNode` (the file path in D2 is
abbreviated to the bare filename; the real path is `domain/engine/`, not
`services/pipelines/` — cosmetic). The fixture
(`PipelineRunRoutesSpec:540-552`) inserts a **disabled** `limit(1)` then `select`,
and previews `select`. Chained, `pathToRoot(select)` = `[limit(disabled),
select]`, so executing the step regardless of `enabled` yields `rowCount` 1
against `resp.rowCount shouldBe 2` -> RED. Under the old parallel-root shape the
disabled `limit` is on a different branch and never enters the slice, so the same
mutation is inert there -> GREEN. That is exactly D2a bucket 1
("was-vacuous, now-guarded"). This assignment is sound.

**New assignment 2 — 234/235 -> the analyze `.filter(_.enabled)` — the target is
real, but the outcome it will produce is NOT one of D2a's two admissible buckets,
and D2a predicts the wrong one for it.** Ground truth:
`backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala:408`
`val steps = allSteps.filter(_.enabled)` is a single list-level filter whose
output feeds BOTH the per-step response entries and the schema derivation
(`stepInputs` -> `PipelineAnalyzeService.analyze`). The test
(`PipelineAnalyzeRoutesSpec:229-247`) makes two assertions, and the one mutation
splits across them:

- `resp.steps should have size 1` -> **2 under the mutation in BOTH topologies**
  (both steps are returned either way; only the filter suppressed the disabled
  one). RED under old topology as well as new.
- `step.inputSchema.map(_.name) should contain allOf ("order_id", "amount")` ->
  chained, the un-filtered disabled `rename(order_id -> id)` becomes an executed
  ancestor and `select`'s input schema becomes `id, amount` -> RED; under
  parallel roots `select` reads the source schema regardless -> GREEN. This
  assertion is the genuine bucket-1 demonstration.

So step 4 of D2's procedure ("run against the OLD topology with the same
production mutation applied") returns **RED** for this test at test granularity.
D2a says "Specifically, for each of the four tests, **exactly one of**" bucket 1
(green old / red new) or bucket 2 (green under both). Red-under-both fits
neither. Worse, D2a names this very test as the expected bucket-2 case ("a
legitimate and expected outcome for at least `PipelineAnalyzeRoutesSpec`
234/235") — that prediction is false for the mutation D2 assigns it, and D3's own
rationale is that recorded predictions exist precisely so a result cannot be
reinterpreted after the fact. An executor holding a red/red result against an
enumeration that admits neither, plus a stated expectation of bucket 2, is being
pushed toward either a fabricated classification or mutation-shopping — the exact
false-evidence class rounds 2 and 3 refuted.

Note this is a *resolution/granularity* defect, not a dead target: the assigned
mutation does contain a real was-vacuous/now-guarded signal, it is just carried by
one assertion while another assertion in the same test is topology-independent.

**346/347 delegation — acceptable as written.** Unlike the other three, this test
does not depend on a mutation to demonstrate topology-sensitivity: D3 predicts it
goes RED from the topology correction alone (`Vector(0, 1)` -> `Vector(0, 0)`,
from `insertInternalAction`'s sibling-scoped `position`), which is itself direct
evidence the assertion discriminates the two shapes. D3 further pins the two
admissible resolutions, names "updated to `Vector(0, 0)`, suite green" as
explicitly unacceptable, and routes the bad branch to case (b)/escalation. With
D2a's precondition now in force, the worst outcome of the delegation is an honest
"the mutation I selected was inert, here is why" report — not a laundered
finding. Naming a specific expression up front would be marginally better, but
round 3 showed both obvious candidates are inert, so a design-time guess would
itself likely be a fourth mis-assignment. Delegation is the right call here.

**Settled ground truth spot-checked, not re-litigated.** The 544/545 and 234/235
fixtures, `InProcessPipelineEngine.scala:325`, and
`PipelineService.scala:408` were read directly; all match the plan. D3/D4/D5/D6
and AC coverage I re-read and found unchanged from round 3's clearance.

### Verdict: REFUTE

One blocking defect, narrowly scoped and fixable in a single edit. Everything
else in the plan is now executable and sound; assignment 1 (544/545) and the
346/347 delegation both check out. This plan is clearly makeable-sound within the
remaining round — a BLOCKER is not warranted.

### Change Requests

1. **D2a's outcome enumeration must admit the red-under-both case, and the
   234/235 row must be resolved at ASSERTION granularity rather than test
   granularity.** The mutation D2 assigns 234/235 (dropping
   `PipelineService.scala:408`'s `.filter(_.enabled)`) turns
   `resp.steps should have size 1` red under BOTH topologies while turning
   `step.inputSchema ... contain allOf ("order_id", "amount")` red only under the
   corrected chained shape. Required revisions:
   - Add a third admissible outcome to D2a: **"red under both topologies"** —
     meaning the mutated mechanism was already guarded independently of topology.
     State that this is a legitimate recorded result and is **not** to be
     reported as bucket 1 ("was-vacuous, now-guarded"), which would be a false
     AC4 entry.
   - State in D2/D2a that when a single mutation's effect differs across
     assertions within one test, the executor must record the result **per
     assertion**, and that the bucket-1 claim may only be made for an assertion
     that is itself green under old topology + mutation.
   - Correct D2a's stated expectation for 234/235. As written it predicts bucket 2
     ("green under BOTH topologies even with the mutation applied"); the size
     assertion will be red under both and the `inputSchema` assertion will be
     bucket 1. Replace that sentence with the per-assertion prediction so the
     recorded prediction matches what the assigned mutation actually does — the
     whole point of D3's "recorded deliberately so a red result cannot be quietly
     reinterpreted after the fact".

### Non-blocking notes

- D2's 544/545 row cites `InProcessPipelineEngine.scala:325` with no directory;
  the file is at `backend/src/main/scala/com/helio/domain/engine/`, not under
  `services/pipelines/` where the sibling rows point. Worth spelling out so the
  executor does not hunt.
- Round 3's non-blocking note on D5 (its second bullet still presumes a red/green
  pair and does not mention D2a's other buckets) is still open; folding it in
  alongside CR1 would finish the alignment.
- Round 3's note about the ticket's AC1 saying "13 known" while listing 12 lines
  remains unaddressed in the plan text; one sentence in the audit report prevents
  a reviewer reading the 12-row table as short.

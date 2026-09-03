# Audit Report — HEL-949

`PipelineStepRepository.insert` never set `parentStepId`, so every call
produced a root-level branch, never a chain. This report is the AC1/AC4
deliverable: a per-call-site audit of all 33 sites, the mutation evidence for
the 4 sites whose topology was corrected, and the explicit AC4 finding.

Note on the ticket's own count (task 7.2): the ticket's AC1 says "13 known"
call sites in `PipelineRunRoutesSpec` but lists only 12 line numbers (424,
455, 468, 469, 544, 545, 559, 600, 623, 716, 876, 952). The true count is
**12**; the 33-row table below is complete, not short by one.

## Fixture arithmetic (task 1.3)

`seedDsWithData()` (`PipelineRunRoutesSpec.scala:92-101`) seeds exactly 2 rows:
`["alice", 42.0]` and `["bob", 37.0]` (columns `name: string`, `score:
double`). Every `rowCount shouldBe 2` expectation in this report is that
2-row source, unfiltered.

## Census completeness (task 1.2, 1.4)

Zero production call sites of `PipelineStepRepository.insert` (now
`insertRootStep`): `grep -rn "\.insert(" backend/src/main` shows only
`insertInternal`/`insertInternalAction`/`insertAtInternal` callers, never the
bare `insert`. Independently reconfirmed by re-deriving the census from every
`stepRepo\.insert(` / `pipelineStepRepo\.insert(` occurrence (word-boundary,
alias-independent) and cross-checking the count against
`PipelineStepRepository`'s only other test-tree binding aliases (`repo` in
`PipelineStepRepositoryTreeOrderingSpec`, `mkPipelineStepRepo` in
`DashboardPanelAclSpec` — neither calls `insert`). Per D4/task 1.2, the
authoritative completeness proof is the compiler: after the rename, `sbt
Test/compile` succeeded cleanly with zero leftover references to the old
`insert` signature — see Gates section.

## Per-call-site audit (33 rows)

Legend: **C** = chained (corrected to `insertInternal(..., parentStepId=
Some(...))`), **R** = legitimately root (rename-only, topology unchanged),
**T** = topology-independent (single step; rename-only).

### `PipelineRunRoutesSpec.scala` (12 sites)

| Line | Test | Steps | Determination | Evidence |
|---|---|---|---|---|
| 424 | preview returns first 10 rows for a valid step | 1 | T | single `insertRootStep`, no topology claim |
| 455 | preview 200 for healthy rest_api source | 1 | T | single step |
| 468 | preview only applies steps up to and including the target step | 2 | **C** | test name asserts a prefix-exclusion property; `select` (target) must precede `limit` in the trunk so `limit` is excluded from the prefix |
| 469 | (same test, second insert) | — | **C** | `limit` becomes the CHILD of `select` (insertion order preserved as trunk order per D1) |
| 544 | preview excludes a disabled step from the executed prefix | 2 | **C** | "executed prefix" presupposes a trunk; disabled `limit` must be an ANCESTOR of `select` |
| 545 | (same test, second insert) | — | **C** | `select` becomes the CHILD of the disabled `limit` |
| 559 | preview 422 when target step is disabled | 1 | T | single step |
| 600 | run failure via bad join, step-attributed errorLog | 1 | T | single step |
| 623 | run failure via unsupported stringops | 1 | T | single step |
| 716 | run failure sets last_run_status failed, 422 naming step | 1 | T | single step |
| 876 | SSE queued→running→failed naming failing step | 1 | T | single step |
| 952 | run failure invokes no alert evaluation | 1 | T | single step |

(The file's two `insertInternal(..., parentStepId=...)` chained tests at
~line 499/524, "per-step row counts keyed by step id", pre-date this ticket —
built during HEL-922 — and are unaffected; not part of the 33 `insert(`
sites.)

### `PipelineAnalyzeRoutesSpec.scala` (12 sites)

| Line | Test | Steps | Determination | Evidence |
|---|---|---|---|---|
| 151 | 200 with correct schemas for a select step | 1 | T | single step |
| 171 | 200 for splittext (regression) | 1 | T | single step |
| 191 | 200 for extractheadings (regression) | 1 | T | single step |
| 211 | 200 for chunkbytokencount (regression) | 1 | T | single step |
| 234 | 200 excluding a disabled step from the response entirely | 2 | **C** | test's own comment: "The disabled rename never ran, so `order_id` (not `id`) is what flows into the surviving select step's input schema" — asserts flow-through, requires a trunk |
| 235 | (same test, second insert) | — | **C** | `select` becomes the CHILD of the disabled `rename` |
| 341 | validationError naming unsupported aggregate function | 1 | T | single step |
| 360 | validationError naming unsupported groupby function | 1 | T | single step |
| 379 | validationError naming unsupported pivot function | 1 | T | single step |
| 398 | validationError naming unsupported union mode | 1 | T | single step |
| 417 | validationError naming unsupported join type | 1 | T | single step |
| 449 | single validationError joining two independent failures | 1 | T | single step |

### `PipelineStepRepositorySpec.scala` (7 sites)

| Line | Test | Steps | Determination | Evidence |
|---|---|---|---|---|
| 117 | preserve full typed configs round-tripping through insert + listByPipeline | 1 | T | single step |
| 144 | insert with enabled=false persists a disabled step | 1 | T | single step |
| 159 | update toggles enabled and leaves it unchanged when omitted | 1 | T | single step |
| 182 | listByPipeline returns empty vector for a non-owner | 1 | T | single step |
| 189 | findById returns None for a non-owner | 1 | T | single step |
| 196 | update returns None and does not mutate for a non-owner | 1 | T | single step |
| 211 | delete returns false and leaves the row for a non-owner | 1 | T | single step |

All 7 are single-step ACL/CRUD tests; this file's two multi-row tests
("decode rows for every step kind…") use `insertRawStep` raw SQL, not this
method, so they are outside the 33-site census entirely.

### `WorkspaceContextServiceSpec.scala` (2 sites)

| Line | Test | Steps | Determination | Evidence |
|---|---|---|---|---|
| 346 | report each step's outputColumns in step order, from the analyze path | 2 | **C** | comment: "A select then a rename step give distinct, order-verifiable outputs"; asserts `steps(1).outputColumns shouldBe Vector("renamed")`, which presupposes rename is the trunk's second step |
| 347 | (same test, second insert) | — | **C** | `rename` becomes the CHILD of `select` |

**Total: 33 sites, 4 tests / 8 sites corrected to `insertInternal`, 25 sites
rename-only.**

## Mutation evidence (D2/D2a)

For each corrected test: the assigned/justified production-code mutation,
whether it was capable of failing the assertion (D2a precondition), and the
recorded outcome under OLD (parallel-root) and NEW (corrected trunk)
topology. All mutations were reverted after recording; `sbt test` was rerun
green afterward (see Gates).

### 1. `PipelineRunRoutesSpec` 468/469 — "preview only applies steps up to and including the target step"

**The recorded mutation is a COMPOUND break of two independent mechanisms.
Neither half alone is red under either topology — both halves have been
measured, not assumed.**

Design.md proposed widening `PipelineRunService.scala:403`'s `slicedSteps =
pathToRoot(target, Vector(target))` to the pipeline's full step list, alone.
Applying exactly that (`val slicedSteps = sortedSteps`, nothing else changed)
left the test **GREEN under both topologies** (measured here: `sbt testOnly
... -z "only applies steps up to"` → `succeeded 1, failed 0` in both cases;
independently reproduced by the final-gate skeptic, who additionally ran the
**full 3606-test backend suite** with this same widen-alone mutation in
place and found it **entirely green** — see the coverage-hole note below).
Root cause, located by reading the response-construction code at line 423:
`val targetRows =
outcome.nodeOutcomes.get(Some(target.id.value)).map(_.rows).getOrElse(outcome.rows)`
— the response reads the target step's OWN node-keyed outcome, not the
executed set's terminal frame. Widening `slicedSteps` changes which OTHER
nodes get evaluated, but `select`'s own recorded row count is unaffected by
whatever downstream nodes were also present, in *either* topology, because
this node-keyed lookup (HEL-905/CR1) is a separate, already-existing
mechanism that fully masks the widen from this assertion. **This is a
substantive coverage finding about the prefix-slicing mechanism, not a
measurement error about the test** — the assertion genuinely cannot observe
`previewAtNode`'s prefix walk while the node-keyed lookup is intact. (An
earlier draft of this report mischaracterised the widen-alone green result
as "a genuine measurement error"; that characterisation is retracted.)

The evaluator separately measured the OTHER half in isolation
(`evaluation-1.md`): dropping the node-keyed lookup alone (`val targetRows =
outcome.rows`, keeping `slicedSteps` as the correct `pathToRoot`) is **also
green under both topologies** — with the correct prefix already `[select]`
only, reading the trunk's terminal frame instead of the node-keyed lookup
changes nothing, since `select` is both the terminal step and the target in
that slice.

**The mutation actually recorded and run below combines both halves**
(widened `slicedSteps` AND `val targetRows = outcome.rows`) — this compound
break is what was red/green-tested, not either mechanism independently:

- New topology + compound mutation: **RED** — `1 was not equal to 2`
  (`PipelineRunRoutesSpec.scala:473`).
- Old topology + compound mutation: **GREEN** (`succeeded 1, failed 0`).
- **Bucket 1 (by the literal definition: green under old+mutation, red under
  new+mutation) — but qualified: the assertion is guarded only by the
  CONJUNCTION of the prefix walk (`PipelineRunService.scala:403`) and the
  HEL-905 node-keyed lookup (`PipelineRunService.scala:423`) together. It
  does NOT independently guard the prefix-slicing mechanism — see the
  coverage-hole note below for that mechanism's actual (unguarded) status.
  Contrast with tests 2 and 4 below, which ARE unqualified bucket 1: a
  single mechanism each, genuinely closed.**

**Coverage hole, measured and disposed of (not a product defect).** Because
neither half of the compound mutation is independently observable by this
test (or, per the skeptic's full-suite run, by ANY test in the 3606-test
backend suite), `previewAtNode`'s prefix-slicing mechanism at
`PipelineRunService.scala:403` has **no suite-wide guard**: the entire
backend suite stays green with `slicedSteps` widened to every step in the
pipeline instead of just the target's ancestor path. This is not a product
defect (D3 case (b) does not apply — the production behavior itself is
correct, per the HEL-905 node-keyed lookup covering the response
correctness for the fixtures exercised so far) but it is a real, measured
absence of coverage for that specific mechanism, surfaced by this audit.
**Disposition: filed as HEL-957** ("previewAtNode's prefix-slicing at
PipelineRunService.scala:403 has no suite-wide guard", High) — not deferred.
A reasoned deferral was considered and rejected: this ticket's deliverable
IS the audit, so quietly deferring the one hole the audit itself found would
make the audit look cleaner than it actually is. HEL-957's fix direction: a
test whose target step sits on a TAIL branch (not the trunk root, unlike
every fixture in this file today) would force `pathToRoot` to return a
strict ancestor subset, making the node-keyed lookup unable to mask a
widened prefix, and would close this gap directly. Mechanism and location
for that ticket: `PipelineRunService.previewAtNode`,
`PipelineRunService.scala:403` (`slicedSteps = pathToRoot(...)`), currently
reachable only via `GET /pipelines/:id/steps/:stepId/preview`.

**Near-miss narrative (kept in the permanent record, not just the
orchestration thread — the lesson is transferable).** This compound-break
finding was caught on the THIRD look, not the first:

1. The orchestrator flagged, before any measurement, that the 468/469
   mutation touches two mechanisms at once (the prefix walk and the
   node-keyed lookup) and asked whether "was-vacuous, now-guarded" was
   actually safe to record.
2. The evaluator tested ONE leg — dropping the node-keyed lookup alone
   (`val targetRows = outcome.rows`, correct `slicedSteps` left in place) —
   found it green under both topologies, and on that basis concluded the
   bucket-1 label stood.
3. Neither the executor (who first ran the compound mutation and recorded
   the result) nor the evaluator ran the OTHER leg — widening `slicedSteps`
   alone, correct `targetRows` lookup left in place. The final-gate skeptic
   did, found it green on the target test AND across the full 3606-test
   suite, and that is how this coverage hole actually surfaced.

The transferable form: **each reviewer tested the leg they individually
thought of, and none tested both legs of the same conjunction independently
before this ticket's own final gate.** The multi-stage review process did
catch it — but only at the third, most adversarial layer, not the first two.
That gap between "caught eventually" and "caught early" is itself worth
remembering: a compound mutation's two halves need to each be probed in
isolation before either is trusted to characterize a "was vacuous"
classification, not just reasoned about from one side.

### 2. `PipelineRunRoutesSpec` 544/545 — "preview excludes a disabled step from the executed prefix"

Assigned target confirmed as specified: `InProcessPipelineEngine.scala:325`
`if (step.enabled) evalOneStep(...) else Future.successful(currentRows)`,
mutated to `evalOneStep(currentRows, step, ctx)` unconditionally (execute
disabled steps in place).

- New topology (limit ancestor, disabled; select child) + mutation: **RED** —
  `1 was not equal to 2` (`PipelineRunRoutesSpec.scala:551`).
- Old topology (both roots) + mutation: **GREEN** (`succeeded 1, failed 0`).
- **Bucket 1: was-vacuous, now-guarded.** Matches design's D2 prediction
  exactly — this is the fixture where the prefix-walk mutation (used for
  468/469) is structurally a no-op (select, the target, IS the leaf, so
  `pathToRoot` already equals the full step set under both shapes); the
  in-place disabled-skip is the actual mechanism this test covers, confirmed
  by probe.

### 3. `PipelineAnalyzeRoutesSpec` 234/235 — "return 200 excluding a disabled step from the response entirely"

Assigned target confirmed: `PipelineService.scala:408` `val steps =
allSteps.filter(_.enabled)`, mutated to `val steps = allSteps` (drop the
filter).

- New topology (rename ancestor, disabled; select child) + mutation: **RED**
  — `resp.steps` had size 2 instead of expected size 1
  (`PipelineAnalyzeRoutesSpec.scala:241`).
- Old topology (both roots) + mutation: **RED** — same `size 2` failure at
  the same assertion, with the disabled `rename` and enabled `select` both
  appearing as independent root steps in the response.
- **Bucket 3 at test granularity: already guarded, red under both
  topologies.** Confirms design.md's round-5 refinement exactly: the
  `resp.steps should have size 1` assertion is the FIRST assertion in the
  block and fails under the mutation regardless of topology (the disabled
  step surfaces in the response either way once the filter is dropped) —
  this half of the test guards the enabled-filter independently of chaining,
  and was never one of this ticket's blind gates.
- **The `inputSchema ... contain allOf` assertion (the bucket-1 half design
  predicted) is REFUTED as unobservable**, exactly as design.md's round-5
  refinement anticipated: ScalaTest short-circuits the `check` block at the
  first failed assertion (`size 1`), so the `inputSchema` line never
  executes under this mutation in either topology. Refuting the prediction
  is the correct, successful outcome per task 4.5 — not grounds to switch
  mutations.

### 4. `WorkspaceContextServiceSpec` 346/347 — "report each step's outputColumns in step order, from the analyze path"

**Design's assigned target ("locate the outputColumns derivation, justify it
per D2a") required investigation, and the first candidate found was also
inert — a second, genuine mismatch from the design's own prediction, caught
before recording per D2a's precondition.**

First candidate: `PipelineAnalyzeService.analyze`'s sequential schema
threading (`currentSchema = output` after each step,
`PipelineAnalyzeService.scala` ~140), mutated to never advance (every step's
`inputSchema` stays the source schema). Applied and run under the corrected
topology: **GREEN**, no failure at all. Root cause: this fixture's source
schema is a single column `[value]`, and the `select` step
(`SelectConfig(Vector("value"))`) is a schema-identity no-op on it — its
output equals its input exactly, so whether `rename`'s input is "select's
real output" or "the raw source schema" is the SAME value (`[value]`) either
way. No assertion in this test can distinguish those two states for this
fixture; the mutation was inert, not a finding. Per D2a, corrected the
target rather than recording a false "still topology-insensitive" result.

**Corrected mutation, targeting the actual property under test** (the test's
own name: "in **step order**"): `PipelineStepRepository.executionOrder`'s
`walk` (`PipelineStepRepository.scala:768-772`), which normally emits
`node +: (tails ++ trunkChild.flatMap(walk))` (parent before its trunk
continuation). Mutated to `(tails ++ trunkChild.flatMap(walk)) :+ node`
(parent emitted AFTER its trunk continuation — reverses trunk order).

- New topology (select ancestor, rename child) + mutation: **RED** —
  `Vector(Vector("renamed"), Vector())` was not equal to
  `Vector(Vector("value"), Vector("renamed"))`
  (`WorkspaceContextServiceSpec.scala:363`). (The empty second entry is a
  second-order effect: with steps reordered to `[rename, select]`, the flat
  `analyze` threads schemas in THAT order — `rename` runs first against the
  source `[value]` producing `[renamed]`, then `select(fields=["value"])`
  runs against `[renamed]` and matches nothing, producing `[]`. This
  confirms the mutation genuinely broke ordering, not just relabeled it.)
- Old topology (both roots, `select` position 0, `rename` position 1) +
  mutation, using the OLD test's own original expectations (`position`
  `Vector(0, 1)`, `outputColumns` unchanged) to isolate the mutation's
  effect from the (expected, separate) position-value change: **GREEN**.
  Root cause: for two ROOT siblings, `walk`'s reversal is a no-op — a root
  step has no children of its own in the parallel-root shape, so
  `tails=[]`, `trunkChild=None`, and `(tails ++ None) :+ node == Vector(node)`
  regardless of the reversal; the two roots' relative order comes entirely
  from `rootTrunk.flatMap(walk) ++ rootTails`, unaffected by the mutation.
- **Bucket 1: was-vacuous, now-guarded.** The step-ORDER claim in this
  test's name genuinely was untested before this ticket (order coincided
  with insertion order for two roots regardless of any mutation to
  trunk-depth traversal), and is genuinely guarded now that a real 2-deep
  trunk exists.

## D3 diagnosis — reds from the topology correction itself (tasks 5.1-5.4)

Applying the topology correction alone (no mutation) produced exactly ONE
red assertion, anticipated by design.md:

- **`PipelineRunRoutesSpec` 468/469 and 544/545 `rowCount shouldBe 2`:**
  confirmed to remain **2** after correction (task 5.3) — neither test went
  red from the topology fix alone. This is the expected direction of travel
  per design.md D3: `select` does not change row count, and the
  excluded/disabled `limit(1)` correctly does not apply either way.
- **`WorkspaceContextServiceSpec` 346/347 `steps.map(_.position)`:**
  confirmed **RED** as predicted — `Vector(0, 1)` → would-be `Vector(0, 0)`
  under the literal `position` field. **Case (a)**, not (b): read
  `PipelineStepRepository.insertInternalAction` (`position = maxPos.getOrElse(0)
  + 1`, scoped via `siblingsQuery(pipelineId, parentStepId)` — siblings under
  the SAME parent), confirming `position` is a per-parent tiebreaker, not a
  global order index; a two-step trunk genuinely gets `(0, 0)`, by design,
  not a bug. Separately confirmed `WorkspaceContextService.assemble`'s
  ordering does NOT come from `position` at all: `toStepEntry`
  (`WorkspaceContextService.scala:276-281`) maps over
  `pipelineService.analyze(...).steps` in the order `PipelineAnalyzeService.analyze`
  returned them, which threads `allSteps` from
  `PipelineStepRepository.listByPipelineInternal` →
  `executionOrder` (`PipelineStepRepository.scala:747-772`) — a tree walk
  that places a trunk child immediately after its parent regardless of the
  `position` values on either node (traced and confirmed correct for the
  2-step `select → rename` trunk in this file's own scaladoc, lines ~146-159:
  "ordering is derived from the `parent_step_id` chain … NOT from a global
  `position` sort"). Per D3(a): the OLD `Vector(0, 1)` expectation described
  the parallel-root shape and was never a meaningful ORDER assertion in the
  first place (two root siblings' positions happen to look sequential); the
  test is corrected to assert `position` as `Vector(0, 0)` (the true, correct
  per-parent value) and to re-express the actual ordering claim against
  `entry.steps.map(_.outputColumns)` (`Vector(Vector("value"),
  Vector("renamed"))`), which is the field genuinely carrying order. "Updated
  to `Vector(0, 0)`, suite green" alone (without this re-expression and
  without the code citations above) is exactly the unacceptable resolution
  design.md warned against; task 4's mutation evidence above (test 4) is what
  proves the re-expressed ordering claim actually MEANS something now.
- **No case (b) product defect was found anywhere in this ticket.** No STOP/escalation is warranted.

## AC4 — explicit answer (D5, "Report whether any audited test was actually asserting something that only holds for one topology")

**Yes — for the 4 corrected tests, in the specific sense the mutation
evidence demonstrates:**

- `PipelineRunRoutesSpec` 544/545 and `WorkspaceContextServiceSpec` 346/347
  each asserted a property that was **true for free** under the old
  parallel-root topology (unqualified bucket 1: green under old-topology + a
  single justified production-code break), and is now genuinely exercised
  under the corrected trunk topology (red under new-topology + the same
  break). These two were real blind gates, exactly the failure mode this
  ticket exists to close.
- `PipelineRunRoutesSpec` 468/469 is bucket 1 by the same green/red pattern,
  but **qualified, not unqualified**: the recorded break is a COMPOUND of two
  independent mechanisms (the prefix walk at `PipelineRunService.scala:403`
  and the HEL-905 node-keyed lookup at `:423`), and neither mechanism alone
  is red under either topology (both measured — see test 1 above). So this
  test now guards the CONJUNCTION of the two mechanisms, but does not
  independently guard the prefix-slicing mechanism itself, which — per the
  measured coverage hole above (full 3606-test suite green with the prefix
  walk alone broken) — remains genuinely unguarded suite-wide. Reporting
  this as an unqualified "now genuinely exercised" would itself be exactly
  the confidently-worded, false coverage claim this ticket exists to
  prevent; the qualified statement above is the accurate one.
- `PipelineAnalyzeRoutesSpec` 234/235's `resp.steps should have size 1`
  assertion was **already guarded independently of topology** (bucket 3 —
  red under both shapes for the enabled-filter mutation); it was never one
  of this ticket's blind gates, and is reported as such rather than folded
  into the was-vacuous bucket. Its `inputSchema` companion assertion is
  unobservable under the assigned mutation (short-circuited by ScalaTest at
  the preceding `size 1` failure); by separate inspection it is
  **not topology-dependent** regardless — the disabled `rename` is filtered
  out of `steps` before schema threading begins in BOTH shapes
  (`PipelineService.scala:408`'s `.filter(_.enabled)` runs before the
  `stepInputs`/`analyze` call in either topology), so `select`'s
  `inputSchema` is the source schema either way.
- **None of the 25 single-step (rename-only) call sites assert anything
  topology-dependent** — by construction, a single step has no distinction
  between "root" and "chained" (there is no ancestor either way), so this is
  the expected, uninteresting negative case for those sites, stated outright
  per D5 rather than left implicit.
- **No genuine product defect (D3 case (b)) was found — no spinoff ticket
  for a code defect.** But see the coverage hole recorded under test 1
  above: `PipelineRunService.previewAtNode`'s prefix-slicing mechanism
  (`PipelineRunService.scala:403`) has no suite-wide guard, independent of
  this ticket's topology fix. That is a real, measured coverage gap (not a
  defect), and it is **filed as HEL-957** rather than deferred — see test 1
  above for the disposition reasoning and the near-miss narrative behind how
  this gap was actually found.

## Trap disarmed (AC3, D4, task 6)

`PipelineStepRepository.insert` renamed to `insertRootStep`
(`PipelineStepRepository.scala:82`); scaladoc rewritten to state it creates a
ROOT branch and that `insertInternal(..., parentStepId = ...)` is how to
chain. No defaulted `parentStepId` was added (confirmed by reading the new
signature: `insertRootStep(pipelineId: PipelineId, kind: String, config: Any,
user: AuthenticatedUser, enabled: Boolean = true)` — no `parentStepId`
parameter at all, defaulted or otherwise). All 33 call sites across the four
test files were updated to `insertRootStep`; a clean `sbt Test/compile` (see
Gates) is the completeness proof per task 1.2/6.2, since `insert` has zero
production callers and the compiler therefore catches every leftover
reference. The HEL-922 warning comment near `PipelineRunRoutesSpec.scala:485`
was rewritten (not deleted) to name `insertRootStep` instead of the retired
`insert`.

**Privilege-context note (visible, not incidental).** The 4 corrected call
sites moved from `insertRootStep(..., dummyUser)` / `insertRootStep(...,
userA)` (an owner-scoped, RLS user-context write via
`ctx.withUserContext`) to `insertInternal(...)` (ACL-bypassing, run under
`ctx.withSystemContext`) as part of switching to the chaining-capable
writer. No coverage is lost by this: `PipelineStepRepositorySpec`'s
untouched non-owner ACL tests (lines 182-211, none of which were in the
corrected set) still cover insert-time ACL behavior for the plain
`insertRootStep` path. Flagging it here so the privilege-context change is
on the record rather than silent.

## Gates (task 8)

- `sbt Test/compile`: clean, zero errors (rename completeness proof).
- `sbt test`: **3606/3606 tests passed**, 240 suites, 0 failed, 0 canceled.
  `Run completed in 4 minutes, 0 seconds. ... All tests passed. [success]
  Total time: 242 s`.
- `node scripts/check-scala-quality.mjs`: `Scala code-quality check: clean
  (146 soft warning(s))` — all 146 warnings are pre-existing file-length soft
  budgets on files this change did not touch; no new violation, no inline
  fully-qualified names introduced.
- Diff scope: exactly the 5 source files named in the proposal's Impact
  section (`git diff --stat` against the working tree) plus this change
  directory. No `.png` files touched, no edits under `.concertino/**`.

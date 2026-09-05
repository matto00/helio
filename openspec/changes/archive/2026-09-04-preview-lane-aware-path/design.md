## Context

Base: `8bb88c0e` (all of Phase 2 merged — HEL-911 engine, HEL-912 editor, HEL-913 multi-root, HEL-914 MCP).

`PipelineRunService` contains two byte-identical local helpers:

```scala
def pathToRoot(step: PipelineStep, acc: Vector[PipelineStep]): Vector[PipelineStep] =
  step.parentStepId.flatMap(p => byId.get(p.value)) match {
    case Some(parent) => pathToRoot(parent, parent +: acc)
    case None         => acc
  }
val slicedSteps = pathToRoot(target, Vector(target))
```

at `PipelineRunService.scala:504` (inside `previewStep`) and `:663` (inside `evaluateNodeRowsForBackfill`). The ticket
calls these `previewAtNode`/`previewOutputs`; those names do not exist on main. The defect is exactly as described,
at the two sites above.

### Ground truth established during planning

1. **The 422 is produced by a membership check against the slice itself.** `InProcessExecutionBackend.execute` does not
   re-derive anything from the vector it is handed; it forwards it to `executeTree`, which builds `byId`/`laneDep`/`ranks`
   *purely from that vector* and never looks outside it. So a missing lane step trips the pre-walk guard at
   `InProcessPipelineEngine.scala:386`:

   ```scala
   else if (!byId.contains(dep))
     Some(LaneReferenceError(s"Step '${s.id.value}' references lane step '$dep', which does not exist in this pipeline."))
   ```

   `PipelineService.classifyDbError:2290` maps `LaneReferenceError` to `ServiceError.UnprocessableEntity` — the 422.
   Note the message is **actively misleading**: the lane step *does* exist in the pipeline; it is missing from the slice.
   That wording is correct for the run path (where the vector is the whole pipeline) and wrong only for preview, which is
   itself evidence that the slice, not the guard, is the defect.

2. **The engine's edge set is parent + lane, transitively.** `executeTree` (`:342-475`) is a Kahn walk whose readiness
   predicate is both edges:

   ```scala
   def isReady(s: PipelineStep): Boolean =
     evaluatedIds.contains(parentKey(s)) &&
       laneDep.getOrElse(s.id.value, None).forall(dep => evaluatedIds.contains(StepKey(dep)))
   ```

   `laneDependencyOf` (`:114-118`) is the predicate that reads `SecondaryInput.Lane` off `JoinStep`/`UnionStep`/`LookupStep`.

3. **`PipelineAnalyzeService.analyzeNodes` (`:255-301`) already does the right thing** — a Kahn pass honouring both
   `parentStepId` and `laneDependencyOf`, with a comment documenting the generalisation away from a naive parent walk.
   Analyze is *not* affected by this defect. It is the in-repo model for the fix.

## Decisions

### D1 — The divergence is real, and it is resolved in the engine's favour

The ticket asked that, if the engine and preview disagree about what a path *is*, that divergence be named rather than
papered over. It does, and here it is stated precisely:

| | **The engine's notion** | **`pathToRoot`'s notion** |
|---|---|---|
| What it is | the set of nodes that must be evaluated before the target — a **dependency closure** over parent edges *and* lane edges | the **linear ancestor chain** of the target over parent edges only |
| Shape | a sub-DAG; may branch and re-merge | a single path; cannot branch by construction |
| Written when | HEL-911, against the multi-lane DAG | pre-Phase-2, when every node had exactly one ancestor chain |

`pathToRoot` is not a *broken implementation of the engine's notion*; it is a faithful implementation of a **different,
now-obsolete notion**. Its own surrounding comment still says so — "the path from the pipeline root to the target step,
following whichever branch (trunk or the specific tail chain) the target actually sits on". That was true and correct in
P1.2. The DAG made it false.

**Resolution: the engine's notion is authoritative, and preview adopts it.** Preview does not get to define what a node
depends on — the thing that will actually execute the slice does. The correct output of the helper is therefore a **set**
(the closure), not a path, and the fix must change its return contract accordingly rather than "also following lane edges"
inside a path-shaped recursion.

**Corollary — ordering is not preview's job, and must not be re-imposed.** `executeTree` topologically sorts whatever
vector it receives (ground truth 2). Today `pathToRoot`'s accumulator order happens to be valid, so it is invisible that
preview is asserting an order at all. A closure over a branching sub-DAG has no single natural linear order, and any that
preview invented would be a second ordering authority that can drift from `structuralRank`. The helper therefore emits the
closure in a deterministic-but-semantically-irrelevant order (repository execution order, filtered) and lets the engine
order it. This is the D1 decision that most easily gets implemented wrong.

### D2 — One helper, both call sites, placed with the engine

`evaluateNodeRowsForBackfill` holds a *copy* of the defect, and it is the worse of the two: it does not merely fail to
render a preview, it calls `persistBackfilledRows` with the rows it computed. Under the current code a rejoin backfill
raises `LaneReferenceError`, which is swallowed by the site's own `.recover { case ex => log.error(...) }` — so today it
fails silently to a log line rather than persisting wrong rows. That is luck, not design: the guard that turns the
truncated slice into an exception is the engine's, and the recover arm is broad. Both sites take the same helper.

**Placement: alongside the engine, not in `PipelineRunService`.** The helper's correctness is defined entirely by the
engine's edge set, and it must reuse `InProcessPipelineEngine.laneDependencyOf` (already `private[engine]`). The helper SHALL be at least `private[engine]`, not `private`, so task 2.6 can unit-test it directly from `com.helio.domain.engine` rather than only through the service. A helper
living in the service that reaches into the engine for its predicate would put the definition of "depends on" in one
package and its only consumer in another — exactly the drift that produced this ticket. Executor may site it as a small
object in `com.helio.domain.engine` (e.g. `NodeDependencyClosure`) or as a companion method on
`InProcessPipelineEngine`; that choice is the executor's, but the package is not.

### D3 — Not merged into `RuntimeGraphPath`, and why

`RuntimeGraphPath` is lane-aware and superficially adjacent, but it answers a **different question**: "what is the
canonical *display* path to this node", singular, lowest-positioned-root-wins (R5). It deliberately picks *one* route and
discards the others. A dependency closure must keep *all* of them. Folding one into the other would force
`RuntimeGraphPath` to stop discarding, which would change the rendered lane-path format that HEL-913 R5 pins and HEL-914
consumes. Out of scope, and would be a contract change affecting shipped tickets.

**Reported, not fixed:** `RuntimeGraphPath`'s scaladoc claims it follows a lane dependency held by the step "or,
transitively, a step in its own chain", but `pathOf` consults `laneDep` for the **target step only** — one level, not
transitive. Either the doc overstates the code or the code under-delivers the doc. It affects a rendered error-message
path, not correctness of execution, and it is not this ticket's defect. The executor SHALL NOT fix it here; it is to be
raised as a follow-up at Delivery.

### D4 — What "prove it" means here

Acceptance criterion 2 is the one that decides whether this ticket actually shipped. A test that asserts the helper
returned a non-empty vector, or that the call did not 422, proves nothing about correctness — a closure that over-includes
(e.g. "just pass every step in the pipeline") also returns 200, and would pass such a test while silently making preview
mean something different from `/run`.

The binding test shape is therefore: build a fixture with two lanes and a rejoin; execute the node via the **real run
path**; execute the same node via **preview**; assert the produced rows are equal, field for field, and that the rejoin's
rows actually reflect both lanes (i.e. contain at least one column contributed only by the secondary lane, with the
expected value). Equality against an independently-computed literal is required for at least one case, so the test cannot
pass by both paths being wrong in the same way.

Over-inclusion is separately fenced by the "sibling lanes not referenced by the target are excluded" scenario — without
it, the trivially-wrong fix is green.

### D5 — A closure may span roots, and `roots` must NOT be narrowed (round-1 CR1)

A lane reference is validated **pipeline-scoped, never root-scoped** (`PipelineService`'s `validateLane` /
`validateStepCrossOwnerRefs` constrain existence, self-reference and ancestry — nothing about root membership). Under
HEL-913 multi-root, a rejoin under root A may therefore legally consume a lane under root B, and this change's closure
will span both. Three facts govern that case, traced at the call sites:

1. **Both call sites MUST keep passing the FULL `roots` vector.** Narrowing `roots` to the target's own root looks
   like a natural companion optimisation — and `evaluateNodeRowsForBackfill`'s *root-bound* branch legitimately does
   exactly that via `explicitRootId` (`PipelineRunService.scala:640-647`). On the step-bound branch it is **silent
   corruption, not a loud failure**, which is why this decision exists and why the test for it must assert on row
   values rather than on an error.

   The mechanism (round-2 CR1 — an earlier draft of this decision claimed a `LaneReferenceError`, which the code does
   NOT produce): `InProcessExecutionBackend.execute` carries a single-root shortcut,

   ```scala
   if (roots.size == 1) {
     val onlyRootId = PipelineRootId(roots.head._1)
     Future.successful(steps.filter(_.parentStepId.isEmpty).map(_.id -> onlyRootId).toMap)
   } else stepRepo.rootIdsOf(pipeline.id)
   ```

   Narrowing to the target's own root necessarily yields `roots.size == 1`, so `rootIdOfStep` is rebuilt **from the
   slice** and *every* parentless step in it — including the foreign root's lane step — is remapped to the surviving
   root. `executeTree`'s `parentKey` then returns `RootKey(A)`, which is seeded and is in `evaluatedIds`. The walk does
   not fail. It evaluates root B's lane against **root A's rows** and returns `200` with wrong data. No error message
   is ever produced, so no assertion on one can catch it.

   **Consequence for testing:** the cross-root fixture's two roots MUST carry **distinguishable source data**, or the
   corrupt implementation yields the same rows as the correct one and the test is evidence-shaped non-evidence.

   **Consequence for fixture construction:** a genuine two-root graph takes the `else stepRepo.rootIdsOf(pipeline.id)`
   branch, which is a live DB query (`ctx.withSystemContext`, `PipelineStepRepository.scala:859`). The cross-root test
   therefore **cannot** use the `PipelineStepRepository(null)` / in-memory-steps fixture style the single-root engine
   tests rely on; it needs a DB-backed pipeline with real `root_id`s. Recorded here so it is met as a known
   requirement rather than discovered as an NPE mid-implementation and quietly downgraded to a single-root test.
2. **The target's rows come from `outcome.nodeOutcomes.get(StepKey(target.id.value))`, not `TreeWalkResult.rows`.**
   Under multi-root, `rows` is the lowest-positioned root's trunk-terminal frame (HEL-913 R10); both sites already read
   `nodeOutcomes` first and fall back to `rows` only when the target *is* that terminal. That existing shape is correct
   for a cross-root closure and must be preserved, not "simplified".
3. **`explicitRootId` governs only the root-bound (`targetStepId.isEmpty`) branch** of
   `evaluateNodeRowsForBackfill`. On the step-bound branch this change touches it stays `None` — the existing comment at
   the `persistBackfilledRows` call already states this, and it remains true.

### D6 — `stepCounts` cover the whole executed closure (round-1 CR2)

`previewStep` returns `outcome.stepCounts` on the wire in `RunResultResponse`. Today those counts cover only the
target's ancestor chain; after this change a rejoin preview's counts will additionally contain every step of the
referenced lane. **Ruling: that is correct and intended — the counts are per-node counts of nodes that genuinely
executed, and suppressing the lane's entries would report a rejoin as having produced rows from inputs the response
claims never ran.** It is stated here, in the spec delta, and asserted in tests rather than left to emerge as an
unremarked wire change, because criterion 5's parity test covers lane-free graphs only and would not catch it.

## Risks / Trade-offs

- **Over-inclusion is the likely wrong fix**, and it is green under a naive test. Fenced by the exclusion scenario and by
  the run-vs-preview equality assertion, not by review attention.
- **Diamonds must not duplicate.** A lane consumed by two rejoins is legal (HEL-911 Decision 3). A closure built by naive
  concatenation of chains will contain such a step twice; `executeTree` builds `byId` as a `Map`, so duplication may not
  even fail loudly — it could silently double-evaluate. The closure must be de-duplicated by step id, and there is a
  scenario for it.
- **Parity.** For any graph with no lane reference the closure is exactly the old ancestor chain, so output must be
  byte-identical. This is a required test (criterion 5), matching the parity discipline HEL-911 Decision 2 established.
- **Cycles.** The closure walk must terminate on data that reached the table by some path the write-time cycle guard did
  not cover — HEL-911 contract item 7 requires the run-time arm precisely because such data is assumed possible. A
  visited-set fixed-point iteration gives this for free; a naive recursion does not.
- **Disabled nodes.** HEL-911 contract item 9: a disabled node is transparent and a lane reference to one resolves to its
  passed-through incoming frame. The closure must therefore still *include* a disabled lane-referenced node and its
  ancestors — excluding it would remove the frame the rejoin reads. The existing site already deliberately does not
  pre-filter disabled ancestors; that behaviour is preserved, not revisited.

## Constraints inherited from the run context

No Flyway migration (shared dev Postgres, three parallel runs) — this change needs none. No browser/Playwright (a sibling
run owns the session) — coverage is backend ScalaTest, which is the right level for the defect anyway. Sibling-owned files
(`RestApiConnectorDriver`, `SchemaInferenceEngine`, `InProcessPipelineEngine.loadCsvRowsFromBytes`, the river editor
frontend) are untouched; note that `loadCsvRowsFromBytes` lives in the same file this change adds a helper near, so the
executor must keep edits away from it.

## Open Questions

None. The one judgement call (helper object/method name within `com.helio.domain.engine`) is delegated to the executor by D2.

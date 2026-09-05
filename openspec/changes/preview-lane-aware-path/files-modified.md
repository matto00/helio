# Files modified — HEL-970

## Source

- `backend/src/main/scala/com/helio/domain/engine/NodeDependencyClosure.scala` (NEW) — the
  shared dependency-closure helper (design.md D1/D2), replacing both `pathToRoot` copies. Given
  the pipeline's full step vector and a target step, returns the target's transitive dependency
  closure over `parentStepId` edges AND `InProcessPipelineEngine.laneDependencyOf` lane edges, to
  a fixed point. Public (broader than the design's "at least `private[engine]`" floor) so
  `PipelineRunService`, in a different top-level package, can call it. De-duplicated by step id
  (diamonds), terminates on cyclic input (visited-set fixed point), does not pre-filter disabled
  steps, and emits the closure in the input vector's own (repository execution) order rather than
  imposing an evaluation order.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — both
  `pathToRoot` copies (`previewStep` at the former `:504`, `evaluateNodeRowsForBackfill` at the
  former `:663`) deleted and replaced with `NodeDependencyClosure.closureOf(...)` calls. Added
  `NodeDependencyClosure` to the existing `com.helio.domain.engine` import. No other behavior at
  either call site changed — both continue to pass the FULL `roots` vector (unnarrowed, per
  design.md D5) and to read target rows from `outcome.nodeOutcomes.get(StepKey(...))` with the
  existing `outcome.rows` fallback (design.md D5 facts 2/3, unchanged).

## Tests

- `backend/src/test/scala/com/helio/domain/engine/NodeDependencyClosureSpec.scala` (NEW) — direct
  unit coverage of the helper (task 2.6): parent-only chain (renamed from an earlier, overclaiming
  name — see "Final-gate follow-up" below), single lane edge (non-ancestor), a lane target with
  its OWN multi-step ancestor chain (`laneRoot -> laneMid -> laneTip`, final-gate CR1's
  discriminating case — see below), transitive lane edge (a lane step that itself holds a lane
  reference), diamond de-duplication, cyclic-input termination, order-preservation (no re-rank),
  and sibling-lane exclusion.
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` — new
  describe block `"PipelineRunService.previewStep / evaluateNodeRowsForBackfill (HEL-970
  lane-aware closure)"` (6 tests): rejoin preview 200 + both-lanes row content (AC1/AC2/D6
  stepCounts), preview/run agreement against an independently-constructed engine-walk oracle
  reading `nodeOutcomes` (AC2/D4), sibling-lane exclusion asserted on closure membership (not
  just rows), diamond de-duplication end to end, a DB-backed two-root cross-root rejoin proving
  the foreign lane is evaluated against its OWN root's frame (not the narrowed-`roots`
  corruption, design.md D5/round-2 CR1) and that the target's rows come from `nodeOutcomes` not
  `TreeWalkResult.rows` (task 3.4b), and a backfill-site test proving
  `evaluateNodeRowsForBackfill` persists the rejoined rows rather than swallowing a
  `LaneReferenceError` into its `.recover` log line (task 3.6). `buildTwoLaneFixture`'s lane B is
  now a TWO-STEP chain (`s3a -> s3b`, final-gate CR1 — see below), and every test using it was
  updated to assert both steps' effects. Also added a `seedStaticDs` fixture helper
  (caller-supplied columns/rows, for the cross-root distinguishable-data requirement) and new
  imports (`ComputeConfig`, `SelectConfig`, `InProcessExecutionBackend`, `InProcessPipelineEngine`,
  `NodeDependencyClosure`, `StepKey`).

## Spec

- No edit to `openspec/changes/preview-lane-aware-path/specs/pipeline-step-preview/spec.md` — it
  was already correct (task 4.3); only the code was wrong. Confirmed true by the tests above,
  specifically "previewing the rejoin (s4) returns 200 with rows reflecting BOTH lanes" (AC1/AC2)
  and the cross-root test (the "different root" scenario).

---

## Task 1.2 — RED baseline (recorded before the fix)

Reproduced by temporarily reverting `PipelineRunService.scala` to its pre-fix state (`git stash`)
while keeping the new test file, and running the "previewing the rejoin (s4) returns 200..." test
against the ORIGINAL `pathToRoot`:

```
Left(UnprocessableEntity("Pipeline execution failed"))
```

This is the GENERIC arm of `previewStep`'s `.recover` block, not the raw `LaneReferenceError`
text. Root cause traced: `InProcessPipelineEngine`'s pre-walk guard raises
`LaneReferenceError("Step 's4' references lane step 's3', which does not exist in this
pipeline.")` as a plain `Exception`, not a `StepExecutionException`. `previewStep`'s recover
block is:

```scala
val errMsg = ex match {
  case see: StepExecutionException => see.getMessage
  case _                            => "Pipeline execution failed"
}
```

`LaneReferenceError` falls into the `case _` arm, so the caller-visible error message is the
generic string; only the server log line (`log.error(s"previewStep failed ...", ex)`) carries the
raw, misleading "does not exist in this pipeline" text (task 6.2 below). The fix removes this
failure mode entirely — the closure now includes the referenced lane step — so this exact
`Left` is unreproducible against the fixed tree without reverting the call site back to
`pathToRoot`; that revert-and-rerun is exactly how this baseline was captured (see git history /
this session's transcript, not a permanent test in the suite, per task 1.2's instruction that the
RED test "is rewritten in 3.1").

## Task 4.3 — merged spec scenario now genuinely true

`pipeline-preview-api`'s scenario "Preview of a rejoin Output reflects both inputs" is proven by
`PipelineRunServiceSpec`'s `"previewing the rejoin (s4) returns 200 with rows reflecting BOTH
lanes, not a 422 (AC1/AC2)"` test (asserts 200, 4 rows, lane-A-only and lane-B-only marker
columns each present on the correct 2 rows) and by the cross-root variant `"cross-root rejoin:
preview returns 200 ..."`.

## Final-gate follow-up (skeptic-final-1.md, round 1 — REFUTE, one change request)

**Finding:** every new fixture in both new spec files had the `SecondaryInput.Lane(...)` target
as a PARENTLESS step, so "follow parent edges FROM a lane-discovered node" was entirely
unexercised — a `closureOf` that follows lane edges but NOT parent edges from a lane-discovered
node passed the whole suite. That mutant reproduces this ticket's own 422 on the realistic
HEL-912 shape (a rejoin picker offers a lane that is itself a chain, e.g. source -> filter ->
compute), since `executeTree`'s `parentKey` for the lane tip then resolves to an absent step and
`isReady` never becomes true. `closureOf` as shipped is correct (it already follows parent edges
from every node in the frontier, lane-discovered or not) — this was a test-evidence gap, not a
code defect, so no production code changed in this follow-up.

**Revisions made (all three required):**

1. `NodeDependencyClosureSpec` — added `"follows parent edges FROM a lane-discovered node that
   itself has a multi-step ancestor chain"`: lane target `laneTip` has its own chain
   `laneRoot -> laneMid -> laneTip`; asserts the closure is exactly
   `{a, laneRoot, laneMid, laneTip, join}`. This is the assertion that kills the named mutant.
2. `PipelineRunServiceSpec` — `buildTwoLaneFixture`'s lane B is now the two-step chain
   `s3a (parentless, adds "lane_b_flag") -> s3b (parent = s3a, adds "lane_b_flag2")`, with `s4`'s
   `SecondaryInput.Lane` pointed at `s3b` (the lane TIP, not the lane root). Every test consuming
   the fixture (`"previewing the rejoin..."`, `"preview/run agreement..."`, `"excludes a sibling
   lane..."`, the backfill test) now asserts `s3b`'s own effect (`"lane_b_flag2" ->
   "lane-b-2"`) is present end to end — through the service, not only at the helper — and the
   `stepCounts` assertion now covers both `s3a` and `s3b`.
3. This entry.

**Non-blocking items also folded in:**

- Task 4.1 (AC5 parity) evidence trail: the parity claim is satisfied by two PRE-EXISTING
  lane-free tests that were not re-derived for this ticket but remained green throughout —
  `PipelineRunServiceSpec`'s `"resolves the target step's prefix from its parentStepId ancestor
  chain, excluding an unrelated tail (AC5.5)"` (trunk-plus-tails; composed limits 10→5→2 prove the
  correct 4-step, tail-excluding prefix ran) and `"previewStep on a tail step returns the tail's
  own rows, not the trunk's terminal frame"` (tail case). On any lane-free graph `closureOf`
  provably reduces to the old ancestor chain (the only extra edge, `laneDependencyOf`, is `None`
  for every non-rejoin op), so these pre-existing, discriminating tests remaining green is what
  establishes AC5 — not a new test.
- Renamed `NodeDependencyClosureSpec`'s `"for a parent-only chain, equals the old pathToRoot
  output exactly"` to `"for a parent-only chain (no lane edges), the closure is exactly the
  ancestor chain"` — the original name implied derivation from the pre-change implementation;
  the assertion is (and remains) a hand-written literal, which is correct but was misdescribed.

**Explicitly not touched per the report's instruction:** the "permanently unresolvable" clause in
`specs/pipeline-step-preview/spec.md` was already corrected during planning; the skeptic's report
read a stale copy. Left alone.

## Task 5 — widening sweep (acceptance criterion 6)

Re-derived independently rather than trusting planning's survey. Grepped the backend for every
site building a step-set/dependency decision from `parentStepId` alone
(`grep -rn "parentStepId" backend/src/main/scala`), then classified each:

| Site | Parent-only? | Shares the defect? |
|---|---|---|
| `PipelineRunService.previewStep`/`evaluateNodeRowsForBackfill` | was; now closure-based | **FIXED by this change** |
| `PipelineAnalyzeService.analyzeNodes` | No — already parent + `laneDependencyOf` | Confirmed NOT shared (re-verified: `isReady`/`schemaAt`/`processNode` all consult `laneDependencyOf`, mirroring `executeTree`'s Kahn walk) |
| `InProcessPipelineEngine.structuralRank`'s `childrenOfKey` (parent→child edges only) | Yes, by design | **Legitimate.** Design.md/HEL-911 contract item states lane-reference edges never affect structural rank — this is an ordering/display concern, not a dependency-closure concern, and is deliberately parent-only |
| `InProcessExecutionBackend.execute`'s `roots.size == 1` shortcut (`steps.filter(_.parentStepId.isEmpty)`) | Yes | **Legitimate** — this maps parentless (root-level) steps to a root id; it is not a dependency-closure computation. (This is the mechanism design.md D5 already separately requires callers to avoid TRIGGERING by never narrowing `roots`, not a site that itself needs lane-awareness.) |
| `PipelineStepRepository.trunkOfRoot` (`steps.filter(s => s.parentStepId.isEmpty && ...)`) | Yes | **Legitimate** — finds a root's own trunk (a structural/display concept, mirrors `RuntimeGraphPath`'s single-chain notion), not an execution slice |
| `PipelineService.ancestorChainOf` (used at lines ~1761/2025 for lane self-reference/cycle validation, and the request-shaped `ancestorClientIds` twin at line ~410) | Yes | **Legitimate — CONFIRMED, not merely repeated.** Traced both call sites: both are write-time "is this lane reference pointing to one of its own ancestors" cycle checks, never an execution-slice construction. A cycle check by construction only needs to know the ancestor chain (is X in scope of Y's own lineage), not the closure of what must execute |
| `PipelineService.descendantStepIds` (root-removal lane-reference refusal, HEL-913 task 7.5) | Yes | **Legitimate** — descendant enumeration for a removal refusal, not an execution slice |
| `RuntimeGraphPath.pathOf` | Partially (see task 6.1) | **Out of scope, reported not fixed** (design.md D3) |

**Conclusion: preview-only.** No other execution-slice-construction site shares the defect. Every
other `parentStepId`-only site surveyed is either (a) already lane-aware
(`PipelineAnalyzeService`), or (b) legitimately parent-only because it answers a structural/
display/cycle-check question, not "what must execute before this node" — the property this
ticket's defect was actually about. No scope widening is warranted; not escalated.

## Task 6 — reported, not fixed

- **6.1 — `RuntimeGraphPath` scaladoc/implementation divergence (design.md D3).**
  `RuntimeGraphPath.scala`'s scaladoc claims the lane dependency is followed "or, transitively, a
  step in its own chain," but `pathOf`'s implementation consults `laneDep` for the **target step
  only** — one level, not transitive. Re-verified in this session: the doc overstates the code.
  This affects only a rendered *display* path (used in error-message attribution), not execution
  correctness, and is explicitly out of scope for this change (folding it into
  `NodeDependencyClosure` would change HEL-913 R5's pinned display-path format). Not fixed here.
- **6.2 — misleading run-time guard message.** `InProcessPipelineEngine.scala`'s pre-walk lane
  guard (`Step '...' references lane step '...', which does not exist in this pipeline.`) is
  accurate for the real `/run` path (the vector IS the whole pipeline there) but was misleading
  for preview's OLD truncated slice — the lane step existed in the pipeline, just not in the
  slice handed to the engine. After this change, preview no longer produces that state (the
  closure always includes a referenced lane step, so this guard is unreachable from preview for
  a resolvable reference). Not reworded here — a wording change to the run path's error text
  would be an untested edit outside this ticket's scope, per design.md/task 6.2's own
  instruction.

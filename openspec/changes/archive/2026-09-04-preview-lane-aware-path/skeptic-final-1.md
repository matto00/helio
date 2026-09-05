## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every claim below was re-derived from source/test output in this worktree at
`5af54ecf`; `evaluation-1.md` and `files-modified.md` were read as claims only.

### What I verified (with evidence)

1. **Gates re-run independently.** `sbt test` from `backend/` in this worktree:
   `Total number of tests run: 3804 / Suites: completed 250, aborted 0 / Tests: succeeded 3804,
   failed 0 ... All tests passed. [success] Total time: 286 s`. Green, reproduced by me, not
   quoted from the evaluator.

2. **Hard constraints hold.** `git diff --name-only main...HEAD` is 2 backend main files, 2
   backend test files, and `openspec/changes/**` only. Grepping that list for
   `db/migration|frontend/|RestApi|SchemaInferenceEngine|InProcessPipelineEngine` returns
   nothing (exit 1). No Flyway migration, no frontend file, no sibling-owned file. No browser
   was driven.

3. **AC3 (engine-authoritative slice) traced.** `NodeDependencyClosure.closureOf` expands a
   visited-set fixed point over `step.parentStepId` **and**
   `InProcessPipelineEngine.laneDependencyOf(step)` — the same predicate `executeTree`'s
   `isReady` uses (`InProcessPipelineEngine.scala:429-431`). It filters `steps` rather than
   re-ordering, so no second ordering authority exists. Both former `pathToRoot` copies are
   gone from `PipelineRunService.scala`; both call sites (`:520`, `:664`) delegate. AC4 met.

4. **AC2's oracle is genuinely independent.** In the "preview/run agreement" and cross-root
   tests, the expected value is produced by constructing a fresh
   `InProcessExecutionBackend(new InProcessPipelineEngine(...), stepRepo)` and executing the
   **full, un-sliced** `listByPipelineInternal` result, then reading
   `nodeOutcomes(StepKey(target))`. `NodeDependencyClosure` is not on that path. Both tests
   additionally pin an independently-written literal (`Set((Some("lane-a"),None),
   (None,Some("lane-b")))`; `Vector("rootB-value","rootA-value")`), so "both paths wrong
   identically" is excluded. Not vacuous.

5. **The cross-root test is real, DB-backed, and discriminating.** It seeds two distinct
   `data_sources` via the new `seedStaticDs` with distinguishable payloads (`rootA-value` vs
   `rootB-value`), creates a genuine second root via `addSecondRoot`, and inserts steps with
   real `explicitRootId`s. Two surviving roots means
   `InProcessExecutionBackend.execute` takes the `else stepRepo.rootIdsOf(pipeline.id)` branch
   (a live `ctx.withSystemContext` query), not the `PipelineStepRepository(null)` in-memory
   style. Under the narrowed-`roots` corruption that skeptic-design-2 CR1 names, both
   parentless steps would remap to root A and the assertion
   `jsRows.map(_.fields("value")) shouldBe Vector("rootB-value","rootA-value")` would read
   `Vector("rootA-value","rootA-value")`. The test discriminates by row value, as required.
   Task 3.4b is behavioural: `wrongRows should not be jsRows...` compares against
   `oracleOutcome.rows` (root A's trunk terminal), an observably different value.

6. **AC6 widening re-derived by property, not by list.** I swept for the property directly:
   `grep -rn "\.execute(" backend/src/main/scala` yields exactly four
   `PipelineExecutionBackend.execute` step-set sites — `:448` and `:648` pass `Vector.empty`
   (source-level, no slice), `:834` passes the full `steps` vector (the real run path), and
   `:520`/`:664` are the two sites fixed here. No other site constructs an execution slice at
   all, so "preview-only" is confirmed independently of the executor's table.

7. **AC5 parity is established, though not by a new test.** The pre-existing lane-free
   coverage is discriminating and stayed green: the trunk-plus-tails test "resolves the target
   step's prefix from its parentStepId ancestor chain, excluding an unrelated tail (AC5.5)"
   composes limits 10→5→2 and asserts 2 rows (1 if the unrelated tail were folded in), and
   "previewStep on a tail step returns the tail's own rows" asserts the tail's unrenamed frame.
   On a lane-free graph `closureOf` provably reduces to the ancestor chain (the only extra edge
   is `laneDependencyOf`, which is `None` for every non-rejoin op). AC5 is met in substance.

### Verdict: REFUTE

One change request. It is a test-evidence gap, not a defect in the shipped code —
`closureOf` as written is correct. But the gap is squarely on the ticket's own central case, and
the whole suite is passable by a wrong implementation, which is the bar this gate applies.

### Change Requests

1. **In every new test, the lane-referenced step is parentless — so the closure's
   "follow parent edges *from* a lane-discovered node" behaviour is entirely unexercised, and a
   wrong `closureOf` passes the whole suite.**

   Enumerated across both new spec files, every `SecondaryInput.Lane(...)` target has
   `parentStepId = None`:
   - `NodeDependencyClosureSpec.scala`: lane targets `b`, `laneSource`, `innerJoin`, `shared`,
     `x`/`y`, and `laneB` — all constructed with `parent = None`.
   - `PipelineRunServiceSpec.scala`: `s3` (`buildTwoLaneFixture`, `parentStepId = None`),
     `shared` (diamond test, `parentStepId = None`), `aLeaf` (cross-root test,
     `parentStepId = None`).

   Consequence: this mutant of `closureOf` — which follows parent edges only along the target's
   own ancestor chain, and from lane-discovered nodes follows *lane* edges but **not** parent
   edges — satisfies every assertion in both new files (chain, single lane, transitive lane,
   diamond, cycle, order, exclusion, both-lanes rows, `stepCounts`, cross-root row values,
   backfill). It is also a natural way to write the helper wrong.

   That mutant is not a benign miss. For the realistic shape — HEL-912's rejoin picker offers a
   lane that is itself a chain (`source → filter → compute`), not a bare parentless node — the
   slice would contain the lane's terminal step without its parent.
   `InProcessPipelineEngine.executeTree`'s `parentKey` (`:424-427`) then returns
   `StepKey(<absent parent>)`, which never enters `evaluatedIds`, so `isReady` is never true for
   that node, `ready.isEmpty` fires at `:437`, and the walk fails with
   `LaneReferenceError("Cyclic or unresolved lane reference among pipeline steps: ...")`.
   `LaneReferenceError` is not a `StepExecutionException`, so `previewStep`'s `.recover` maps it
   to `Left(UnprocessableEntity("Pipeline execution failed"))` — i.e. **the exact 422 this
   ticket exists to remove**, and at the backfill site the same exception lands in the
   log-and-swallow `.recover` arm (no snapshot written, no user-visible error). The suite would
   still be green.

   Required revisions (cheap — fixture edits, no production change):
   1. In `NodeDependencyClosureSpec`, add a case where the lane-referenced step has its own
      multi-step ancestor chain — e.g. `laneRoot(None) -> laneMid(parent=laneRoot) -> laneTip`,
      target `join(parent=a, lane=laneTip)` — and assert the closure is
      `{a, laneRoot, laneMid, laneTip, join}`. This is the single assertion that kills the
      mutant above.
   2. In `PipelineRunServiceSpec`, make lane B in `buildTwoLaneFixture` a **two-step chain**
      (e.g. `s3a` parentless compute adding `lane_b_flag`, then `s3b` with
      `parentStepId = Some(s3a.id)` whose effect is observable in the rows — a filter or a
      second computed column), and point `s4`'s `SecondaryInput.Lane` at `s3b`. Assert the row
      content reflects `s3b`'s effect, so the failure is caught end-to-end through the service,
      not only at the helper. Keep the existing `stepCounts` assertion and extend it to `s3a`.
   3. Record in `files-modified.md` that the lane-with-ancestors case is covered, naming the
      tests.

### Non-blocking notes

- `tasks.md` 4.1 is checked off, but no test was added for it and `files-modified.md` records no
  evidence for it at all (the document jumps from task 1.2 to task 4.3). The acceptance criterion
  is nonetheless satisfied by the pre-existing lane-free tests described in finding 7 above —
  this is a bookkeeping gap, not a coverage gap. Worth one line in `files-modified.md` citing
  those two test names so the AC5 claim is traceable.
- `NodeDependencyClosureSpec`'s "for a parent-only chain, equals the old `pathToRoot` output
  exactly" asserts a hand-written `Vector("a","b","c")`, not a value derived from the pre-change
  implementation. The literal is obviously right for that fixture, so this is not a defect —
  but the test name overclaims what it establishes.
- skeptic-design-3's non-blocking note about the stale "permanently unresolvable" rationale in
  `specs/pipeline-step-preview/spec.md` was not acted on. That clause still contradicts this
  change's own D5 and will be archived into `openspec/specs/`. Still non-blocking, still worth
  fixing while the file is open.
- `(s1, s2, s3) shouldBe (s1, s2, s3)` and `(s3, s4) shouldBe (s3, s4)` are self-identity
  assertions used to silence unused-variable warnings. They assert nothing; prefer `val _ = ...`
  or dropping the bindings, so a reader does not mistake them for coverage.

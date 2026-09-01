## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed `cbc4ce29` (cycle-2 fixes) on top of the cycle-1 commit `913eaf88` I reviewed in
evaluation-1.md. All eight change requests are addressed, and — unlike cycle 1 — the fixes are
backed by tests I independently proved failable by mutation.

### Gates — re-run fresh by the evaluator

- `sbt -batch 'set Test/parallelExecution := false' test` → `Total number of tests run: 3389`,
  `succeeded 3389, failed 0`, exit 0 (+8 over cycle 1's 3381 — matches the 8 new tests in the diff).
- `npm run check:scala-quality` → clean (132 pre-existing soft file-size warnings, none new).
- `npm run lint` 0 · `npm run format:check` 0 · `npm --prefix frontend run typecheck` 0.
- `npx jest --testPathPatterns usePipelineRunEvents` run **directly under `frontend/`** (not via the
  root `--passWithNoTests` leg) → 15/15, including the new reset test.

### Mutation verification — performed by me, in a throwaway detached worktree

I did not take the executor's "demonstrated failable by mutation" claim on faith. I created a
scratch `git worktree add --detach` at `cbc4ce29`, backed each fix out one at a time, ran the
relevant suite, and removed the worktree afterward (`git worktree remove --force`; confirmed gone).
`WORKTREE_PATH` itself was never modified.

| Mutation (fix backed out) | Result |
| --- | --- |
| CR5 — `walkTrunk`'s `if (trunkChild.enabled)` stepCounts guard → unconditional `.updated` | **RED**, `Set("s1","s2","s3") contained element "s2"` at `InProcessPipelineEngineTreeWalkSpec.scala:80` — byte-for-byte the failure the executor reported. Claim verified. |
| CR2 — `foldChain` records a `NodeOutcome` only for `chain.last` | **RED**, "record a NodeOutcome for every node in a multi-step tail chain" |
| CR1 — `previewStep`'s `targetRows` → `outcome.rows` | **RED**, "previewStep on a tail step returns the tail's own rows" |
| CR3 — alert-eval `nodeOutcomes.get(k)` → `.orElse(Some(NodeOutcome(resultRows, …)))` | **RED**, "skips alert evaluation for an Output with no matching NodeOutcome" |

All four guards are genuinely mutation-sensitive; none passes vacuously. (Task 10.5's literal
back-out-and-restore exercise is therefore satisfied in substance, by the evaluator, for four
guards rather than the three it names.)

### Phase 1: Spec Review — PASS

- CR4 resolved correctly: `specs/pipeline-analyze-api/spec.md` is deleted from the change
  (`ls specs/` now shows only aggregate-op / execution / run-execution / run-sse / run-status-ui),
  so no unimplemented requirement gets published on archive. `openspec validate --strict` passes.
- The remaining spec deltas still match the implemented behavior, including the CR5 stepCounts
  change (which restores the pre-existing wire shape rather than altering it, so no delta is owed).
- HEL-930 exists, is well-scoped, correctly attributes the defect to HEL-904 (not this ticket),
  names the exact `children.find(_.position == 0)` site, records that the scaladoc above it asserts
  the opposite, and explains why the engine-level test does not cover it. Referenced from design.md
  Decision 8, tasks.md and execution-progress.md. The duplicate (HEL-929) was found and linked by
  the executor rather than left dangling.
- Remaining unchecked tasks (4.5, 4.6, 5.6, 6.4, 10.5, 10.6) are all explicitly recorded in
  execution-progress.md rather than silently dropped. AC coverage for 4.5 is partial-but-real: the
  pre-existing "does not update the node_snapshots rows when blocked … preserving the prior
  snapshot" test proves the prior-snapshot-survives property on a non-successful terminal path, and
  `materializedWrites` is structurally unreachable except from the `Success` branch.

### Phase 2: Code Review — PASS

Each cycle-1 finding re-checked against the code, not the changelog:

1. **CR1** — `PipelineRunService.scala:314` now reads
   `outcome.nodeOutcomes.get(Some(target.id.value)).map(_.rows).getOrElse(outcome.rows)`. The
   fallback is now genuinely unreachable-or-identical (every walked node has an outcome), and the
   comment says why. Regression gone.
2. **CR2** — `foldChain` records a `NodeOutcome` and fires `onNodeProgress` for every step in a tail
   chain (`InProcessPipelineEngine.scala:~300-320`), proven at both the engine layer (new
   `InProcessPipelineEngineTreeWalkSpec` case) and the service layer (new "materializes a MID-tail
   node" test asserting the mid node's own `node_snapshots` rows *and* its Output's derived schema).
3. **CR3** — the silent `getOrElse(resultRows)` is gone; a missing outcome is an explicit
   `case None => log.error(...)` skip naming the output id, run id and node key. The route-level
   test simulates the orphan via an `OutputRepository` subclass override — an acceptable and
   honestly-documented simulation, since `outputs.node_step_id` is `ON DELETE CASCADE` and the shape
   is unreachable by real writes; and it is mutation-sensitive (table above), so it is not vacuous.
4. **CR5** — disabled steps get no `stepCounts` entry on either the trunk (`walkTrunk`) or a tail
   (`foldChain`) path, restoring the pre-tree-walk `RunResultResponse.stepRowCounts` shape exactly.
5. **CR6** — the AC1 parity test is now three cases: single step, multi-step trunk **containing a
   disabled step** (compared against the flat engine with the disabled step pre-filtered — the
   correct comparator, and the comment explains why), and identical `StepExecutionException`
   attribution (stepId/kind/message) for a step that fails `requiredConfigProblems`.
6. **CR7/CR8** — the dry-run-equals-live-snapshot test and the tail-node SSE test both exist. The
   SSE test is well-constructed: it inserts a trunk step *first* so the second sibling really lands
   at `position = 1` (the executor found and root-caused its own earlier version of this test
   silently creating a trunk instead of a tail), and it asserts a tail row count (1) that
   provably differs from the trunk's (2), so "any node-progress event" cannot accidentally satisfy
   it. It also re-asserts that the run-level `succeeded` event still carries the trunk's count.
7. **Decision 13 (coordinator investigation) — verified independently.** I grepped
   `backend/src/main/scala` myself: the only `executeWithStepCounts` call is
   `InProcessPipelineEngine.execute` (`:118`), and `execute` itself has **zero** production callers;
   the two real `.execute(` call sites (`PipelineRunService.scala:312`, `:473`) are the
   `PipelineExecutionBackend` trait method, which `InProcessExecutionBackend` implements by calling
   `engine.executeTree` exclusively. Every other reference in main sources is a comment. **The claim
   is true: the flat fold is production-unreachable and the ticket's core scope is met.** The parity
   oracle framing is legitimate (the shared `evalOneStep` extraction makes the comparison
   non-trivial but not circular — the mutation table proves the assertion can fail), and the new
   Scaladoc explicitly warns against deleting it as dead code.
8. `AggregateStep.apply` is now a proper `if/else` expression (the `return` is gone), and the
   sum-null-vs-0.0 asymmetry is documented in place as deliberate, per the cycle-1 suggestion.
9. Comment quality is high throughout the new code — hazards and rationale, not restatement — and
   the `HEL-905`/`evaluation-1.md CRn` refs all carry their payload inline per CONTRIBUTING.md. No
   inline FQNs, no dead code, no new type-safety escape hatches.

### Phase 3: UI Review — PASS

`start-servers.sh` + `assert-phase.sh servers` → `PASS servers`. **Note on evidence hygiene:** the
backend the script offered to reuse had been started at 19:00, *before* the cycle-2 commit (19:26),
so it was stale. I killed it and restarted so every observation below is against `cbc4ce29`
(confirmed: backend PID start time 19:35).

- Happy path: ran a real pipeline from the detail page. Footer showed `Succeeded`, `Rows written: 3`,
  `Snapshot replaced: 3 rows`; per-step row counts still render (`3 rows` on each enabled step card,
  i.e. CR5 did not strip counts from *enabled* steps).
- **CR1 verified live, on a real tail.** The dev pipeline `skeptic-pipeline` turns out to be a
  HEL-904-migrated shape whose steps are `hel904-tail-…` at `position 1` and `position 2` with
  `parentStepId = null` — genuine root-level tails. Using the step card's own "Preview data" control,
  the tail step's preview returned **its own aggregated rows** (`name`/`amount`; Alpha 10 / Beta 20 /
  Gamma 30), not the source frame the pre-fix code would have returned. This is the cycle-1
  regression, fixed and confirmed end-to-end through the real UI + route path rather than only in a
  unit test.
- Loading/empty/terminal states behaved; no unhandled exceptions.
- Console: no app-generated errors during either flow. The entries present are pre-existing
  (`/api/types` 404 — route retired in P1.1 while the frontend still calls it; `/schedule` 404 — no
  schedule set) or self-inflicted by my own raw `fetch` probes (a wrong `/runs` path I guessed, and
  403 `Missing required CSRF header` from calling `/preview` outside the app's client).
- The hook's new `nodeId`/`nodeRowCount` remain deliberately unrendered (design.md Decision 6's
  "do not gold-plate"), so there is no new visual surface, no new interactive element, and no
  breakpoint or token/DESIGN.md surface to review.

### Overall: PASS

### Non-blocking Suggestions

- **Do this before merge (housekeeping, not engineering):** my cycle-1 CR4 offered "delete the delta
  **and hand the requirement to HEL-906 with a named task**". The delta is deleted and this change's
  own artifacts point at HEL-906, but **HEL-906's ticket body does not name the handoff**. Its scope
  does imply the work (`GET /api/pipelines/:id/capabilities?stepId=` … "evaluated against the node's
  projected schema"), so nothing is lost silently — but per ticket.md rule 5 a deferral is only real
  once the owning ticket names it. Add one line to HEL-906: "Includes HEL-905 task 6.4 —
  `PipelineAnalyzeService` per-node (trunk + tail) schema projection, deferred from P1.2."
- Stale prose inside this change's own artifacts still describes the deleted analyze delta as
  shipping: `proposal.md:42` ("`pipeline-analyze-api`: per-step schema projection becomes
  tree-aware") and `design.md` Decision 11 / the "Spec-delta scope" bullet at `design.md:351`. These
  are never published to `openspec/specs/`, and tasks.md 9.4 + execution-progress.md both record the
  truth, so this is cosmetic — but a one-line "superseded by cycle 2 / CR4" note on each would stop
  a future reader from trusting the wrong sentence.
- Remaining deferrals (4.5, 4.6, 5.6, 10.6) are acceptable to carry, given 4.5's partial coverage
  and 5.6's structural coverage by the in-place-skip mechanism — provided they are named in a
  follow-up ticket rather than evaporating at archive time.
- `design.md`'s "Red-first proof" section still describes the frozen-fixtures plan that Decision 13
  supersedes. Decision 13 says so explicitly, so this is not misleading in context, but the older
  section could carry a pointer.

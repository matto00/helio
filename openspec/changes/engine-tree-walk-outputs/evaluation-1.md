## Evaluation Report — Cycle 1 (evaluation-1.md)

### Gates — re-run by the evaluator (not taken from the executor's report)

All run fresh in `WORKTREE_PATH` at `913eaf88`:

- `sbt -batch 'set Test/parallelExecution := false' test` → `Total number of tests run: 3381`,
  `succeeded 3381, failed 0`, `[success]`, exit 0. Matches the executor's claim exactly.
- `npm run check:scala-quality` → `Scala code-quality check: clean (132 soft warning(s))` (all
  warnings are pre-existing file-size soft budgets on unrelated files).
- `npm run lint` → 0; `npm run format:check` → 0; `npm --prefix frontend run typecheck` → 0.
- `npx jest --testPathPatterns usePipelineRunEvents` (run directly under `frontend/`, NOT via root
  `npm test`, whose `jest --passWithNoTests` leg is the documented vacuous-green trap) →
  1 suite / 14 tests passed, including the two new `node-progress` tests.

Coverage check on the gates themselves: `sbt test` does compile and exercise the new
`InProcessPipelineEngineTreeWalkSpec`, `AggregateStepSpec`, `PipelineRunServiceSpec` and
`PipelineRunRoutesSpec` cases (all named tests appear in the log). The gates are real. They do not,
however, cover the defects below — those are gaps in what was tested, not gate failures.

### Phase 1: Spec Review — FAIL

Issues:

1. **Ticket scope bullet "`PipelineAnalyzeService` projects schema per node" is unimplemented, yet
   the change ships a spec delta that asserts it.** Task 6.4 is unchecked and
   `PipelineAnalyzeService` is untouched by the diff, but
   `openspec/changes/engine-tree-walk-outputs/specs/pipeline-analyze-api/spec.md:4-13` ships a
   MODIFIED requirement stating "a `steps` array covering every node in the step tree (trunk and
   tails)… A tail step's `inputSchema` SHALL equal its own predecessor's `outputSchema` within that
   tail". Archiving this change would publish a requirement the code does not satisfy. Either
   implement 6.4 or remove that delta file this cycle. (Leaving task 9.4 unchecked does not stop the
   file from being part of the change — `openspec validate --strict` passes it.)
2. **`tasks.md` 5.2 is marked `[x]` but the test it names does not exist.** There is no test
   asserting "dry-run preview rows equal the live-run snapshot for the same input"; the only dry-run
   test is 5.3 (`"a dry run persists nothing to node_snapshots even for a materialized node"`,
   `PipelineRunServiceSpec.scala:1193`). This is the AC at `ticket.md:24`. Uncheck it or write it.
3. **AC1's parity evidence is far weaker than claimed.** The executor's substitution of a live
   `executeWithStepCounts` vs `executeTree` comparison for frozen on-disk fixtures is *methodologically*
   acceptable — I verified `executeWithStepCounts` is still present and its per-step body was
   extracted verbatim into `evalOneStep` (`InProcessPipelineEngine.scala:148-186`) and is shared by
   both paths, so the comparison is genuinely non-vacuous and nothing unrecoverable was destroyed.
   But the parity test itself (`InProcessPipelineEngineTreeWalkSpec.scala:48-57`) compares **one
   pipeline consisting of one `rename` step**. That is not "every fixture pipeline with no tails"
   (AC1), and it exercises none of the paths where the two engines could actually diverge:
   multi-step trunks, a disabled step (where they *do* diverge — see Phase 2 issue 5), a failing
   step's `StepExecutionException` attribution, or a step that touches the assertion/truncation
   sinks. Widen it before AC1 can be called met.
4. Positive findings: no AC silently reinterpreted; no scope creep in the diff; the `pipeline-execution`,
   `pipeline-run-execution`, `pipeline-run-sse`, `pipeline-aggregate-op` and `pipeline-run-status-ui`
   deltas do match what was implemented; `openspec validate --strict` passes.

### Phase 2: Code Review — FAIL

Issues:

1. **BLOCKING REGRESSION — `previewStep` of a step on a tail now returns the wrong rows, silently.**
   `previewStep` resolves the correct root-to-target chain (`PipelineRunService.scala:293-299`) but
   then reads `outcome.rows` (`:314`). `executeTree` defines `rows` as the **trunk's** terminal frame
   (`InProcessPipelineEngine.scala:311`, `walkTrunk` returns `frame` when there is no `position == 0`
   child). Tails are evaluated inside `evalTails` and recorded **only** into `nodeOutcomes`
   (`:276-278`); they never contribute to `rows`. So for a target step `t` whose parent is trunk step
   `a`, the resolved chain `[a, t]` is walked, `t` *is* evaluated, and then the response returns
   **`a`'s** frame and `a`'s row count. Before this change the positional slice `take(k+1)` folded
   `[a, t]` flat and returned `t`'s rows — i.e. the previous behavior was correct for this case and
   the new one is not. Preview of a trunk step is unaffected (hence the green suite). Fix: read the
   target node's own outcome, e.g.
   `outcome.nodeOutcomes.get(Some(target.id.value)).map(_.rows).getOrElse(outcome.rows)` (this
   requires issue 2's fix so mid-tail targets have an entry), and add a test that previews a step on
   a tail and asserts the tail's own rows.
2. **BLOCKING — only a tail's TERMINAL node gets a `NodeOutcome`; an Output on a mid-tail node is
   silently dropped.** `evalTails` records exactly one entry per tail, keyed `chain.last`
   (`InProcessPipelineEngine.scala:276-278`), and fires `onNodeProgress` once for that node only.
   Consequences, all silent:
   - `materializedWrites` computes `outputsByNode.keySet.intersect(nodeOutcomes.keySet)`
     (`PipelineRunService.scala:655-657`), so an Output attached to a mid-tail node produces **no
     `node_snapshots` rows and no `outputs.schema` update**, with no error and no log.
   - Worse, `alertEvaluation` for that same Output falls back to
     `nodeOutcomes.get(nodeKey).map(_.rows).getOrElse(resultRows)` (`:722-723`) — it evaluates that
     Output's alert rules against the **trunk's** final rows. A silent wrong-data path.
   - It also contradicts the AC at `ticket.md:27` ("SSE events carry `nodeId` and per-node row
     counts… tails included") — mid-tail nodes emit no `node-progress` event at all.
   Fix: record a `NodeOutcome` (and fire `onNodeProgress`) for **every** node in a tail chain, not
   just `chain.last` — a one-line change inside `foldChain`. Separately, replace the
   `getOrElse(resultRows)` alert fallback with an explicit skip + `log.error`; a defensive fallback
   to a *different node's data* is not defensive, it is a silent correctness bug.
3. **Undocumented, wire-visible change to `stepCounts`.** `PipelineRunService.scala:246` now passes
   the full step list (correct, per Decision 7), and `evalNode` passes a disabled node's frame
   through — but `foldChain`/`walkTrunk` still write a count entry for that disabled step
   (`InProcessPipelineEngine.scala:290-292`, `:313-314`). Previously the caller's
   `.filter(_.enabled)` meant disabled steps had **no** entry. `stepCounts` is returned to the client
   as `RunResultResponse.stepRowCounts` (`PipelineRunService.scala:322`, `:530`), so a disabled step
   card will now display a row count it never produced. Either skip the count update for a disabled
   node or spec + test the new behavior deliberately.
4. **`AggregateStep.apply` uses a `return`** (`AggregateStep.scala:98`) inside an otherwise
   expression-oriented object. The branch itself is correct and correctly scoped, but restructure it
   as an `if/else` expression to match the file's (and the codebase's) style.
5. Verified-good (no action): the empty-set aggregate fix covers **both** arms — the new branch is
   guarded on `rows.isEmpty && groupByFields.isEmpty` (`AggregateStep.scala:87`) and the anti-over-fix
   arm is explicitly tested (`AggregateStepSpec.scala:34-42`, renamed to say so), alongside
   count-zero and null-sum/avg/min/max tests. Snapshot persistence is materialized-only, per-node
   `overwriteRows`, sequenced strictly after a successful walk, and unreachable from any failure
   branch — 4.5 is true by construction as claimed (though still untested). The dry run genuinely
   persists nothing. The `PipelineRunServiceSpec` test-helper change (`insertStep` chaining onto the
   trunk-last node via `insertInternal`) is **legitimate and production-representative** — it matches
   what `spliceInsertAtInternal` does on every real step-creation path, and it *strengthens* rather
   than weakens those tests (the old `stepRepo.insert` built root-level siblings, which under a tree
   are disconnected tails — the tests were previously asserting an unreal shape). Seeding Outputs to
   satisfy the new materialization gate is likewise required by the new semantics, not a shortcut.
6. Verified the executor's `executionOrder` claim: **true**. `PipelineStepRepository.scala:584-588`'s
   `walk` takes `children.find(_.position == 0)` and filters tails on `position != 0`, so a second
   `position = 0` child is silently dropped from `listByPipelineInternal`'s output. The `InvalidGraph`
   arm-(1) check therefore cannot fire through the normal run path — that shape is *silently
   truncated* one layer earlier instead. Arm (2) (a tail with a `position >= 1` child) **is**
   reachable, since `expandBranch` preserves it, so the check is not wholly dead code. Given no
   production write path can create the arm-(1) shape, I accept this as a pre-existing HEL-904 defect
   rather than a P1.2 change request — but it should be filed as a spinoff (`executionOrder` should
   surface, not swallow, a duplicate trunk child), and the acceptance of `InvalidGraph` as
   "enforced" should be understood as engine-level only.
7. Deferred items, judged: 4.5 / 4.6 / 5.6 / 10.5 are acceptable to carry into a follow-up **only if
   named in a real ticket** (ticket.md rule 5). **6.6 is not** — it backs an explicit AC line
   (`ticket.md:27`) and, given issue 2, is exactly the test that would have caught a real defect;
   write it in cycle 2 together with issue 1's and issue 2's tests.

### Phase 3: UI Review — PASS

Triggered (`frontend/**` changed). `scripts/concertino/start-servers.sh` + `assert-phase.sh servers`
→ `PASS servers` (dev 6337 / backend 9244).

- Happy path end-to-end: ran a real pipeline (`skeptic-pipeline`) from the detail page. The footer
  rendered `Succeeded`, `Rows written: 3`, `Snapshot replaced: 3 rows`, `2 steps` — i.e. the new
  per-node `node-progress` events did **not** blank the status pill or corrupt the run-level row
  count, which is Decision 6's whole point, confirmed live rather than only in the hook unit test.
  Per-node materialization also fired for real (`Snapshot replaced`).
- No new console errors during the run. The 5 errors present are pre-existing and unrelated to this
  ticket: repeated `GET /api/types` 404s (Types were removed in P1.1/HEL-904; the frontend still
  calls the retired route) and one `GET /api/pipelines/:id/schedule` 404 (no schedule set).
- The frontend surface this ticket adds (`nodeId`/`nodeRowCount` on `RunEventsState`) is
  deliberately not rendered by any component, per design.md Decision 6's "do not gold-plate" —
  so there is no new visual surface to review, no new interactive element, and no breakpoint risk.
  Nothing in `frontend/**` here touches tokens, spacing/type scales, or shared components, so the
  DESIGN.md mechanical rules have no applicable surface.
- Minor, non-blocking: the hook now merges with `...prev` instead of replacing state, so
  `nodeId`/`nodeRowCount` from a previous run persist into the next run until its first
  `node-progress` event. Harmless today (nothing reads them); worth resetting when `status` goes to
  `queued`/`running` before P1.3 consumes these fields.

### Overall: FAIL

### Change Requests

1. **Fix `previewStep` for tail targets** (`PipelineRunService.scala:314`): return the *target
   node's* rows/row count, not `outcome.rows` (the trunk terminal frame). Suggested:
   `val targetRows = outcome.nodeOutcomes.get(Some(target.id.value)).map(_.rows).getOrElse(outcome.rows)`
   and derive `allJsRows`/`totalCount` from it. Add a `PipelineRunServiceSpec` test that seeds a tail
   (`insertInternal(..., parentStepId = Some(trunkStep.id))` with `position >= 1`) and asserts
   `previewStep` on the tail step returns the tail's own rows — the current AC5.5 test only covers a
   trunk target and passes either way.
2. **Record a `NodeOutcome` and fire `onNodeProgress` for every node in a tail chain**, not only
   `chain.last` (`InProcessPipelineEngine.scala:271-280` / `foldChain` at `:284-292`). Without this,
   an Output attached to a mid-tail node silently gets no snapshot and no schema
   (`PipelineRunService.scala:655-657`) and its alerts run against the trunk's rows.
3. **Remove the silent wrong-node fallback in alert evaluation** (`PipelineRunService.scala:722-723`):
   replace `.getOrElse(resultRows)` with an explicit skip plus `log.error` naming the Output id and
   node key. Evaluating an Output's alert rules against a different node's rows is worse than not
   evaluating them.
4. **Resolve the `pipeline-analyze-api` spec-vs-code contradiction**: either implement task 6.4
   (per-node schema projection in `PipelineAnalyzeService`) or delete
   `specs/pipeline-analyze-api/spec.md` from this change and hand the requirement to HEL-906 with a
   named task. Shipping the delta without the code publishes a false requirement on archive.
5. **Fix the `stepCounts` change for disabled steps**: either stop writing a count entry for a
   disabled node (`InProcessPipelineEngine.scala:290-292`, `:313-314`), restoring the pre-change
   wire shape, or add a spec scenario + test for the new one. Today it is an undocumented,
   client-visible behavior change.
6. **Strengthen the AC1 parity test** (`InProcessPipelineEngineTreeWalkSpec.scala:48-57`) beyond a
   single `rename` step: at minimum a multi-step trunk, a trunk containing a disabled step (which
   will surface CR5), and a failing step asserting identical `StepExecutionException` attribution
   from both engines.
7. **Correct `tasks.md`**: uncheck 5.2 (no such test exists) or write the dry-run-equals-live-run
   test the AC (`ticket.md:24`) requires.
8. **Write task 6.6** (tail-node `node-progress` SSE test). It backs an explicit AC line and is the
   test that would have caught CR2.

### Non-blocking Suggestions

- File the `executionOrder` spinoff: `PipelineStepRepository.scala:584-588` silently drops a second
  `position = 0` child instead of surfacing it, which is what makes `InvalidGraph` arm (1)
  unreachable end-to-end. The executor's write-up of this is accurate and worth carrying verbatim
  into the ticket.
- `AggregateStep.scala:98`: replace the `return` with an `if/else` expression.
- The empty-groupBy/zero-rows branch returns `null` for `sum` while a non-empty group with an
  all-null field returns `0.0` for `sum`. Both are AC-specified, so no change requested — but say so
  in the step's doc comment, since the asymmetry will read as a bug to the next person.
- `usePipelineRunEvents`: reset `nodeId`/`nodeRowCount` when a run-level `queued`/`running` event
  arrives, so per-node state cannot leak across runs before P1.3 renders it.
- Tasks 4.5 / 4.6 / 5.6 / 10.5 are acceptable deferrals provided they land in a named follow-up
  ticket rather than being dropped.

## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed tree: `4429d46fd66efd2f40ad18adea6bc9e1bdfd07ec` (branch `feature/ndjson-draft-preview-endpoint/HEL-1630`; the change dir is untracked planning output). Rulings A, F, C1 and C2 were not re-opened.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/ndjson-draft-preview-endpoint/HEL-1630`.
- **Round-3 CR2 (closure over lane edges): resolved for enabled steps.**
  - D3 now uses one `dependentsClosure` over child and lane edges from every seed, and `onNodeError` shares it.
  - The spec adds "Unavailability propagates over child and lane edges" with the lane-on-`sourceNotSupplied`-join scenario.
  - Task 3.1 carries the unit case.
  - For enabled steps, this closes the `InProcessPipelineEngine.scala:403-415` lane-violation path. Disabled steps are a separate gap (CR2).
- **Round-3 CR3 (abort mutations): resolved.**
  - D4 now says the outcome is `aborted` if and only if the walk's Future failed with `DraftPreviewCancelled`, never read from the flag.
  - 5.9 asserts exactly 1 node evaluated.
  - **Mutation "remove `shouldContinue`":** the hold is released, node 2 evaluates (`loop`, `:458-475`), and its offer to the closed queue fails. Result: count 2 and `failed`. Red.
  - **Mutation "route cancel through `onNodeError`":** later nodes are pruned and the walk completes. The outcome is not `aborted`. Red.
  - The wrong "(the sibling still runs)" parenthetical is gone.
- **Round-3 CR1 (memory bound): only partly resolved.**
  - **What holds:** the false sentence is gone. `maxNodeRows = 20,000` and the join pre-check are specified (D7, task 2.2, spec "A node's output is bounded").
  - **Lookup:** "lookup one-to-one" is true. `LookupStep.scala` `rows.map` uses `matches.head`.
  - **Union:** "union additive" is accepted.
  - **What fails:** the claim that the post-node bound contains every other kind is false. See CR1.
- **Round-3 non-blocking notes: adopted.**
  - The default `rowsStepId` is one phrase: lowest-position chain from `roots[0]`, which avoids `trunkOfRoot`'s `position == 0` restriction.
  - The empty trunk is defined as `step: null` plus the root frame.
  - A disabled `rowsStepId` is defined. `evalNode` stores a pass-through frame in `nodeOutcomes` (`:441-442`, `:467-469`), so "carries its pass-through frame" can be implemented.
  - `rootId` on a parented step is a 400.
  - The burst is 40 ms in 5.12.
- **5.12 floor mutation check:** each 40 ms burst plus 360 ms gap repeats every 400 ms. With `floorMs: 0`, the debounce fires 350 ms after the last edit, so gaps are about 400 ms, under 600. Red. `maxWaitMs` (600) is never reached inside a 40 ms burst.
- **Other step kinds that multiply rows, checked in the live tree:**
  - `UnpivotStep.apply`: `rows.flatMap(row => valueVars.map(...))` gives exactly `rows × valueVars.length`, and `valueVars` is an unbounded config array.
  - `ChunkByTokenCountStep.apply`: `chunkSize = math.max(cfg.targetTokenCount, 1)`, which emits one row per token at `targetTokenCount: 1`.
  - `SplitTextStep.apply`: one row per paragraph or heading segment.
  - All three are eager `flatMap` and build the whole `Seq` before `evaluate` returns. The engine sees the frame only afterwards, at `loop`'s `flatMap { nextFrame => ... }` (`:465`).
- **Disabled steps in the engine:** `laneDep` (`:379`) and the lane check (`:403-415`) cover every step, enabled or not. `isReady` (`:453-455`) requires the parent and the lane dependency to be evaluated, whether or not the step is enabled.

### Verdict: REFUTE

Rounds 1-3's CRs are otherwise sound against the live tree. Two defects remain, both of the kind the orchestrator asked me to probe. A third is a small C3 issue in the new 5.8 proof.

### Change Requests

1. **D7, spec "A node's output is bounded", task 2.2: three more server-evaluated kinds materialise unbounded output before the post-node check.** In each case below, `executeTree`'s post-node `maxNodeRows` check runs only after the whole `Seq` exists. So the check is a label applied after the OOM, not a bound. The prod heap is about 768 MB.

   **The three kinds:**
   - **`unpivot`:** output is exactly `inputRows × valueVars.length` (`UnpivotStep.scala`, `apply`). `valueVars` is a config array whose length only the 4 MiB body bounds. A 10,000-row root with a 10,000-entry `valueVars` (about 60 KB of config) materialises 10^8 rows in one node.
   - **`chunkbytokencount`:** this is one of the two kinds this endpoint exists for. `targetTokenCount` is clamped to 1, so it emits one row per token. That alone is about 10^6 rows from a 4 MiB body.
   - **`splittext`:** it emits one row per segment.

   **Why the byte cap does not bound the last two:** both are bounded by the *bytes of their input*, and a join can duplicate references below the 20,000-row cap.
   - Example: a 1-row left frame holding a 2 MiB text cell, inner-joined to a 10,000-row lane on one key, gives 10,000 rows. That passes the pre-check.
   - Every one of those rows shares the same 2 MiB `String`.
   - A following `chunkbytokencount` at `targetTokenCount: 1`, or a `splittext`, then materialises about 10,000 × 500,000 rows, plus 10,000 substring copies of the text.

   **Required (pick and state):**
   - (a) **`unpivot`:** pre-check `rows.size.toLong * valueVars.length` before materialising, the same way as the join.
   - (a) **`splittext` and `chunkbytokencount`:** emit through a bounded builder that fails with the `maxNodeRows` message as soon as the running count passes 20,000, for example a counted iterator or builder. The check must happen during emission, not after `flatMap` returns. Both run only when `maxNodeRows` is set, so runs are unchanged.
   - (a) **D7 text:** state the rule as "every kind whose output can exceed its input (join, unpivot, splittext, chunkbytokencount) is bounded before or during materialisation; the post-node check is a backstop". Update the spec requirement to name them.
   - (b) **Otherwise:** narrow the requirement honestly and record the exposure as an accepted risk with reasoning. The round-3 option (b) is still available. The design and spec must stop claiming a bound they do not have.
   - **5.8 proof (if a):** add one case for each guarded kind (a `valueVars` product over 20,000, and a `targetTokenCount: 1` chunk over a large text cell), each with the mutation "remove the guard". Keep the fixture small enough that the unguarded red ends in the post-node message rather than an OOM (see CR3).

2. **D1, D3, task 3.1: disabled steps inside or touching the unavailable closure make the whole walk `failed`.** D1 says disabled steps are "never marked unavailable", and that "the planner considers enabled steps only". The engine still gates disabled steps on their parent and their lane dependency (`isReady`, `:453-455`). The lane check also covers disabled steps (`laneDep` `:379`, check `:403-415`).

   **Failing cases:**
   - **Disabled child below a seed:** for example AI step A, then disabled filter D, then enabled select S. Suppose the closure is read as enabled-only, or as an edge closure from which disabled members are not removed. Then D stays in the walk with `parentKey = StepKey(A)`, and A is never evaluated. `loop` finds no ready node and fails with "Cyclic or unresolved lane reference". The request ends `failed` instead of giving S `downstreamOfAiStep`.
   - **Disabled step with an unresolved lane:** a disabled join whose lane points at a removed step, or at a step that is neither in the request nor in `lanes`, trips `laneViolation` before any node runs.

   **State the rule.** The closure traverses disabled steps through both edge kinds. A disabled step in the closure is removed from the walk with **no line**, and its enabled descendants get `downstreamOfAiStep` or `downstreamOfUnavailable`. A disabled step's own lane reference must never fail the walk. For example, replace every disabled step with a disabled identity step with the same id before the walk, the same mechanism D2 already uses for `upsertsource`. That drops its `laneDep` while keeping pass-through.

   **Proof:** add 3.1 planner cases and one spec scenario:
   - AI step, then disabled step, then enabled step. The enabled step is `downstreamOfAiStep`, the disabled step has no line, and the stream ends with `rows`.
   - A disabled join whose lane is unsupplied. Its children are walked over the pass-through frame.

   Apply the same rule to `onNodeError` pruning: a pruned disabled descendant gets no `downstreamOfError` line, which is consistent with "no line".

3. **Task 5.8 / D7 (C3): the join pre-check mutation's predicted red is wrong and would crash the test fork.** 5.8 says "10k x 10k one-key join, mutation: remove the join pre-check -> post-node message -> red".
   - **What actually happens:** with the pre-check removed, `JoinStep`'s inner `flatMap` (`JoinStep.scala:75-80`) materialises 10^8 merged maps before the post-node check can run. Under the local `-Xmx3g` forked test JVM, that is an `OutOfMemoryError` that takes down the forked test group, not a post-node `error` line.
   - **Fix:** keep 10k × 10k as the green scenario if wanted, but name a mutation fixture whose unguarded output is just over the bound, for example 150 × 150 on one key (22,500 rows). The red is then the post-node message, as stated, and stays bounded in time and heap.
   - Apply the same sizing to the new CR1 cases.

### Non-blocking notes

- **Spec abort scenario:** it still says "evaluates fewer steps than the draft contains". Align it with D4 and 5.9: exactly the steps that began before the abort, here 1.
- **Cells, not just rows:** `maxNodeRows` bounds rows, not cells. A very wide left row (tens of thousands of columns within 4 MiB) fanned out to 20,000 rows by a join goes through `leftRow ++ renameRightRow(...)` (`JoinStep.scala:67-68`). Its memory then depends on HAMT structural sharing. Consider adding a column-count cap per frame (for example 500) to D7's request caps, or including a wide row in the 5.10 heap shape.
- **Heap shape (5.10):** once CR1 is done, the worst node is still bounded at 20,000 rows, so D7's shape stays representative. No change is needed beyond CR1.

### Gate-defect check (CON-160)

No evaluator report exists yet. This report relies on no mtime-ordering evidence. No gate defect to record.

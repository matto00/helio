## Skeptic Report — final gate (round 1, skeptic-final-2-engine-parity.md)

Dimension: engine correctness / AC1 parity ONLY (parallel skeptics own snapshot semantics,
graph-invariant enforcement, wire/SSE contract). Filename carries a dimension suffix on the
`next-report-number.sh` number (2) to avoid collision with the three parallel skeptics writing
into the same change dir this round, matching the existing `skeptic-final-1-graph-invariant.md`.

### What I verified (with evidence)

1. **Retained fold is genuinely unreachable from production.**
   `grep -rn "executeWithStepCounts\|engine.execute(" backend/src/main` → the only in-main
   references are the engine's own `execute` delegate (`InProcessPipelineEngine.scala:118`) and
   comments. The single production caller of the engine,
   `InProcessExecutionBackend.scala:27`, calls `executeTree` exclusively.
   `PipelineRunService.scala:312,473` go through the `PipelineExecutionBackend` trait, not the
   engine. Confirmed: zero production reachability.
2. **Scaladoc says so explicitly.** `InProcessPipelineEngine.scala:130-140` states "test-only as of
   P1.2", names `InProcessExecutionBackend` as the only production caller, says "Do not delete this
   as apparent dead code -- doing so silently destroys the parity proof it backs", and names the
   fallback (frozen on-disk fixtures). Adequate protection against a future deletion.
3. **AC1 test coverage — read the file, not the reports.**
   `InProcessPipelineEngineTreeWalkSpec.scala:47-58` (single-step trunk parity, rows + stepCounts),
   `:62-83` (multi-step trunk `rename → disabled rename → filter`, comparator
   `steps.filter(_.enabled)`, asserts rows equality, `s2` absent from stepCounts, and s1/s3 count
   equality with the flat fold), `:85-100` (failing-step attribution: `stepId`, `stepKind`,
   `getMessage` compared between `executeTree` and `executeWithStepCounts` on a `regexExtract`
   missing `pattern`). All three cases evaluation-1.md CR6 / evaluation-2.md required are present
   and assert what is claimed.
4. **Suite runs green, fresh, by me.**
   `sbt -batch "testOnly ...InProcessPipelineEngineTreeWalkSpec ...InProcessPipelineEngineSpec"`
   → `Tests: succeeded 196, failed 0`, exit 0.
5. **Mutation-failability proven by me, not taken on faith.** Created a throwaway
   `git worktree add --detach` at `e84aec89` in the scratchpad, mutated one line at a time, ran the
   suite, then `git worktree remove --force` (verified gone; `git status --porcelain` in
   `WORKTREE_PATH` shows only the untracked report files, no source modifications):
   - `evalNode`'s `if (step.enabled)` guard removed (disabled step no longer transparent) →
     **RED**: `List() was not equal to List(Map("renamed" -> "alice"))` at TreeWalkSpec.scala:77,
     plus the two disabled-step cases at :163 and :171.
   - `walkTrunk`'s trunk-child count `nextFrame.size` → `frame.size` → **RED**, only the widened
     AC1 case (proves the `stepCounts` value comparison, not just the key set, is load-bearing).
   - `evalNode` wrapped with `.recover { case _ => Seq.empty }` (swallow a step failure) →
     **RED**, the attribution case. So that test is non-vacuous despite both engines sharing
     `evalOneStep`: it catches a tree walk that swallows or reclassifies a step failure.
6. **Implementation vs design.md, read directly (`InProcessPipelineEngine.scala:155-268`).**
   - Trunk and tails both evaluate via the single extracted `evalOneStep` (`:75-109` of the
     numbered listing / `:164-198` in-file) — verbatim reuse, so parity is structural, not
     coincidental. ✔ Decision 9.
   - `walkTrunk` (`:240-263`) calls `evalTails(nodeId, frame, ...)` with the node's **own incoming
     frame** before advancing, and threads only `nextFrame` into the trunk continuation; tails'
     rows are never folded back. ✔ Decision 2 step 4; guarded by the `t1`-sees-`renamed` test
     (`:104-118`).
   - Disabled nodes: `evalNode` (`:235-236`) passes the frame through; `foldChain` (`:225`) and
     `walkTrunk` (`:257-259`) both suppress the `stepCounts` entry; the node still gets a
     `NodeOutcome`. ✔ Decision 7 / CR5, on trunk **and** tail.
   - `foldChain` (`:216-231`) records a `NodeOutcome` and fires `onNodeProgress` for **every** step
     in the chain via `accOutcomes.updated(key, ...)` inside the fold, not only `chain.last`. ✔
     CR2; guarded by the multi-step-tail test (`:122-134`).
   - Root-level tails are handled by the same `evalTails(None, rows, ...)` call (`walkTrunk` is
     seeded with `nodeId = None`, `:265`), consistent with `childrenOf`'s
     `steps.filter(_.parentStepId == parent)` root convention
     (`PipelineStepRepository.scala:530-531`).

### Verdict: CONFIRM

Within my dimension (engine correctness / AC1 parity) I found nothing blocking. The parity oracle is
correctly retained, documented against deletion, unreachable from production, and its three AC1
assertions are all failable by mutations I performed myself.

### Non-blocking notes

- `expandChain` (`InProcessPipelineEngine.scala:180-187`), `validateGraph`'s `isTailNode`
  (`:126-128`), and `PipelineRunService`'s `pathToRoot` (`:294-299`) all recurse over
  `parentStepId`/child links with no cycle guard — a cyclic `parentStepId` would hang or
  `StackOverflowError` rather than raise `InvalidGraph`. Not reachable via current writes and
  arguably the graph-invariant skeptic's territory, but worth a spinoff if that skeptic does not
  already carry it.
- The AC1 parity tests use `RenameStep`/`FilterStep`/`StringOpsStep` only. Parity for
  frame-shape-changing kinds (aggregate, join, union) rests on the shared `evalOneStep` body rather
  than on a direct comparison; acceptable given the verbatim extraction, but a single
  aggregate-in-trunk parity case would cheaply widen the oracle.
- No test asserts a root-level tail (`parentStepId = None`, `position >= 1`) specifically; the path
  is the same code as the node-level tail, so this is coverage completeness, not a suspected defect.

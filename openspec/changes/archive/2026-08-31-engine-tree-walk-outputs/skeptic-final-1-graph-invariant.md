## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Scope: Phase-1 graph invariant / `InvalidGraph` enforcement ONLY (1 of 4 parallel final-gate skeptics).

### What I verified (with evidence)

1. **Validated up front, whole tree, before any evaluation.**
   `InProcessPipelineEngine.scala:262-264`: `executeTree` opens with
   `validateGraph(steps, stepRepo) match { case Left(invalid) => Future.failed(invalid); case Right(()) => ... }`.
   The `makeContext` call, all closure definitions, and `walkTrunk(None, rows, ...)` live inside the
   `Right` branch — there is no path on which a step evaluates before the check. `validateGraph`
   (`:210-241`) iterates `None +: steps.map(s => Some(s.id))` — every node including the virtual
   root — not lazily along the walk.

2. **Both arms correct.**
   Arm (a) `:219-227`: for each node, `stepRepo.childrenOf(steps, nodeId).count(_.position == 0) > 1` → violation.
   `childrenOf` (`PipelineStepRepository.scala:530-531`) is a pure `filter(_.parentStepId == parent).sortBy(_.position)` —
   no dropping/deduping, so the count is faithful.
   Arm (b) `:231-237`: `steps.iterator.filter(isTailNode)` where `isTailNode` (`:215-217`) is `position >= 1`
   or transitively reached from such a node via `parentStepId`; for each such node
   `childrenOf(...).count(_.position >= 1) > 0` → violation. Trunk nodes and the root are correctly
   never classified as tail nodes.

3. **Error identifies the offending node, matching design.md's format.**
   `:225` emits exactly `InvalidGraph: node <id> has N children at position 0` (root renders as `root`).
   Arm (b) `:235` emits `InvalidGraph: node <id> is a tail with N children at position >= 1` — a distinct,
   node-identifying message (design.md only fixed the arm-(a) wording).

4. **No silent pick before the check.** The two `.find(_.position == 0)` sites (`expandChain` `:271`,
   `walkTrunk` `:339`) are both inside the `Right(())` branch, i.e. structurally unreachable on an
   invalid tree. `execute`/`executeWithStepCounts` (the old flat fold, `:118`/`:140`) have no
   production caller: `InProcessExecutionBackend.scala:27` calls `executeTree` exclusively, and both
   `PipelineRunService` call sites (`:312` previewStep, `:473` executeRun) go through
   `backend.execute` → that same backend. Grep for other engine entry points found none.

5. **Root-level tails are ordinary tails, not violations.** `validateGraph` checks only the position-0
   count for `nodeId = None`; there is no rule that flags a `position >= 1` child of the root. At runtime
   `walkTrunk(None, rows, ...)` (`:350`) calls `evalTails(None, frame, ...)` (`:333`) which picks up
   `childrenOf(steps, None).filter(_.position >= 1)` and folds each from the source frame. Design
   Decision 2 point 2 is implemented as written.

6. **Task 2.7 tests exist and pass (re-run by me, not trusted from a report).**
   `InProcessPipelineEngineTreeWalkSpec.scala:140-155` — "reject a node with two position-0 children…"
   and "reject a tail node with a position>=1 child of its own". Ran
   `sbt -batch 'testOnly com.helio.domain.engine.InProcessPipelineEngineTreeWalkSpec'`:
   `Tests: succeeded 10, failed 0` (both invariant cases listed as passing). Both assert the message
   substring, so they are failable: with the check removed, the pure `rename` steps would succeed and
   `intercept[InvalidGraph]` would fail — no separate mutation edit needed to establish that (and I
   made no edits, per read-only discipline).

7. **HEL-930 gap — independently reproduced and judged.** Confirmed the described gap is real and
   slightly stronger than "the layers disagree": `PipelineStepRepository.executionOrder:584-594`'s
   `walk` uses `children.find(_.position == 0)` and only expands non-zero children via `expandBranch`,
   so a second position-0 sibling is **omitted from the Vector returned by `listByPipelineInternal`
   (`:160-163`)** entirely. The engine therefore never sees the violating shape on the production read
   path — arm (a) is engine-unreachable in production, exactly as design.md states. Arm (b) is NOT
   affected (tails go through `expandBranch`, which retains all children), so arm (b) is enforced
   end-to-end.
   I spot-checked the "no write path can create it" premise the acceptance rests on:
   `insertInternal:191-194` (`position = maxPos+1` or `0` only when there are no siblings),
   `spliceInsertAtInternal:362-375` (inserts at 0 and re-parents the existing children under it),
   `reorderInternal:403-412` (assigns the list index, so at most one `0` exists). None can produce two
   position-0 siblings. The premise holds.

   **My judgment on the AC wording:** "The engine rejects a violating graph before running with a named
   error… never silently picks one" is satisfied. "The engine" is the `InProcessPipelineEngine`, and it
   does reject every violating tree it is handed, deterministically and without picking. The residual
   is in a pre-existing HEL-904 repository method this ticket does not touch, is unreachable from any
   write path, is disclosed in both design.md Decision 8 and the code (`:200-209`), and is owned by a
   filed ticket (HEL-930) — which is exactly the standard a deferral has to meet. Requiring the
   repository fix here would be scope creep into HEL-904's surface with no reachable defect behind it.
   Not a REFUTE.

### Verdict: CONFIRM

### Non-blocking notes
- The arm-(a) test's title claims "never evaluating a step" but asserts only the exception message; no
  probe proves non-evaluation. It is structurally guaranteed by `:262-264`, so this is a naming/evidence
  nit, not a hole — a counting `stepRepo`/side-effecting step would make the claim self-evident.
- No test covers a **root-level tail** (`parentStepId = None, position >= 1`); every tail fixture in the
  spec hangs off a trunk step. The implementation is correct by reading (`:333`, `:350`), but Decision 2
  point 2 — an explicitly resolved round-1 open question — has no direct regression guard.
- `isTailNode` (`:215-217`) is an unmemoized walk up the parent chain; a cyclic `parentStepId` chain
  would stack-overflow rather than produce a named error. Not creatable by any write path (same premise
  as above), and O(depth) per node is negligible at Phase-1 tree sizes.

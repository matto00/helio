## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `6ac99447d07fd5bf5ee065b1141c1a31d0ea08a8`. The planning artifacts are uncommitted (`?? openspec/changes/window-rolling-followups/`). Scope is items 2, 3 and 4. Item 1 is out of scope by driver decision, so I do not count its absence against the plan.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/window-rolling-followups/HEL-1489`.
- **Call sites cited in design.md Context:** all of them exist at the cited lines.
  - `PipelineStep.scala:289` (`rawConfigProblem`).
  - `PatchSetPipelineStepResolvers.scala:50` (update) and `:223` (create). Both use the `edit $index: $msg` prefix and return 422.
  - `PatchSetPipelineResolvers.scala:138` calls `PipelineCreatePreflight.run`, which reaches `:155`. The message there is `Step '<clientId>': $msg` (422).
  - `PipelineProposalService.scala:298`. The message there is `step ${idx+1}: $msg` (422).
- **Item 4:** `WindowStep.scala:218-223` has misaligned arrows. The `running_sum` row is wider than the rest. A whitespace-only fix with an empty `git diff -w` is a sound check.
- **Item 3:**
  - `WindowConfig.tsx:251/255, 270/275, 297/301` hard-code `window-offset-input`, `window-frame-size-input` and `window-output-column`. `useId` is already imported (l.11, l.101).
  - A repo-wide grep for the three literals (excluding node_modules and .git) finds no consumers outside `WindowConfig.tsx` and openspec docs. There are no e2e or CSS consumers.
  - The design is right that the offset input collides too, and the ticket missed it.
- **Referenced specs and harnesses exist:** `PatchSetStepCreateConfigRoutesSpec`, `PipelineApplyProposalSpecBase`, `WindowRollingSeamSpec`, `WindowRollingValidationSpec`, `WindowStepRollingSpec` and `WindowRollingAnalyzeSpec`. The two planned new spec names do not exist yet, so there is no collision.
- **Spec delta:** `openspec/specs/pipeline-window-op/spec.md` exists. An ADDED requirement for unique ids is appropriate. No API or schema change, so no contract delta is needed.
- **Patch-set mutations can turn red.**
  - If a resolver's `rawConfigProblem` check is removed, the edit reaches forward-apply (`PatchSetApplyService.applyResolved`). There, a `Left` from `applyOne` is rolled back and returned as **HTTP 200** with `failure = Some(msg)` (PatchSetApplyService.scala l.121-129).
  - So the expected 422 fails under any of the three patch-set mutations. The planned `edit N: ` prefix assertion also discriminates.
- **Apply-proposal mutation CANNOT turn red as designed** (traced):
  1. `PipelineProposalService.apply` runs `validateStructure`, then `validateSteps` (l.298), then `createPipeline` (l.454).
  2. `createPipeline` calls `pipelineService.create(...)` with `steps = proposal.steps`.
  3. That reaches `PipelineCreateWrites.checkedCreate`, where `transactional = req.steps.nonEmpty || ...` (l.73). `PipelineCreatePreflight.run(req)` (l.78) then calls `checkStep`, which runs `rawConfigProblem` at `PipelineCreatePreflight.scala:155` and returns 422.
  4. Result: when l.298 is mutated to `None`, the request **still gets 422**. The message still contains the frame text (`Step 'c1': window function ... `), and no pipeline is created, because preflight runs before any write.
  5. The test matrix in Decision 2 asserts 422, the frame text and no pipeline. Under that matrix, the per-call-site mutation in Decision 3 stays green.
  6. The reverse also holds: mutating only `:155` leaves l.298 rejecting first, so that stays green too.
- **The WindowStep "rolling-specific mutation" claim is wrong.**
  - `validateRawConfig` (l.359-362) runs `rawFrameSizeProblem` (l.168-176) first. That check rejects any present `JsNumber` outside 1..1000, which covers 0, 1001, 7.5 and 5000000000. Only after that does it run `enumProblems`, which calls `rollingFrameProblems` (l.146-148) and rejects 0 and 1001 a second time.
  - Dropping the l.147 range check therefore turns **no** frame-size case red.
  - Dropping `rawFrameSizeProblem` turns only the 7.5 and 5e9 cases red. 0 and 1001 stay rejected by l.147.
  - So Decision 3's "must turn the frame-size cases red on every route" is not achievable with any single line as written. An executor following it would report a false "finding".

### Verdict: REFUTE

Category: spec-divergence (the mutation-proof plan, which AC2d depends on, does not match the code's real validation topology).

### Change Requests

1. **Apply-proposal discrimination (design.md Decisions 2 and 3, tasks 3.2 and 3.4).**
   - The apply-proposal test must assert the route's own message prefix, `step 1: ` (from `PipelineProposalService.scala:299`). It must not assert `Step '<clientId>': ` (from `PipelineCreatePreflight.scala:156`). Pin it exactly, for example `message should startWith ("step 1: window function 'rolling_avg' ...")`.
   - State the expected outcome explicitly. With l.298 mutated to `None`, the response is still 422, but the message changes to the `Step '...'` form, and that change is what makes the test go red.
   - Record in design.md that `PipelineCreatePreflight` (via `pipelineService.create`) is a defense-in-depth second gate on this route. Then the executor will not treat a still-422 under mutation as a surprise "finding".
2. **Rewrite the WindowStep mutation in Decision 3 (and task 3.4) to match the real double gating.**
   - Either drop the "frame-size cases red on every route" requirement, or name exact one-line mutations with the outcome each one produces:
     - (a) `rawFrameSizeProblem` returns `None`: the 7.5 and 5e9 cases go red on every route. The 0 and 1001 cases stay green because `rollingFrameProblems` l.147 still rejects them.
     - (b) l.149's unsupported-`frameUnit` branch is removed: the `weeks` cases go red.
     - (c) l.151-153's days/orderBy branch is removed: the multi-key and descending `days` cases go red.
   - Note that 0 and 1001 are each covered twice inside WindowStep, so only the call-site mutations prove them, which is acceptable.
3. **Tighten the frame-size message assertion in Decision 2.**
   - The suggested substring `requires 'frameSize'` also matches the draft message `window function '<f>' requires 'frameSize'` (l.160).
   - Assert `requires 'frameSize' to be an integer in 1..1000, got <value>` instead. For frameUnit, assert `has unsupported frameUnit: 'weeks'`. For days, assert `with frameUnit 'days' requires exactly one ascending 'orderBy' key`.

### Non-blocking notes

- Patch-set pipeline-create:
  - Decision 3 lets the executor mutate either `PatchSetPipelineResolvers.scala:138` or `PipelineCreatePreflight.scala:155`. Both turn red (HTTP 200 with a forward-apply failure, or a created pipeline).
  - Mutating `:155` also disables the proposal route's second gate. Each mutation should be applied and reverted on its own.
- Item 3: the two-editor test should also assert that each label's `htmlFor` matches an input inside the same editor container (via `within(container)`), not only that the ids are globally unique. The spec scenario requires this. The design phrase "one distinct input per editor" roughly covers it.
- `POST /api/proposals/apply` (CombinedProposalRoutes) is another pipeline-proposal-bearing write route. The ticket does not name it, so it is out of scope.

## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD `9c41719c376b858ab9269fa6075f8b3b74acabd1`. The change dir is untracked and there are no commits beyond main. HEL-1340 has not merged: there is no `usePipelineStepCreation.ts`, and `git log origin/main --grep HEL-1340` is empty. This was a read-only review: no sbt, Jest or Playwright, and no dev-DB access.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/rootid-step-create-placement/HEL-1345`.

**Focus 1: is the create response the complete server-side effect? Yes.**
- `spliceInsertReportingInternal` (`PipelineStepRepository.scala:683-750`):
  - It inserts one row at `position 0`, with `parent = anchor`, or with `root_id = rid` for the root arm.
  - For each step in `existingChildren` it updates only `(parent_step_id, root_id, updated_at)`, to `(newId, None, now)`. Positions are not touched.
  - It returns `existingChildren.map(_.id)`.
- `attachTailInternalAction` (:794-812) inserts only.
- The route (`PipelineStepRoutes.scala:30`) returns `createdStepJson(resp, moved)`, and `PipelineStepProtocol.scala:440-442` always includes `reparentedStepIds`.
- A reparented row keeps its position, so a former tail stays `position >= 1` under the new step, and the client's position-preserving delta matches.
- For the root arm, every parentless step of that root moves under NEW, which is a root-level step at `position 0`. The delta covers that too.
- D5's premise holds.

**Focus 2: do the deltas commute for overlapping creates? No: they fail when responses arrive in the reverse of commit order.** See CR1.
- Creates at different slots commute. Example on trunk A, B, C: X is anchored at A and reparents B; Y is anchored at B and reparents C. Applying the two deltas in either order gives A→X→B→Y→C.
- Creates at the same slot do not commute in arrival order (trace in CR1).

**Focus 3: the immediate-path swap with no renderKey keeps HEL-1294 semantics. Behaviourally yes.**
- After `await createPipelineStep`, the swap's `setSteps` and the `finally`'s `markCreating(false)` both run synchronously in the same continuation, so React batches them into one render.
- The card is keyed by the persisted id (`stepRenderKey`, `stepTree.ts:51`) and is not in `creatingStepIds`. That is the same end state as today's GET-then-finally, only reached sooner.
- The created card cannot be expanded before the swap: `StepCard.tsx:243` sets `disabled={isCreating}`, and Remove only exists inside the expanded body (:416-421).
- The existing tests that guard this behaviour are coupled to the GET being removed. See CR2.

**Focus 4: is D11 implementable against `PipelineRiverView` and `buildLaneGraph`? Yes.**
- The gaps are `renderGap(0)` plus `renderGap(idx + 1)` for `idx < primarySteps.length - 1` (`PipelineRiverView.tsx:350-457`). They index `primarySteps`, which is root 0's first root-level lane (:177-181), and never reach the flat length.
- `handleAddStep` passes `stepsRef.current.length`, so `isAppend` is still true and append still sends no `position`.
- In real data, local-only temps (from `makeStep`, which has no parent or root) are appended to the end of the first non-empty lane by the totality sweep (`stepTree.ts:211-232`). "The nearest persisted step before the gap" is therefore well defined, and `isTempStepId` (`stepNarrowing.ts:408`) is the existing predicate for local-only.
- I hand-checked the existing pins:
  - `PipelineDetailPage.test.tsx:1946-1953`: gap 0 is HEAD, which gives `position 0`.
  - :1970-1977: gap 1 anchors on Rename, which is trunk index 0 and not last, so `position 1`.
  - :1992 (append): no `position`.
  - :638 and :686 (bottom add, `undefined, …, "root-1"`): unchanged.
- In the legacy flat fixtures (no parent or root) the first unassigned step in array order seeds the lane, so the gap-to-anchor mapping still holds.
- `handleInstantiateShape` (:1025-1037) sends `rootId` with no `position` only for an empty pipeline, where it behaves the same before and after. Otherwise it sends `parentStepId`, so the change does not affect it.

**Focus 5: no stale reconcile or guard text remains.**
- I grepped proposal, design, tasks and every spec delta for `reconcil|sequence|discard|GET|wholesale|guard`.
- Every remaining hit is the HEL-1069 `rejectIfReparents` guard, the "why no GET" rationale, D4's route-test GETs, or the carried verbatim spec bullet "reconciling with the persisted step on success".

**Focus 6: every AC is covered by a task.**
- AC1: task 1.1, the red run.
- AC2: tasks 1.1-1.3, including multi-root and the legacy `position 1` head.
- AC3: task 2.1.
- AC4: tasks 1.5 and 1.6.
- AC5: tasks 3.1-3.3 (red tests, local-only drafts kept, `renderKey` carried).

**Backend D1-D4 and D10:** unchanged since round 2, which verified them. I re-read `persistNewStep` (`PipelineService.scala:1951-2100`) and `laneCheckF` (:1869-1887) and they still match the design's description.

### Verdict: REFUTE

### Change Requests

1. **D5's commutation claim is false when two same-slot creates' responses arrive in the reverse of their commit order.** The result is exactly AC5's symptom: a step whose server parent changed stays stale on screen.
   - Trace, trunk A, B. Immediate or draft insert X at the gap after A, then insert Y at the same gap while X is in flight. Both resolve to anchor A (`position 1`).
     1. The server commits X first: A→X→B, and X's response says `parent=A`, reparented `[B]`.
     2. The server commits Y next: A→Y→X→B, and Y's response says `parent=A`, reparented `[X]`.
     3. Y's response reaches the client first. `applyCreatedStep` swaps Y in, but X's persisted id is not present locally (X is still its temp id), so the reparent is skipped. D5 says "skips ids no longer present locally".
     4. X's response arrives. X is swapped in with its stale `parent=A`, and B moves under X.
   - Final local state: A has two `position-0` children, Y and X. `buildLaneGraph` takes the first as continuation and pushes the other into a child lane of A. The server has A→Y→X→B.
   - This persists until some later full sync. It also breaks D11: the client's "persisted trunk" no longer matches the server's, so later positions resolve against the wrong trunk.
   - The ordering is reachable: X's post-commit work (`stepResponseWithRoot`, another DB read) races Y's commit and response. Cloud Run runs up to 2 instances, and HTTP responses are not ordered across requests.
   - The spec scenario "Overlapping creates … complete in either order … every step shows the parent the server persisted" therefore cannot be met by D5 as written.
   - Task 3.2(c) "completing in both orders" is ambiguous between commit order and arrival order. A server-consistent mock of reverse arrival is red with no designed fix, and a naive mock is vacuous.
   - Required revision, pick one and state it in D5:
     - (a) **Serialize trunk creates in the hook.** Chain each `handleInsertStep` create and draft create on one promise, so request N+1 is sent only after N's delta is applied. This also makes D11's create-time resolution read a trunk that already contains N.
     - (b) **Keep a hook-level pending-reparent map.** When a `reparentedStepIds` entry is not present locally, record `persistedId → created.id`. When a later swap brings that persisted id in, apply the recorded parent (and clear its `rootId`) instead of the response's stale one.
   - Then restate the "commutes" paragraph to match the chosen mechanism.
   - Make 3.2(c) explicit: the second-committed create's response arrives first, and its `reparentedStepIds` names the first create's persisted id. Assert the final local parents equal the server's (A→Y→X→B).

2. **Replacing the immediate paths' resync breaks or hollows out existing HEL-1294/HEL-1321 guard tests. The design lists none of them, but declares any unplanned existing-test edit a stop-and-report.** Today a test that stays green but stops exercising its window would pass silently, which is the worst outcome for C1. The plan must name and adapt:
   - `PipelineDetailPage.creatingStep.test.tsx:238` ("disables the toggle … until the resync lands"):
     - It holds the post-create `getPipelineSteps` call, which D5 no longer issues.
     - The "in flight" window it asserts (`toBeDisabled` after `waitFor(create called)`) now closes on the create's own resolution, a microtask later.
     - So the test either passes vacuously or races. It must hold the create promise instead of the GET.
   - `PipelineDetailPage.creatingStep.test.tsx:310` (lane-add not expandable in flight): same coupling, same fix.
   - `PipelineDetailPage.draftCreate.test.tsx:400` ("a later full resync keeps the created draft's card open"):
     - Its trigger is "A create-immediately add triggers `syncStepsFromServer`", which D5 removes, so the test stops exercising the `renderKey`-across-full-replace path.
     - That path still exists: remove, duplicate and root removal keep `syncStepsFromServer`.
     - Retarget the trigger to one of those callers, e.g. duplicate.
   - `PipelineDetailPage.test.tsx:2037-2042` and `:2083`: these queue `getPipelineStepsMock.mockResolvedValueOnce(...)` for the post-insert resync.
     - Nothing will consume those values now.
     - `jest.clearAllMocks` in `afterEach` (:413) does not discard queued once-values. They can leak into a later test's page-load fetch.
     - Remove them, and re-express "server truth after insert" through the create mock's `reparentedStepIds`.
   - Add these to tasks 3.2/3.3 as planned edits, each with its reason, and with the requirement that each rewritten guard is shown red by a mutation. For example, move `markCreating(false)` before the create resolves.

### Non-blocking notes

- **D5's "replaces … by the created step (server fields)" needs a scope note.** On the draft path the temp's local `config` must be kept, as today's swap does (`config: s.config`, `usePipelineDetailPage.ts:1124-1130`). Otherwise an in-flight edit disappears from the card while HEL-1321's flush still PATCHes it. Test 3.2(a) pins this, but D5 should say so.
- **D11: name the mechanism by which `handleInsertStep` learns the anchor.** It receives only a lane `index`. Either recompute `buildLaneGraph(stepsRef.current, roots)` in the hook (deterministic, same inputs as the render), or widen `onInsertStep` to pass the anchor id. Use `isTempStepId` as the local-only test.
- **When a draft's temp is removed while its create is in flight**, the persisted step is an invisible server orphan and its reparented steps stay stale. D5's no-op preserves today's behaviour (pre-existing), but it is worth a follow-up.
- **Carried spec text vs D11:** "selecting a step creates it at that list index via the create endpoint's optional `position`" now contradicts the new anchor paragraph. Consider rewording it to "at that gap".
- **Pre-existing:** the totality sweep puts temps on the *first non-empty lane*. On a multi-root pipeline whose root 0 is empty, that is another root's column. Out of scope.

### Gate-defect check (CON-160)

No report in this review relied on mtime-ordering evidence. Not applicable.

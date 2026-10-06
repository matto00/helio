## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `b16bfa1b3a74905eefc0208a01793efa047909c5` (main). The worktree has no commits beyond main; the change dir is untracked.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/pipeline-step-create-followups/HEL-1340`.
- **Line anchors:** the hook is 1598 lines. The anchors hold: `pendingDraftMetaRef` :166, `creatingDraftIdsRef` :175, `draftCreateErrors` :179, `markCreating` :185, `stepsFingerprint` :361-362, `getDraftFallbackSchema` :557, fallback gates :573/:585, `syncStepsFromServer` :731, `handleInsertStep` :759, the draft create at :1095-1152, and the meta delete at :1103. The reorder carry `renderKey: s.renderKey` is at **:1290**, not :1291 (trivial).
- **Item 1 / D2:** the HEL-1321 `evaluation-2.md` probe (lines 57-78) exists and matches D2. It creates its draft through `gaps[gaps.length - 1]`, which is an **insert-position draft** (index 1, between anchor-1 and f-1), and it leaves `getPipelineStepsMock` returning `[anchor-1, f-1]` permanently. See Change Request 2.
- **D4 (item 3):** the hypothesis matches the code. After `pendingDraftMetaRef.current.delete(stepId)` (:1103), the temp id has no `analyzeByStepId` entry and fails the `.has` gate at :585, so it falls to `EMPTY_ANALYZE_SCHEMA`. HEL-1321 `skeptic-final-1.md:73` shows the placeholder in flight and says "After the create it shows `a`". The side observation about the temp id entering the fingerprint (:362) is correct. `analyzePipeline(id)` analyses server state, so the effect is probably only an extra request, and D4 already defers that to the probe. The post-swap window is a gap: see Change Request 4.
- **D5 hazard 1 (stale `stepsRef` on resync):** correct. `syncStepsFromServer` builds its `renderKeys` map from `stepsRef.current` (:736), and that is assigned only during render (:159). Before the swap, the temp step has no `renderKey`, and the swap is what sets it (`s.renderKey ?? s.id`, :1124). So a resync that reads a pre-commit `stepsRef` finds no key for the persisted id, and the card remounts collapsed. One wording correction: the read happens after the GET's `await`, not "in the same tick". The race is between the GET resolving and React committing the swap. The conclusion stands.
- **D5 hazard 2 (overwriting the latest config / flush):** correct. `syncStepsFromServer` does a plain `setSteps(freshSteps.map(...))` with server configs, which would drop `latest.config`.
- **D5 hazard list is incomplete:** a full-list replace drops every local-only step. The code already documents this as a hazard in `handleReorderSteps` (:1282-1285: "a wholesale replace would drop any temp step still mid-flight"). See Change Request 3.
- **Item 4 premise (insert-only scope):** I traced the wire contract end to end.
  - `handleInsertStep` stores `rootId: roots[0]?.id` in the draft meta for both append and insert (:775-778).
  - The draft create passes `meta.index, meta.parentStepId, meta.attachAsTail, meta.rootId` (:1104-1112).
  - `createPipelineService` puts **both** `position` and `rootId` on the wire when `parentStepId` is undefined (`pipelineService.ts:117,119`). The frontend test pins this call shape: `PipelineDetailPage.test.tsx:1944-1953` expects `(…, 0, undefined, undefined, "root-1")`.
  - On the backend, `persistNewStep` matches on `(req.parentStepId, req.rootId)` **before** it looks at `position` (`PipelineService.scala:1966`). The `(None, Some(rootId))` arm calls `spliceInsertReportingInternal(…, parentStepId = None, explicitRootId = Some(rootId))` and never reads `req.position` (:1974-1987).
  - With `(None, Some(rid))`, `spliceInsertReportingInternal` reads every parentless step of that root as `existingChildren` and reparents **all of them** under the new row (`PipelineStepRepository.scala:715-733`). By code reading, the new step becomes the root's **head**, whatever `position` was sent, and that holds for an append as much as for an insert.
  - The scaladoc says `rootId` means "a trunk continuation of THAT root" (`PipelineStepProtocol.scala:207-209`), which contradicts the implementation.
  - The only route test for `rootId` uses an empty second root (`PipelineStepRoutesSpec.scala:285-294`), so the reparenting path has no test at the seam.
  - I did not run a live probe (no dev-DB rows at this gate). This is code-reading evidence, but it is consistent across four layers, and it contradicts D5's model of server behaviour. See Change Request 1.
- **The question about the `handleAddLaneStep` comment:** the comment at :888-893 says "a SUBSEQUENT trunk-append (which CAN reparent this tail's anchor)". The code reading above backs it, and goes further: every root-lane create that carries `rootId` appears to splice at the head. So the planner's note ("whether a trunk append can also reparent is out of scope") puts aside the very question that decides whether item 4's fix and its red-test fixture are right.
- **D3 (item 2 boundary):** the inventory of moved state and handlers is accurate. My grep of the uses (:166-195, :775-905, :1089-1151, plus return keys :1561/:1590) found no other writers. The input list is complete for the handlers. But `pendingDraftMetaRef` is read **in render** at :362, and `stepsFingerprint` feeds the effects declared at :392-474. The inputs D3 says it will pass in are declared **after** that: `roots` (:371) and `syncStepsFromServer` (:731). So a hook that "owns" the ref cannot be called where the ref is first needed unless declarations are reordered. D3 does not say which way to go. See Change Request 5.
- **Size:** about 270-300 lines move (state :161-195, handlers :744-905, the draft half of :1081-1152). The concern is cohesive, and D3's stop condition is concrete. I do **not** require item 2 to be split into its own ticket. The refactor is sound once Change Request 5 settles the call-site ordering.
- **Scope / ACs:** AC1-AC4 each map to a task (1.1-4.1). Item 5 is excluded (C1). C2-C4 match the driver scoping. No API or schema change is planned, and none is needed, *unless* Change Request 1 confirms the backend defect.

### Verdict: REFUTE

### Change Requests

1. **Ground item 4 in the real server contract before writing its red test (design.md D5, tasks.md 4.1).**
   - **What's wrong:** D5's red test has the post-create GET return "the following step reparented" under an inserted step. By code reading, the backend does not do that for the frontend's root-lane creates. A body with `rootId` takes the `(None, Some(rootId))` arm (`PipelineService.scala:1974-1987`). That arm ignores `position` and splices the new step at the **head** of the root, reparenting the old head (`PipelineStepRepository.scala:715-733`). The frontend always sends `rootId` from `handleInsertStep` (:777, :796; `pipelineService.ts:119`).
   - **Why it matters:** if this holds, the item-4 fixture encodes behaviour the server never produces. The seam would pass every gate while client and server disagree. The resync would also *move* the user's open card from its insert position to the top. Append drafts would be stale in exactly the same way, so the "append unchanged" scenario in the spec delta would hard-code a known-stale path.
   - **Required revision:** add a probe step that must run before 4.1. Use a backend route-level test against the test DB, not dev-DB rows, posting `{position:k, rootId}` and `{rootId}` (no position) to a single-root pipeline that already has a trunk, and record which step ends up as the root's head and which ids were reparented.
   - **If the server honours `position`:** keep D5, but build the fixture from the probe's real output.
   - **If the server head-splices:** D5 must stop and escalate to the driver. That is a backend placement defect: the doc and the implementation disagree, and it was apparently introduced when HEL-968 began sending `rootId` alongside `position`. It changes item 4's premise and its append/insert scope, so it is an owner scope call (fix here, or file a spinoff and re-scope AC4). It is not something to work around in the frontend.
   - The design must state this branch explicitly.

2. **Make the item-1 test robust to the item-4 fix, or plan its edit (D1/D2).**
   - **What's wrong:** the ported probe creates its draft at an insert gap, and `getPipelineStepsMock.mockResolvedValue([anchor-1, f-1])` never includes `ai-1`. Once commit 4 adds an insert-position resync, that resync replaces the list with one that has no `ai-1`, so `generateToggle()` throws and the commit-1 test goes red. That forces an unplanned fixture edit to an existing test in commit 4.
   - **Required revision:** in D2, write the item-1 test's steps-GET mock as the server-realistic post-create list from the start (initial list first, then the list including `ai-1`, using `mockResolvedValueOnce`). It must be consistent with the Change Request 1 probe. Alternatively, D1 must name the commit-4 edit to this test and justify it as a behaviour change rather than a fixture patch.

3. **Complete D5's hazard list: the resync must not drop other local-only steps.**
   - **What's wrong:** `syncStepsFromServer` replaces the whole list. Item 4 adds a new trigger in the draft flow, where concurrent local-only steps are realistic: a second pending draft, a second draft whose create is in flight, or a failed-create temp step that was kept. If draft A's post-create resync lands while draft B's create is in flight, B's temp step is removed. B's swap (:1118-1127) then maps over a list that no longer contains B, so the swap does nothing. B is created on the server but missing on screen until the next resync, and the meta and creating sets keep dangling entries. A pending, uncreated draft is silently deleted outright.
   - **Required revision:** D5 must choose one of two approaches. Either (a) the item-4 reconcile is a merge that preserves temp-id steps, the same rule `handleReorderSteps` follows at :1282-1291, with a test showing a second pending draft survives; or (b) explicitly accept this as pre-existing (it already affects `handleInsertStep`'s create-immediately resync), justify it, and file a follow-up. Silence is not acceptable.

4. **Define the item-3 fallback's lifetime across the swap, and make spec scenario 2 non-vacuous (D4, spec delta).**
   - **What's wrong:** D4's suggested fix clears the in-flight meta "on swap/failure". After the swap, the persisted id still has no `analyzeByStepId` entry until the debounced analyze (300 ms plus a round trip) resolves. In that window the select falls back to the placeholder again. The RTL suites mock `analyzePipeline` as resolving immediately, which masks this, so "the select still shows the chosen field after the create" can pass while the bug persists.
   - **Required revision:** D4 must say whether the fallback covers the swap-to-analyze window, for example by keeping it until an analyze entry exists for the persisted id. The red/green test must hold the post-swap analyze unresolved when it asserts scenario 2. If the window is accepted as is, the spec delta must not claim it.

5. **Specify where the new hook is called, given render-time ref reads (D3).**
   - **What's wrong:** `stepsFingerprint` reads `pendingDraftMetaRef` in render at :362, and effects at :392-474 consume it. But the inputs D3 passes in (`roots` :371, `syncStepsFromServer` :731) are declared later. A competent implementer could resolve this in two ways:
     - (a) hoist `roots`/`syncStepsFromServer` above :361 and call the new hook there;
     - (b) keep the refs created in the page hook and pass them in.
     A careless reading could produce a third: move `stepsFingerprint` and its effects below :731, which **reorders effects**, and that is a behaviour change.
   - **Required revision:** D3 must pick (a) or (b). It must also add the constraint "no `useEffect` changes its relative declaration order" to the D3 constraint list, next to the existing statement-order rule.

### Non-blocking notes

- D2's mutation line is :1290, not :1291.
- D5 hazard 1's wording: the race is the GET resolving before React commits the swap, not "the same tick".
- `handleRemoveStep` on a pending draft never clears `pendingDraftMetaRef`. This is pre-existing and harmless (the meta is keyed by a temp id that is never reused), and not in scope.
- Item 2 does not need to be split. D3's stop condition is concrete, and the four suites (`draftCreate`, `creatingStep`, `PipelineDetailPage`, `reorderGuard`) cover the moved paths well.

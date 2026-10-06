## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed at HEAD `9c41719c376b858ab9269fa6075f8b3b74acabd1`. The change dir is untracked and there are no commits beyond main. HEL-1340 has not merged (there is no `usePipelineStepCreation.ts`). This was a read-only review: no sbt, Jest or Playwright, and no dev-DB access.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/rootid-step-create-placement/HEL-1345`.

**Live-code facts I re-derived:**
- **The splice primitive** is `PipelineStepRepository.scala:683-742`.
  - The new row is written with `position` 0.
  - `existingChildren` for `(Some(anchor), _)` is `siblingsQuery(pipelineId, parentStepId)`, which is every direct child of the anchor, tails included. All of them are reparented to the new id with `root_id` cleared.
  - `rejectIfReparents` is checked against that same set.
  - So D2's claim ("Splicing onto an anchor reparents ALL its direct children, tails included") is true. That fact is load-bearing for CR1 below.
- **The create response** is `createdStepJson` (`PipelineStepProtocol.scala:440-442`). It always carries `reparentedStepIds`. The frontend reads it nowhere (grep of `frontend/src` returned zero hits).
- **The hook** (`usePipelineDetailPage.ts`):
  - `stepsRef.current = steps` is assigned only during render (`:158-159`).
  - `pendingDraftMetaRef` has the shape `{index?, parentStepId?, attachAsTail?, rootId?}` (`:166-171`).
  - `meta.index` is read only at `:1108`, by the draft create. That confirms D11's claim.
  - `handleInsertStep` sends `isAppend ? undefined : index` and `roots[0]?.id`, then calls `syncStepsFromServer()` (`:759-813`).
  - `handleAddLaneStep` calls `createPipelineStep(..., parentStepId, true)` and then syncs (`:831-905`).
  - The draft swap is an in-place `prev.map` that sets `renderKey: s.renderKey ?? s.id` (`:1104-1153`).
  - `handleRemoveStep` on a temp id only filters locally (`:1164-1201`).
  - `handleReorderSteps` reconciles by `setSteps(newOrder.map(...))`, built from the pre-request `newOrder` snapshot rather than as an updater (`:1283-1293`).
  - Duplicate (`:1413`), remove (`:1185`), root removal (`:1340`) and aggregate-tail (`:937`) still call `syncStepsFromServer`.
- **Temp rendering:** `makeStep` (`stepNarrowing.ts:384-396`) gives a trunk temp neither `parentStepId` nor `rootId`. `buildLaneGraph` (`stepTree.ts:97+`) therefore puts it in the unassigned sweep. Lane continuation is the `position === 0` child.
- **Draft schema fallback:** `resolveDraftFallbackSchema` (`stepNarrowing.ts:452-470`) branches on `meta.parentStepId` alone. D11's warning is accurate: if the insert anchor were stored as `parentStepId`, a trunk draft would resolve its schema as a lane draft. D11 requires a distinct field, and task 3.2(g) tests it. **Question 3: closed.**

**Round-4 CRs: closed, not reworded.**
- **CR1 (stale next-create resolution):** serialization is gone. D11 sends `parentStepId: S` for a gap insert with k > 0, so no index is ever resolved against an unrendered list. HEAD sends `rootId` + `position: 0` and an append sends `rootId`; both are resolved server-side at commit, so neither can be stale. Different-gap trace on trunk A, B, C: X at A|B sends `parentStepId A`, and Y at B|C sends `parentStepId B`. In either commit order, the server holds A→X→B→Y→C, and neither create reparents the other. **Closed.**
- **CR2 (a temp dropped by a wholesale replace):** case 3 appends the created step and applies its reparents. A user-removed temp is excluded through a ref filled by `handleRemoveStep`. **Closed** for the "replace while in flight" window the spec names.
- **CR3 (liveness):** no queue, so no shared liveness bound is needed. A hung create again blocks only its own card. **Closed.**
- **CR4 (excluded creators):** shape-instantiate and aggregate-tail are named as excluded, with the residual hazard in Risks. **Closed.**

**Question 1: tracing `applyCreatedStep`.** All of the following come out right:
- **Same slot, reverse arrival** (X then Y at the gap after A; server A→Y→X→B). Y's response arrives first while X is still a temp, so `pendingParent[X]=Y`. X's response then takes parent Y and reparents B. Result: A→Y→X→B. Commit-order arrival gives the same result.
- **Same slot, other commit order** (Y commits first; server A→X→Y→B). This also comes out right in both arrival orders.
- **Three creates at one slot** (X, then Z at A, then Y at A; server A→Y→Z→X→B). Correct in every arrival order I traced, because each `pendingParent` key is written by the response of the create committed directly above it.
- **HEAD+HEAD:** correct.
- **Gap insert immediately before an in-flight append's temp, on a tail-free trunk:** correct.
- **Draft plus immediate at the same anchor:** both go through the same function, so the same traces apply.
- **Interleaving with a wholesale sync** (duplicate, remove):
  - A GET fetched after the create committed gives case 1, which is correct.
  - A GET fetched before the commit gives case 3, which is correct.
- **Reorder:** an in-flight committed temp makes the PUT fail set-equality, and the failure restore is a named Risk.

**One ordering is wrong. This is CR1.**

**Question 2: D11 against the backend arms.** Every arm is consistent:
- A gap insert with k > 0 now hits the existing `(Some(parentStepId), None)` splice arm. The editor sends no `attachAsTail` and no `rejectIfReparents`, so HEL-1069 is untouched for the editor. Tails under S move to the new step, which is the same as what both the old `(None, None)` position path and D1's `trunk(k-1)` anchor do.
- D1 is still exercised from the editor by the append (`rootId`, no `position`) and gap 0 (`rootId`, `position: 0`). The k > 0 slot is covered by D4's route cases (`position` 2, and `position` 1 on multi-root) and by MCP/API callers.
- D7's e2e is still red against the unmodified backend, but now through the append and the trunk build-up only: the k > 0 gap insert uses the parent arm, which already works today. That is acceptable, because D7 only requires it to be red.

**Question 4: existing-test edits.**
- `PipelineDetailPage.test.tsx:1970` pins `(…, 1, undefined, undefined, "root-1")` for a gap with k > 0. D5's planned edits already cover it ("Tests pinning the gap-insert wire call … change to the D11 `parentStepId` form").
- `:1946` (gap 0) is correctly listed as unchanged.
- The stepIndex test (`:2068-2093`) and the fingerprint test (`:2027-2059`) depend on the removed resync. D5 lists both (`~:2037-2042`, `~:2083`). For the stepIndex test, the mock's `reparentedStepIds` must name `y1`, or Filter is never reparented and its `stepIndex` does not shift. D5's "express the server's post-insert truth through the create mock's `reparentedStepIds`" covers that.
- Other `createPipelineStepMock` sites (`:401`, `:623`, `:660`, `:2740`, `:2863`, `:3112`, `:3790`, `:3845`) are draft, shape or default-mock fixtures. The design's stop-and-report clause governs any surprise there.
- **The list is complete as far as I can establish without running Jest.**

**Question 5: cross-artifact consistency.** I compared the proposal against D1, D10 and D11; the persistence-spec guard sentence against D10 (k = trunk length is the append and is refused iff trunk-last has children); the editor spec against D5/D11 (anchor by id, append when gone, exactly-once, removal exception); the MCP spec delta against D10; and tasks 3.2(c)/(d)/(e)/(g) against D5/D11. **I found no contradictions.**

### Verdict: REFUTE

### Change Requests

1. **`applyCreatedStep` case 2/3 overwrites a present step's parent with an OLDER reparent when two creates reparent the same step and their responses arrive in reverse commit order. The step is left with a parent different from the server's.** This contradicts D5's "order-robust" claim, the editor spec's "every step shows the parent the server persisted", and AC5 ("steps the server reparents do not stay stale on screen").

   **Why it is reachable.** `pendingParent` only handles a reparented id that is absent locally. A present step can be reparented twice whenever the second create's anchor is resolved server-side to the first create's new step. The editor's append does exactly that (`rootId`, no `position`, anchored on the trunk-last step), and the splice moves ALL the anchor's children, tails included (`PipelineStepRepository.scala:720-737`).

   **Trace.** Trunk A→B, where B has a tail lane L (for example, the user added a lane off the last step). The user clicks the bottom add row twice with an immediate kind, giving P1 and P2.
   1. P1 commits: B→P1, and its response reports `[L]`.
   2. P2 commits. The trunk-last step is now P1, so the result is P1→P2, and its response reports `[L]`.
   3. The server now holds L under P2.
   4. P2's response arrives first. L is present, so L's parent becomes P2. P1 is still a temp, so P2's parent (P1) renders unresolved for now.
   5. P1's response arrives. Its temp is present, so P1 takes parent B and reparents its listed id L to P1.
   6. Final state on screen: L is under P1, while the server has it under P2. This persists until some later full sync.

   **Other shapes of the same bug.** The same outcome follows from a gap insert X at B|P1-temp committing before the append P1 (X reparents `[L]`, then P1, anchored on trunk-last X, reparents `[L]`), with P1's response arriving first.

   **Regression vs today.** Today each immediate create's own post-create GET is sent after its own response, so the later-sent GET usually reflects the later commit.

   **Required:**
   - (a) Add an ordering rule to D5 for applying a listed id that is present. For example, skip reparenting a present id R to `created.id` when R's current local parent chain (following `parentStepId`) reaches `created.id`. A step that sits below `created.id` locally can only have got there from a commit after `created`'s, so it is the newer state. Apply the same rule to the `pendingParent` write for robustness. Equivalent alternatives are acceptable, for example ordering by a server timestamp the response carries. The design must name one.
   - (b) Add a 3.1 unit case and a 3.2 RTL case for this trace: trunk-last with a tail, two appends, responses in reverse commit order. Assert that L's final local parent equals the server's (P2). Record it red against the current case-2 rule.

### Non-blocking notes

- **Reorder success reconcile.** `handleReorderSteps` builds its success state from the pre-request `newOrder` snapshot (`:1283-1293`), not as an updater. Suppose a create's response is applied between the PUT and the PUT's response. This happens when the create was sent before the reorder, commits after it, and responds first. The reconcile then reintroduces the temp and drops the created step. This is pre-existing (today's post-create GET has the same exposure), but Risks names only the *failed* reorder restore. Name the success path too, or switch the reconcile to a `prev =>` updater that maps persisted ids only.
- **Stale GET after an apply.** A wholesale `syncStepsFromServer` GET can be fetched before create C commits but resolve after C's response has been applied. It then removes C from screen permanently (until the next full sync), and case 3 cannot help, because C's response has already been consumed. This is pre-existing and outside the spec's "while its create was in flight" wording. It is worth one line in Risks.
- **Anchor deleted in another tab.** D11's "for a draft the next retry re-checks and appends" holds only when the local list has dropped the anchor. If another tab or agent deleted it, the local list still holds S, so every retry sends `parentStepId: S` and gets 422 until a reload. This is acceptable (a toast is shown and a reload heals it), but the Risks wording overstates it.
- **Leftover `pendingParent` entries.** Case 1 and case 3 (user-removed) leave any `pendingParent` entry for `created.id` unconsumed. This is harmless, but a delete on every case is simpler to reason about.

### Gate-defect check (CON-160)

No report in this review relied on mtime-ordering evidence, so this check does not apply.

## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `9c41719c376b858ab9269fa6075f8b3b74acabd1`. The change dir is untracked and there are no commits beyond main. This was a read-only review: no sbt, Jest or Playwright, and no dev-DB access.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/rootid-step-create-placement/HEL-1345`.

**Round-1 CRs**

- **CR1 (HEL-1069 contract): addressed.**
  - D10 and task 1.4 rewrite `PipelineStepReparentRoutesSpec.scala:138-146` into two cases that still return 422, plus a new 201 case.
  - The `mcp-pipeline-step-placement` delta restates the "second same-root branch" scenario and adds a trunk-tail append scenario.
  - Task 1.6 edits `helio-mcp/src/tools/write.ts:562` ("rootId on a root that already has steps trips the guard"). I confirmed that text is present at that line.
  - The proposal's Why now says default MCP calls were refused, not misplaced.
- **CR4 (JSON Schema): addressed.** D9 and task 1.5 cover `schemas/pipelines/create-pipeline-step-request.schema.json`. I confirmed the whole-pipeline `position` sentence at :5 and the `rootId` text at :35.
- **CR2 (duplicate card): addressed as written.** The immediate paths (`usePipelineDetailPage.ts:784`, `:881`) now swap in place from `createPipelineStep`'s return value before the reconcile, and test 3.2(b) asserts exactly one card. The swap introduces a new defect, though (CR3 below).
- **CR3 (overlapping creates): partially addressed.** The guard has a liveness hole (CR1 below), and its scope covers creates only (CR2 below).

**Focus point 3: D1's head rule against `buildLaneGraph`. Consistent.**
- `stepTree.ts` `buildLaneGraph`:
  - It sorts each root's root-level steps by `(position, array index)` (`sortSiblings`, :90-95) and queues one lane per step.
  - `PipelineRiverView.tsx:178-181` takes the first `parentStepId === undefined && rootId === roots[0].id` lane as primary. That is the lowest-`(position, index)` root-level step.
  - Continuation is the first `position === 0` child in the same sort.
- D1 uses the lowest-`position` root-level step, with ties in `listWithRootIdsInternal` order. That order is `executionOrder`, which is also the GET order the client array is built from (`PipelineStepRepository.scala:354-360`). The continuation is the first `position == 0` child, and `childrenOf` is a stable `sortBy(_.position)` (:1119).
- The two rules agree for any server-synced state.
- Edge case: the client's fallback for a sole child with no `position` is local-only and never reaches the server.

**Focus point 4: D10 against `spliceInsertReportingInternal`. Matches.** In `PipelineStepRepository.scala:683-750`:
- With `parentStepId = Some(anchor)`, `existingChildren = siblingsQuery(pipelineId, Some(anchor))`, which is every child of the anchor. `rejectIfReparents` fails iff that set is non-empty. For a no-position append the anchor is the trunk-last step, which has no `position == 0` child by construction, so the request is refused exactly when that step has tail lanes. That is D10's first bullet.
- With `(None, Some(rid))` (position 0), `existingChildren` is every parentless step of that root, so a non-empty root is refused. That is D10's second bullet.
- For a mid-trunk `k`, the anchor `trunk(k-1)` always has `trunk(k)` as a child, so the request is refused ("slot occupied"). That matches the spec bullet.
- V98's XOR holds because the parented arm passes `explicitRootId = None` (:704-706).

**Focus point 2: does the immediate-path swap without `renderKey` preserve HEL-1294? For the created card, yes.**
- Cards are keyed by `stepRenderKey = renderKey ?? id` (`stepTree.ts:51`; `PipelineRiverView.tsx:354`; `LaneColumn.tsx:203`, `:249`).
- The swap changes the key from the temp id to the persisted id: one remount, as today, only earlier. The reconcile keeps that id as the key, so there is no second remount.
- `isCreating = creatingStepIds.has(step.id)` (`LaneColumn.tsx:226`, `:281`) holds the temp id. Once swapped, the persisted card is expandable during the reconcile GET. Since no later remount occurs, an expand in that window is kept. `markCreating` timing is unchanged.
- **However, the swap is not structurally safe for the OTHER cards.** See CR3.

**Focus point 1: D5's guard.** Traced by hand against the rules in D5. See CR1 and CR2.

**Focus point 5: AC coverage.**
- AC1 and AC2: tasks 1.1-1.3.
- AC3: task 2.1. `docs/` has no read-only production DB path, so "unverified, escalate" is the honest outcome.
- AC4: tasks 1.5-1.6.
- AC5: tasks 3.1-3.3.
- Gaps: the tests do not cover the orderings named in CR1 and CR3.

### Verdict: REFUTE

### Change Requests

1. **D5's liveness rule has a hole: a success followed by a failure leaves no reconcile.**
   - D5 bumps `createSettledSeqRef` on every settle, "success or failure". A failed create re-issues a reconcile only "if an earlier reconcile was discarded".
   - Failing trace:
     1. Creates A and B are in flight.
     2. A succeeds: seq is bumped, in-flight is 1, A swaps and issues GET_A.
     3. B fails before GET_A resolves: seq is bumped and in-flight drops to 0. No reconcile has been discarded yet, so none is issued.
     4. GET_A resolves: the seq changed, so it is discarded.
   - Result: no reconcile ever applies, and A's reparented steps stay stale. That is exactly AC5's symptom, and with CR3 they can stay invisible.
   - Fix (pick one):
     - Do not bump the seq on a failed create. A failed POST commits nothing, so it cannot make a snapshot stale. The "no create in flight" check plus the failure re-issue then covers every ordering.
     - Or track a dirty flag ("a successful create has had no applied reconcile since") and re-issue whenever a discard happens with in-flight 0 and the flag set.
   - Add a 3.2 RTL case for this ordering: A succeeds, B fails, then GET_A resolves. Assert that A's reparented step shows its server parent.

2. **The staleness guard only counts creates. On the draft path, a stale snapshot can revert other structural mutations the user made, which today's draft path never does.**
   - Rules involved: the reconcile emits persisted steps "in server order", takes server structural fields, and drops "local persisted absent from server". The guard only watches create settles.
   - Traces, each with a GET issued before the other mutation committed and applied after its local effect:
     - `handleReorderSteps` (:1230-1300): the optimistic order and the PUT response are applied, then the stale reconcile restores the pre-reorder server order and parents. The reorder visibly snaps back while the server has it.
     - `handleDuplicateStep` (:1401-1420): the duplicate's `syncStepsFromServer` adds the clone, then the stale reconcile drops it ("absent from server"). Steps the duplicate's splice reparented also revert.
     - `handleInstantiateShape` (:1040): it appends each persisted step via `setSteps`, and the stale reconcile drops them.
     - `handleRemoveStep` (:1164-1200): if the delete's own sync lands first, the stale reconcile re-points the deleted step's head child at the deleted id. That orphans it into `buildLaneGraph`'s totality sweep.
   - The Risks line "a delete or reorder racing a reconcile GET cannot resurrect a step" is true but incomplete. Resurrection is not the only failure.
   - Today the draft path never resyncs, so this exposure is new with this change. The immediate paths' wholesale sync has the same staleness today.
   - Fix: make the guard a structural-mutation seq. Bump it (and count in-flight) on the settle of every step-structure mutation in the hook: remove, reorder, duplicate, shape instantiate, aggregate-tail add, root removal, and both create kinds. Or state and justify each excluded handler.
   - Add a 3.1 or 3.2 case: a reorder that settles between the reconcile's GET issue and its resolution is not reverted.

3. **The immediate-path in-place swap renders a structurally wrong frame until the reconcile applies. Downstream cards vanish or move lanes, so open cards remount collapsed.** That is a regression against today's atomic wholesale replace.
   - The swap gives NEW its server `parentStepId`/`rootId`/`position`. Every step the server reparented keeps its old local parent until the GET-backed reconcile applies.
   - Gap 0 (trunk A, B, C):
     - After the swap, NEW and A are both root-level `position 0` steps of root 0. `buildLaneGraph` seeds two root-0 lanes, and the primary lane is `[NEW]` because NEW was spliced at flat index 0.
     - `PipelineRiverView` renders only root 0's primary lane inline (:178-181) and roots 1.. via `RootColumn` (:288, :498). A second root-0 root-level lane is not rendered at all, so A, B and C disappear from the editor.
     - If the reconcile is discarded (overlap, CR2) or never applies (CR1), they stay hidden until a later sync or a reload.
   - Gap k (between A and B): A gets two `position 0` children. NEW wins by array index, and B-C are re-homed into a child lane of A (`childLanesOf`). Their cards remount, and again when the reconcile moves them back.
   - Today `syncStepsFromServer`'s single replace keeps A-C in the primary list under unchanged keys, so none of this happens.
   - The same intermediate frame exists on the draft path. Today it is permanent there; this change makes it transient, but it is still a remount.
   - Fix: make the swap structurally correct in the same `setSteps` updater:
     - Preferred: use the create response's `reparentedStepIds`. `PipelineStepProtocol.createdStepJson` (:440-442) always returns it, and the frontend currently ignores it (zero hits under `frontend/src`). For each listed id, set `parentStepId = created.id` and clear `rootId`. The splice updates only `(parent_step_id, root_id, updated_at)`, so positions are unchanged.
     - Or apply swap and reconcile atomically.
   - With the response-based form, the frame after the POST is already server-correct, and the GET reconcile becomes a confirmation. Consider whether the GET, and the guard, are still needed at all. AC5 says "resyncs with the server", and the server's own reported reparent set arguably satisfies that. Either way, state the decision.
   - Add a 3.2 RTL assertion that A, B and C stay rendered, with an open card in B still open, while the reconcile GET is pending, for both a gap-0 and a gap-1 immediate insert.

4. **Honouring and range-checking `position` on rootId creates makes a stale draft index a permanent 422 loop. The design does not handle it.**
   - `handleInsertStep` stores `index` in `pendingDraftMetaRef` at insert time (:771-775). The draft is POSTed only when its config later becomes complete (:1104-1112), possibly minutes later.
   - If the trunk shrinks in between (the user deletes a step), `index` can exceed the root's trunk length. The create returns 422, the catch restores the same `meta` (:1150), and every retry sends the same out-of-range position. The draft can never be created; the only way out is removing it and re-adding.
   - If the trunk changed without shrinking, the draft lands at a stale slot.
   - Separately, a temp step has no `parentStepId`/`rootId` (`makeStep`, `stepNarrowing.ts:384-396`), so `buildLaneGraph`'s totality sweep renders it at the end of the first non-empty lane (`stepTree.ts:211-232`). With two trailing local steps in root 0's primary lane, the gap between them sends `position` = (persisted trunk length + 1), which now returns 422 where it previously succeeded.
   - Before this change the rootId arm ignored `position`, so neither failure existed.
   - Fix: D5/D1 must specify the draft behaviour. Either:
     - re-derive the position at create time, e.g. store the anchor step id instead of an index and send its current trunk index, or omit `position` when the anchor is trunk-last;
     - or on an out-of-range 422 for a draft, fall back to an append and surface it.
   - Also state how a gap index counts trailing local-only steps (exclude them, or treat any index above the persisted trunk length as an append).
   - Add a 3.2 case: a draft inserted at gap k, then a delete that shrinks the trunk below k, then completing the draft. The step is created and not stuck.

### Non-blocking notes

- `handleRemoveStep` and `handleReorderSteps` restore a whole-array snapshot on failure (`setSteps(previousSteps)`, :1189 and :1296). That snapshot can predate a create's swap, which reintroduces the temp copy, and `pendingDraftMetaRef` is already cleared. This hazard exists today and is not introduced here, but CR2's mutation-seq work is the natural place to note it, or to file a follow-up.
- The `syncStepsFromServer` callers kept as a Non-Goal (remove, duplicate, root removal, aggregate tail) still wholesale-drop local-only drafts and overwrite local config. HEL-1340 handed over that hazard only for `handleInsertStep`'s resync, so keeping them is in scope-policy, but the Non-Goal should say so explicitly.
- D4's lane pre-check precondition ("`trunkOf(GET order)` resolves to R1's chain") is good. Seed R1's steps strictly first so the precondition is stable rather than lucky.

### Gate-defect check (CON-160)

No report in this review relied on mtime-ordering evidence. Not applicable.
